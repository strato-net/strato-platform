{-# LANGUAGE OverloadedStrings #-}

-- | Converts between EVM ABI-encoded bytes and SolidVM text arguments / return values.
module BlockApps.Solidity.ABI.Bridge
  ( decodeABIArgs,
    valueToArgText,
    encodeReturnABI,
    encodeValueABI,
    encodeEventToLog,
    findEventDef,
  )
where

import BlockApps.Solidity.ABI.Codec
import BlockApps.Solidity.ABI.Selector (svmTypeToCanonical)
import Blockchain.Strato.Model.Address (addressToByteString, formatAddressWithoutColor)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List (intercalate, partition)
import qualified Data.Map as M
import qualified Data.Text as T
import qualified Data.Vector as V
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.Event (EventF (..), EventLog (..))
import SolidVM.Model.CodeCollection.VarDef (IndexedType (..))
import SolidVM.Model.SolidString (SolidString, labelToText)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Value (..), getConst)

--------------------------------------------------------------------------------
-- ABI bytes -> SolidVM text arguments
--------------------------------------------------------------------------------

decodeABIArgs :: B.ByteString -> [SVMType.Type] -> [Value]
decodeABIArgs _ [] = []
decodeABIArgs bs types =
  let decode1 headOffset typ =
        case parseTypeDescriptor (svmTypeToCanonical typ) of
          Just td -> decodeValue td bs headOffset
          Nothing -> SNULL
   in zipWith (\i t -> decode1 (i * 32) t) [0 ..] types

valueToArgText :: Value -> T.Text
valueToArgText (SInteger n) = T.pack $ show n
valueToArgText (SAddress addr _) = T.pack $ "0x" ++ formatAddressWithoutColor addr
valueToArgText (SBool True) = "true"
valueToArgText (SBool False) = "false"
valueToArgText (SString s) = T.pack $ show s
valueToArgText (SBytes bs) = T.pack $ "0x" ++ BC.unpack (B16.encode bs)
valueToArgText SNULL = "0"
valueToArgText v = T.pack $ show v

--------------------------------------------------------------------------------
-- SolidVM return string -> ABI-encoded bytes
--------------------------------------------------------------------------------

encodeReturnABI :: [SVMType.Type] -> String -> B.ByteString
encodeReturnABI [] _ = B.empty
encodeReturnABI [t] retStr = encodeSingleReturn t (stripParens retStr)
encodeReturnABI ts retStr = encodeMultiReturn ts (stripParens retStr)

stripParens :: String -> String
stripParens ('(' : rest)
  | not (null rest) && last rest == ')' = init rest
stripParens s = s

encodeSingleReturn :: SVMType.Type -> String -> B.ByteString
encodeSingleReturn (SVMType.Int (Just True) _) s = encodeInt256 (read s)
encodeSingleReturn (SVMType.Int _ _) s = encodeUint256 (read s)
encodeSingleReturn SVMType.Bool s = encodeUint256 (if s == "true" then 1 else 0)
encodeSingleReturn (SVMType.Address _) s =
  padLeft32 $ addressToByteString (read $ stripQuotes s)
encodeSingleReturn (SVMType.String _) s =
  let bs = BC.pack $ readStringLiteral s
   in encodeUint256 32 <> encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeSingleReturn (SVMType.Bytes _ Nothing) s =
  let bs = either (const B.empty) (\x -> x) $ B16.decode $ BC.pack $ stripQuotes s
   in encodeUint256 32 <> encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeSingleReturn (SVMType.Bytes _ (Just n)) s =
  let bs = either (const B.empty) (\x -> x) $ B16.decode $ BC.pack $ stripQuotes s
   in padLeft32 $ B.take (fromIntegral n) bs
encodeSingleReturn (SVMType.Enum _ _ _) s = encodeUint256 (read s)
encodeSingleReturn _ s = case reads s :: [(Integer, String)] of
  [(n, _)] -> encodeUint256 n
  _ -> encodeUint256 0

encodeMultiReturn :: [SVMType.Type] -> String -> B.ByteString
encodeMultiReturn types str =
  let pairs = zip types (splitReturnTuple str)
      staticSize = length types * 32
      encodePass [] _ headAcc tailAcc = headAcc <> tailAcc
      encodePass ((t, v) : rest) tailOff headAcc tailAcc
        | isDynamic t =
            let encoded = encodeSingleReturn t v
             in encodePass rest (tailOff + B.length encoded) (headAcc <> encodeUint256 (fromIntegral tailOff)) (tailAcc <> encoded)
        | otherwise =
            encodePass rest tailOff (headAcc <> encodeSingleReturn t v) tailAcc
   in encodePass pairs staticSize B.empty B.empty

isDynamic :: SVMType.Type -> Bool
isDynamic (SVMType.String _) = True
isDynamic (SVMType.Bytes _ Nothing) = True
isDynamic (SVMType.Array _ Nothing) = True
isDynamic _ = False

splitReturnTuple :: String -> [String]
splitReturnTuple = go (0 :: Int) "" []
  where
    go _ acc result [] = reverse (reverse acc : result)
    go depth acc result (c : cs)
      | c == ',' && depth == 0 = go 0 "" (reverse acc : result) cs
      | c == '(' || c == '[' = go (depth + 1) (c : acc) result cs
      | c == ')' || c == ']' = go (depth - 1) (c : acc) result cs
      | c == '"' =
          let (quoted, rest) = spanString cs
           in go depth (reverse quoted ++ ['"', c] ++ acc) result rest
      | otherwise = go depth (c : acc) result cs
    spanString [] = ([], [])
    spanString ('"' : rest) = ("\"", rest)
    spanString ('\\' : x : rest) = let (s, r) = spanString rest in ('\\' : x : s, r)
    spanString (x : rest) = let (s, r) = spanString rest in (x : s, r)

stripQuotes :: String -> String
stripQuotes ('"' : rest)
  | not (null rest) && last rest == '"' = init rest
stripQuotes s = s

readStringLiteral :: String -> String
readStringLiteral s = case reads s :: [(String, String)] of
  [(str, _)] -> str
  _ -> stripQuotes s

--------------------------------------------------------------------------------
-- SolidVM Value -> ABI-encoded bytes (no string intermediate)
--------------------------------------------------------------------------------

encodeValueABI :: [SVMType.Type] -> Value -> B.ByteString
encodeValueABI [] _ = B.empty
-- A struct-valued getter return arrives as an STuple of the struct's members.
-- The caller supplies one type per member (the struct flattened, matching
-- SolidVM's handleStruct), so we ABI-encode it as a tuple. The length guard
-- ensures we only do this when the type list lines up with the members, leaving
-- the single-scalar getter path below untouched.
encodeValueABI ts (STuple vs)
  | length ts == V.length vs = encodeTuple ts (map getConst $ V.toList vs)
encodeValueABI [t] v = encodeSingleValue t v
encodeValueABI _ _ = B.empty

-- | ABI-encode a sequence of values as a tuple using the standard head/tail
-- layout: static members are written inline in the head; dynamic members get a
-- 32-byte offset in the head and their data appended in the tail.
encodeTuple :: [SVMType.Type] -> [Value] -> B.ByteString
encodeTuple types vals =
  let pairs = zip types vals
      headSize = length pairs * 32
      go [] _ headAcc tailAcc = headAcc <> tailAcc
      go ((t, v) : rest) tailOff headAcc tailAcc
        | isDynamic t =
            let encoded = encodeDynamicTail t v
             in go rest (tailOff + B.length encoded) (headAcc <> encodeUint256 (fromIntegral tailOff)) (tailAcc <> encoded)
        | otherwise =
            go rest tailOff (headAcc <> encodeSingleValue t v) tailAcc
   in go pairs headSize B.empty B.empty

-- | Tail data for a dynamic tuple member: length word followed by right-padded
-- contents, with no leading self-relative offset (the offset lives in the head).
encodeDynamicTail :: SVMType.Type -> Value -> B.ByteString
encodeDynamicTail (SVMType.String _) (SString s) =
  let bs = BC.pack s
   in encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicTail (SVMType.Bytes _ Nothing) (SBytes bs) =
  encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeDynamicTail _ _ = encodeUint256 0

encodeSingleValue :: SVMType.Type -> Value -> B.ByteString
encodeSingleValue (SVMType.Int (Just True) _) (SInteger n) = encodeInt256 n
encodeSingleValue (SVMType.Int _ _) (SInteger n) = encodeUint256 n
encodeSingleValue SVMType.Bool (SBool b) = encodeUint256 (if b then 1 else 0)
encodeSingleValue (SVMType.Address _) (SAddress a _) = padLeft32 $ addressToByteString a
encodeSingleValue (SVMType.Address _) (SContract _ a) = padLeft32 $ addressToByteString a
encodeSingleValue (SVMType.Contract _) (SContract _ a) = padLeft32 $ addressToByteString a
encodeSingleValue (SVMType.Contract _) (SAddress a _) = padLeft32 $ addressToByteString a
encodeSingleValue (SVMType.String _) (SString s) =
  let bs = BC.pack s
   in encodeUint256 32 <> encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeSingleValue (SVMType.Bytes _ Nothing) (SBytes bs) =
  encodeUint256 32 <> encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeSingleValue (SVMType.Bytes _ (Just n)) (SBytes bs) =
  padLeft32 $ B.take (fromIntegral n) bs
encodeSingleValue (SVMType.Enum _ _ _) (SEnumVal _ _ v) = encodeUint256 (fromIntegral v)
encodeSingleValue _ (SContract _ a) = padLeft32 $ addressToByteString a
encodeSingleValue _ (SAddress a _) = padLeft32 $ addressToByteString a
encodeSingleValue _ (SInteger n) = encodeUint256 n
-- Unset / default struct fields read back as SNULL; encode them as a zero word
-- so a static member always occupies its 32-byte slot (keeps tuple heads aligned).
encodeSingleValue _ SNULL = encodeUint256 0
encodeSingleValue _ _ = B.empty

--------------------------------------------------------------------------------
-- Event log encoding: decoded Cirrus attributes -> EVM topics + data
--------------------------------------------------------------------------------

encodeEventToLog :: SolidString -> EventF a -> M.Map T.Text T.Text -> ([B.ByteString], B.ByteString)
encodeEventToLog evName eventDef attrs =
  let logs = _eventLogs eventDef
      allTypes = map (indexedTypeType . _eventLogType) logs
      topic0 = if _eventAnonymous eventDef then []
               else let sig = T.unpack (labelToText evName)
                            ++ "(" ++ intercalate "," (map svmTypeToCanonical allTypes) ++ ")"
                    in [keccak256ToByteString $ hash $ BC.pack sig]
      (indexedLogs, nonIndexedLogs) = partition _eventLogIndexed logs
      indexedTopics = map (encodeLogParam attrs) indexedLogs
      nonIndexedData = B.concat $ map (encodeLogParam attrs) nonIndexedLogs
  in (topic0 ++ indexedTopics, nonIndexedData)

encodeLogParam :: M.Map T.Text T.Text -> EventLog -> B.ByteString
encodeLogParam attrs (EventLog name _ idxType) =
  let typ = indexedTypeType idxType
  in case M.lookup name attrs of
    Just s  -> encodeSingleReturn typ (T.unpack s)
    Nothing -> encodeUint256 0

findEventDef :: CC.CodeCollection -> SolidString -> Maybe (CC.Event)
findEventDef cc evName =
  case concatMap (\(_, c) -> maybe [] (:[]) $ M.lookup evName (CC._events c)) (M.toList $ CC._contracts cc) of
    (ev : _) -> Just ev
    []       -> Nothing
