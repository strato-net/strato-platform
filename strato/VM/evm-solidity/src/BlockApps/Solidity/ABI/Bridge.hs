{-# LANGUAGE OverloadedStrings #-}

-- | Converts between EVM ABI-encoded bytes and SolidVM text arguments / return values.
module BlockApps.Solidity.ABI.Bridge
  ( decodeABIArgs,
    valueToArgText,
    encodeReturnABI,
    encodeValueABI,
  )
where

import BlockApps.Solidity.ABI.Codec
import BlockApps.Solidity.ABI.Selector (svmTypeToCanonical)
import Blockchain.Strato.Model.Address (addressToByteString, formatAddressWithoutColor)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Value (..))

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
encodeValueABI [t] v = encodeSingleValue t v
encodeValueABI _ _ = B.empty

encodeSingleValue :: SVMType.Type -> Value -> B.ByteString
encodeSingleValue (SVMType.Int (Just True) _) (SInteger n) = encodeInt256 n
encodeSingleValue (SVMType.Int _ _) (SInteger n) = encodeUint256 n
encodeSingleValue SVMType.Bool (SBool b) = encodeUint256 (if b then 1 else 0)
encodeSingleValue (SVMType.Address _) (SAddress a _) = padLeft32 $ addressToByteString a
encodeSingleValue (SVMType.String _) (SString s) =
  let bs = BC.pack s
   in encodeUint256 32 <> encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeSingleValue (SVMType.Bytes _ Nothing) (SBytes bs) =
  encodeUint256 32 <> encodeUint256 (fromIntegral $ B.length bs) <> padRight32 bs
encodeSingleValue (SVMType.Bytes _ (Just n)) (SBytes bs) =
  padLeft32 $ B.take (fromIntegral n) bs
encodeSingleValue (SVMType.Enum _ _ _) (SEnumVal _ _ v) = encodeUint256 (fromIntegral v)
encodeSingleValue _ (SInteger n) = encodeUint256 n
encodeSingleValue _ _ = B.empty
