{-# LANGUAGE OverloadedStrings #-}

-- | Converts between EVM ABI-encoded bytes and SolidVM text arguments / return values.
module BlockApps.Solidity.ABI.Bridge
  ( decodeABIArgs,
    decodeABIArgsWithContract,
    valueToArgText,
    valueToArgTextWithType,
    encodeReturnABI,
    encodeValueABI,
    encodeEventToLog,
    findEventDef,
  )
where

import BlockApps.Solidity.ABI.Codec
import BlockApps.Solidity.ABI.Selector (svmTypeToCanonical, svmTypeToCanonicalWithContract)
import Blockchain.Strato.Model.Address (addressToByteString, formatAddressWithoutColor)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Lens ((^.))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Char (isSpace, toLower)
import Data.List (intercalate, partition)
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import qualified Data.Vector as V
import Numeric (readHex)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.Event (EventF (..), EventLog (..))
import SolidVM.Model.CodeCollection.VarDef (IndexedType (..))
import SolidVM.Model.SolidString (SolidString, labelToText)
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Value (..), Variable (Constant), getConst)

--------------------------------------------------------------------------------
-- ABI bytes -> SolidVM text arguments
--------------------------------------------------------------------------------

decodeABIArgs :: B.ByteString -> [SVMType.Type] -> [Value]
decodeABIArgs _ [] = []
decodeABIArgs bs types =
  case traverse (parseTypeDescriptor . svmTypeToCanonical) types of
    Just descriptors -> decodeValues descriptors bs
    Nothing -> replicate (length types) SNULL

decodeABIArgsWithContract :: CC.Contract -> B.ByteString -> [SVMType.Type] -> [Value]
decodeABIArgsWithContract _ _ [] = []
decodeABIArgsWithContract contract bs types =
  case traverse (typeDescriptorForContract contract) types of
    Just descriptors -> decodeValues descriptors bs
    Nothing -> replicate (length types) SNULL

typeDescriptorForContract :: CC.Contract -> SVMType.Type -> Maybe TypeDescriptor
typeDescriptorForContract contract typ = case typ of
  SVMType.Int (Just True) maybeBytes -> Just $ TInt $ maybe 256 ((8 *) . fromIntegral) maybeBytes
  SVMType.Int _ maybeBytes -> Just $ TUint $ maybe 256 ((8 *) . fromIntegral) maybeBytes
  SVMType.Bool -> Just TBool
  SVMType.Address _ -> Just TAddress
  SVMType.Contract _ -> Just TAddress
  SVMType.String _ -> Just TString
  SVMType.Bytes _ Nothing -> Just TBytes
  SVMType.Bytes _ (Just n) -> Just $ TBytesN $ fromIntegral n
  SVMType.Enum (Just n) _ _ -> Just $ TUint $ 8 * fromIntegral n
  SVMType.Enum Nothing _ _ -> Just $ TUint 8
  SVMType.Array entry Nothing -> TArrayOf <$> typeDescriptorForContract contract entry
  SVMType.Array entry (Just len) -> (`TFixedArray` fromIntegral len) <$> typeDescriptorForContract contract entry
  SVMType.Struct _ name -> structDescriptor name
  SVMType.UnknownLabel name
    | M.member name (contract ^. CC.enums) -> Just $ TUint 8
    | otherwise -> structDescriptor name
  SVMType.UserDefined _ actual -> typeDescriptorForContract contract actual
  _ -> Nothing
  where
    structDescriptor name = do
      fields <- M.lookup name (contract ^. CC.structs)
      TTuple <$> traverse (typeDescriptorForContract contract . CC.fieldTypeType . fieldType) fields
    fieldType (_, item, _) = item

valueToArgText :: Value -> T.Text
valueToArgText (SInteger n) = T.pack $ show n
valueToArgText (SAddress addr _) = T.pack $ "0x" ++ formatAddressWithoutColor addr
valueToArgText (SBool True) = "true"
valueToArgText (SBool False) = "false"
valueToArgText (SString s) = T.pack $ show s
-- SolidVM's expression parser treats 0x-prefixed input as an integer. Use its
-- explicit hex-bytes literal so raw Ethereum calldata preserves bytes/bytesN
-- types when it crosses into the typed SolidVM dispatcher.
valueToArgText (SBytes bs) = T.pack $ "hex\"" ++ BC.unpack (B16.encode bs) ++ "\""
valueToArgText SNULL = "0"
valueToArgText v = T.pack $ show v

-- | Render an ABI-decoded value as the typed literal accepted by SolidVM's
-- dispatcher. Struct tuples need their source field names restored here; a raw
-- @(...)@ tuple is not accepted for a Solidity struct parameter.
valueToArgTextWithType :: CC.Contract -> SVMType.Type -> Value -> T.Text
valueToArgTextWithType contract typ value = case typ of
  SVMType.Struct _ name -> renderStruct name value
  SVMType.UnknownLabel name
    | M.member name (contract ^. CC.structs) -> renderStruct name value
  SVMType.Array entry _ -> case value of
    SArray values -> "[" <> T.intercalate "," (map (valueToArgTextWithType contract entry . getConst) $ V.toList values) <> "]"
    _ -> "[]"
  SVMType.UserDefined _ actual -> valueToArgTextWithType contract actual value
  _ -> valueToArgText value
  where
    renderStruct name (STuple values) =
      let fields = fromMaybe [] $ M.lookup name (contract ^. CC.structs)
          pairs = zip fields $ map getConst $ V.toList values
          render ((fieldName, fieldDef, _), fieldValue) =
            labelToText fieldName <> ":" <> valueToArgTextWithType contract (CC.fieldTypeType fieldDef) fieldValue
       in "{" <> T.intercalate "," (map render pairs) <> "}"
    renderStruct _ _ = "{}"

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

encodeEventToLog :: CC.Contract -> SolidString -> EventF a -> M.Map T.Text T.Text -> ([B.ByteString], B.ByteString)
encodeEventToLog contract evName eventDef attrs =
  let logs = _eventLogs eventDef
      allTypes = map (indexedTypeType . _eventLogType) logs
      topic0 = if _eventAnonymous eventDef then []
               else let sig = T.unpack (labelToText evName)
                            ++ "(" ++ intercalate "," (map (svmTypeToCanonicalWithContract contract) allTypes) ++ ")"
                    in [keccak256ToByteString $ hash $ BC.pack sig]
      (indexedLogs, nonIndexedLogs) = partition _eventLogIndexed logs
      indexedTopics = map (encodeIndexedLogParam contract attrs) indexedLogs
      nonIndexedTypes = map (indexedTypeType . _eventLogType) nonIndexedLogs
      nonIndexedDescriptors = map (typeDescriptorForContract contract) nonIndexedTypes
      nonIndexedValues = zipWith (parseLogParam contract attrs) nonIndexedTypes nonIndexedLogs
      nonIndexedData = case sequence nonIndexedDescriptors of
        Just descriptors -> encodeValues descriptors nonIndexedValues
        Nothing -> B.concat $ replicate (length nonIndexedLogs) (encodeUint256 0)
  in (topic0 ++ indexedTopics, nonIndexedData)

encodeIndexedLogParam :: CC.Contract -> M.Map T.Text T.Text -> EventLog -> B.ByteString
encodeIndexedLogParam contract attrs eventLog@(EventLog _ _ idxType) =
  let typ = indexedTypeType idxType
      value = parseLogParam contract attrs typ eventLog
   in case typeDescriptorForContract contract typ of
        Nothing -> encodeUint256 0
        Just descriptor
          | indexedValueIsHashed descriptor -> keccak256ToByteString $ hash $ encodeIndexedTopLevel descriptor value
          | otherwise -> encodeValues [descriptor] [value]

indexedValueIsHashed :: TypeDescriptor -> Bool
indexedValueIsHashed TBytes = True
indexedValueIsHashed TString = True
indexedValueIsHashed (TArrayOf _) = True
indexedValueIsHashed (TFixedArray _ _) = True
indexedValueIsHashed (TTuple _) = True
indexedValueIsHashed _ = False

encodeIndexedTopLevel :: TypeDescriptor -> Value -> B.ByteString
encodeIndexedTopLevel TBytes (SBytes value) = value
encodeIndexedTopLevel TString (SString value) = BC.pack value
encodeIndexedTopLevel descriptor value = encodeIndexedPreimage descriptor value

-- Solidity's indexed-event preimage omits lengths and offsets for complex
-- values; members are padded to word boundaries before hashing.
encodeIndexedPreimage :: TypeDescriptor -> Value -> B.ByteString
encodeIndexedPreimage TBytes (SBytes value) = padRight32 value
encodeIndexedPreimage TString (SString value) = padRight32 $ BC.pack value
encodeIndexedPreimage (TArrayOf entry) (SArray values) =
  B.concat $ map (encodeIndexedPreimage entry . getConst) $ V.toList values
encodeIndexedPreimage (TFixedArray entry _) (SArray values) =
  B.concat $ map (encodeIndexedPreimage entry . getConst) $ V.toList values
encodeIndexedPreimage (TTuple entries) (STuple values) =
  B.concat $ zipWith encodeIndexedPreimage entries $ map getConst $ V.toList values
encodeIndexedPreimage descriptor value = encodeValues [descriptor] [value]

parseLogParam :: CC.Contract -> M.Map T.Text T.Text -> SVMType.Type -> EventLog -> Value
parseLogParam contract attrs typ (EventLog name _ _) =
  maybe SNULL (parseEventValue contract typ) $ M.lookup name attrs

parseEventValue :: CC.Contract -> SVMType.Type -> T.Text -> Value
parseEventValue contract typ raw = case typ of
  SVMType.Int _ _ -> SInteger $ readInteger text
  SVMType.Bool -> SBool $ map toLower text == "true"
  SVMType.Address payable -> case reads text of
    [(address, rest)] | all isSpace rest -> SAddress address payable
    _ -> SNULL
  SVMType.Contract name -> case reads (dropContractPrefix text) of
    [(address, rest)] | all isSpace rest -> SContract name address
    _ -> SNULL
  SVMType.String _ -> SString text
  SVMType.Bytes _ _ -> SBytes $ decodeHexText text
  SVMType.Enum _ _ _ -> SInteger $ readEnumInteger text
  SVMType.Array entry _ ->
    let members = splitDelimited '[' ']' text
     in SArray . V.fromList . map (Constant . parseEventValue contract entry . T.pack) $ members
  SVMType.Struct _ name -> parseStruct name
  SVMType.UnknownLabel name
    | M.member name (contract ^. CC.structs) -> parseStruct name
    | M.member name (contract ^. CC.enums) -> SInteger $ readEnumInteger text
  SVMType.UserDefined _ actual -> parseEventValue contract actual raw
  _ -> SNULL
  where
    text = T.unpack $ T.strip raw
    parseStruct name =
      let fields = fromMaybe [] $ M.lookup name (contract ^. CC.structs)
          members = M.fromList $ mapMaybeField $ splitDelimited '{' '}' text
          valueFor (fieldName, fieldDef, _) =
            let fieldText = M.findWithDefault "" (labelToText fieldName) members
             in Constant $ parseEventValue contract (CC.fieldTypeType fieldDef) fieldText
       in STuple . V.fromList $ map valueFor fields

mapMaybeField :: [String] -> [(T.Text, T.Text)]
mapMaybeField = foldr step []
  where
    step member result = case break (== ':') member of
      (name, ':' : value) ->
        (stripJsonQuotes $ T.strip $ T.pack name, stripJsonQuotes $ T.strip $ T.pack value) : result
      _ -> result

    -- Cirrus serializes emitted struct attributes as an object-like string
    -- (for example, @Info{"amount": 7}@), while older rows use Solidity-like
    -- @Info{amount: 7}@ text. Accept both representations.
    stripJsonQuotes value
      | T.length value >= 2 && T.head value == '"' && T.last value == '"' = T.init $ T.tail value
      | otherwise = value

splitDelimited :: Char -> Char -> String -> [String]
splitDelimited open close input =
  let afterOpen = case dropWhile (/= open) input of
        [] -> ""
        (_ : rest) -> rest
      inside = case reverse afterOpen of
        (c : rest) | c == close -> reverse rest
        _ -> afterOpen
   in if null inside then [] else splitTopLevel inside

splitTopLevel :: String -> [String]
splitTopLevel = reverse . finish . go (0 :: Int) "" []
  where
    finish (current, result) = reverse current : result
    go _ current result [] = (current, result)
    go depth current result (c : cs)
      | c == ',' && depth == 0 = go depth "" (trim (reverse current) : result) cs
      | c `elem` ("([{" :: String) = go (depth + 1) (c : current) result cs
      | c `elem` (")]}" :: String) = go (max 0 $ depth - 1) (c : current) result cs
      | otherwise = go depth (c : current) result cs
    trim = reverse . dropWhile isSpace . reverse . dropWhile isSpace

decodeHexText :: String -> B.ByteString
decodeHexText input =
  let noPrefix = fromMaybe input $ stripPrefix "0x" input
      noLiteral = case stripPrefix "hex\"" noPrefix of
        Just value | not (null value), last value == '"' -> init value
        _ -> noPrefix
   in either (const B.empty) id $ B16.decode $ BC.pack noLiteral

readInteger :: String -> Integer
readInteger input = case reads input of
  [(value, rest)] | all isSpace rest -> value
  _ -> 0

readEnumInteger :: String -> Integer
readEnumInteger input =
  let numeric = case dropWhile (/= '=') input of
        '=' : rest -> takeWhile (\c -> c /= ')' && not (isSpace c)) $ dropWhile isSpace rest
        _ -> input
   in case stripPrefix "0x" numeric of
        Just hexValue -> case readHex hexValue of
          [(value, "")] -> value
          _ -> 0
        Nothing -> readInteger numeric

dropContractPrefix :: String -> String
dropContractPrefix input = case break (== '/') input of
  (_, '/' : address) -> address
  _ -> input

stripPrefix :: Eq a => [a] -> [a] -> Maybe [a]
stripPrefix [] ys = Just ys
stripPrefix _ [] = Nothing
stripPrefix (x : xs) (y : ys)
  | x == y = stripPrefix xs ys
  | otherwise = Nothing

findEventDef :: CC.CodeCollection -> SolidString -> Maybe (CC.Contract, CC.Event)
findEventDef cc evName =
  case concatMap (\(_, contract) -> maybe [] (\eventDef -> [(contract, eventDef)]) $ M.lookup evName (CC._events contract)) (M.toList $ CC._contracts cc) of
    (hit : _) -> Just hit
    []       -> Nothing
