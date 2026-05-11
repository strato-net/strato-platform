{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}

{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}

module SolidVM.Model.Storable where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Control.Applicative ((<|>))
import Control.DeepSeq
import Control.Exception
import Control.Lens.Operators
import qualified Data.Aeson as JSON
import Data.Attoparsec.ByteString as Atto
import Data.Attoparsec.ByteString.Char8 (scientific)
import Data.Binary
import Data.Bool (bool)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.UTF8 as UTF8
import Data.Char
import Data.Hashable
import Data.Maybe
import qualified Data.OpenApi as OPENAPI
import Data.Scientific (isInteger, toBoundedInteger)
import Data.String
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, decodeUtf8', encodeUtf8)
import qualified Database.Esqueleto.Internal.Internal as E
import Database.Persist.Sql
import GHC.Generics
import SolidVM.Model.SolidString
import System.IO.Unsafe
import Text.Format
import Text.Read
import Text.Regex.TDFA
import Servant

data BasicValue
  = BInteger !Integer
  | BString !B.ByteString
  | BBytes !B.ByteString  -- Raw bytes (bytes, bytesN) - distinct from BString
  | BDecimal !B.ByteString
  | BBool !Bool
  | BAddress !Address
  | BEnumVal !SolidString !SolidString !Word32
  | BContract !SolidString !Address
  | BDefault -- Indicates a not present value
  deriving (Show, Read, Eq, Ord, Generic, NFData, Hashable, Binary)

instance IsString BasicValue where
  fromString s = BString $ C8.pack s

instance PersistField BasicValue where
  toPersistValue = toPersistValue . formatBasicValue
  fromPersistValue v =
    case fromPersistValue v of
      Left e -> Left e
      Right theString ->
        case basicParse theString of
          Nothing -> Left $ T.pack $ "malformed value string in call to fromPersistValue: " ++ show theString
          Just theBasicValue -> Right theBasicValue

instance PersistFieldSql BasicValue where
  sqlType _ = SqlString

instance E.SqlString BasicValue where

instance ToHttpApiData BasicValue where
  toUrlPiece = T.pack . formatBasicValue

instance FromHttpApiData BasicValue where
  parseUrlPiece v =
    case basicParse $ T.unpack v of
      Nothing -> Left $ T.pack $ "malformed value string in call to parseUrlPiece: " ++ show v
      Just theBasicValue -> Right theBasicValue

instance OPENAPI.ToParamSchema BasicValue where
  toParamSchema _ =
      mempty
        & OPENAPI.type_   ?~ OPENAPI.OpenApiString
        & OPENAPI.format  ?~ "simple SolidVM expression"

instance OPENAPI.ToSchema BasicValue where
  declareNamedSchema _ =
    pure $ OPENAPI.NamedSchema (Just "BasicValue") $
      mempty
        & OPENAPI.type_        ?~ OPENAPI.OpenApiString
        & OPENAPI.format       ?~ "simple SolidVM expression"

instance JSON.ToJSON BasicValue where
  toJSON v = JSON.toJSON $ format v

instance JSON.FromJSON BasicValue where
  parseJSON v =
    fmap readOrError $ JSON.parseJSON v
    where
      readOrError theString =
        case basicParse theString of
          Just theBasicValue -> theBasicValue
          Nothing -> error $ "in parseJSON for BasicValue, basicParse fails for: " ++ show theString

basicParse :: String -> Maybe BasicValue
basicParse input =
  case readMaybe input of
    Just val -> return $ BString val
    Nothing -> foldr tryMatch Nothing patterns
  where
    tryMatch :: (String, [String] -> Maybe BasicValue) -> Maybe BasicValue -> Maybe BasicValue
    tryMatch (regex, constructor) acc =
                case input =~ regex :: [[String]] of
                          [_:matches] -> constructor matches
                          _ -> acc
    patterns :: [(String, [String] -> Maybe BasicValue)]
    patterns =
      [
        ("false", \[] -> Just $ BBool False),
        ("true", \[] -> Just $ BBool True),
        ("address\\(([a-zA-Z0-9\\:]+)\\)", \[accountString] -> Just $ BAddress $ read accountString),
        ("([a-zA-Z0-9_]+)\\.([a-zA-Z0-9_]+)\\.([0-9]+)", \[enumName, enumValName, enumValNum] -> BEnumVal enumName enumValName <$> readMaybe enumValNum),
        ("([a-zA-Z0-9_]+)\\(([a-zA-Z0-9\\:]+)\\)", \[contractName, accountString] -> Just $ BContract contractName $ read accountString),
        ("([0-9]+)", \[numString] -> Just $ BInteger $ read numString),
        ("(\"([^\"\\\\]|\\.)*\")", \[theString, _] -> Just $ BString $ encodeUtf8 . T.pack $ fromMaybe (error $ "can't read " ++ show theString) $ readMaybe theString)
      ]

textToBasicValue :: Text -> BasicValue
textToBasicValue v =
  let v' = fromMaybe (BString $ encodeUtf8 v)
           $ (bool Nothing (Just $ BBool True) $ T.toLower v == "true")
         <|> (bool Nothing (Just $ BBool False) $ T.toLower v == "false")
         <|> (BInteger <$> readMaybe (T.unpack v))
         <|> (BAddress <$> readMaybe (T.unpack v))
         <|> (case T.split (=='.') v of [a,b,c] -> BEnumVal (textToLabel a) (textToLabel b) <$> readMaybe (T.unpack c); _ -> Nothing)
   in if isDefault v' then BDefault else v'

isDefault :: BasicValue -> Bool
isDefault (BInteger i) = i == 0
isDefault (BString bs) = B.null bs
isDefault (BBytes bs) = B.null bs
isDefault (BDecimal v) = v == "0"
isDefault (BBool b) = not b
isDefault (BAddress a) = a == 0x0
isDefault (BEnumVal _ _ w) = w == 0
isDefault (BContract _ a) = a == 0x0
isDefault BDefault = True

formatBasicValue :: BasicValue -> String
formatBasicValue (BInteger i) = show i
formatBasicValue (BString s) = show $ UTF8.toString s
formatBasicValue (BBytes bs) = "hex\"" ++ C8.unpack (B16.encode bs) ++ "\""
formatBasicValue (BDecimal v) = show v
formatBasicValue (BBool True) = "true"
formatBasicValue (BBool False) = "false"
formatBasicValue (BAddress a) = "address(" ++ show a ++ ")"
formatBasicValue (BEnumVal n1 n2 w) = labelToString n1 ++ "." ++ labelToString n2 ++ "." ++ show w
formatBasicValue (BContract n a) = labelToString n ++ "(" ++ show a ++ ")"
formatBasicValue BDefault = "<unknown>"

instance Format BasicValue where
  format (BString s) = ('"' :) . (++ "\"") $ UTF8.toString s
  format (BBytes bs) = ("hex\"" ++) . (++ "\"") $ C8.unpack (B16.encode bs)
  format bv          = formatBasicValue bv

formatBasicValueForSQL :: BasicValue -> Text
formatBasicValueForSQL (BInteger i) = T.pack $ show i
formatBasicValueForSQL (BString s) = either (const . T.pack $ C8.unpack s) id $ decodeUtf8' s
formatBasicValueForSQL (BBytes bs) = decodeUtf8 $ B16.encode bs
formatBasicValueForSQL (BDecimal v) = T.pack $ show v
formatBasicValueForSQL (BBool True) = "true"
formatBasicValueForSQL (BBool False) = "false"
formatBasicValueForSQL (BAddress a) = T.pack $ show a
formatBasicValueForSQL (BEnumVal n1 n2 w) = labelToText n1 <> "." <> labelToText n2 <> "." <> T.pack (show w)
formatBasicValueForSQL (BContract _ a) = T.pack $ show a
formatBasicValueForSQL BDefault = ""

data StoragePathPiece
  = Field B.ByteString
  | Index B.ByteString
  deriving (Eq, Ord, Show, Read, Generic, NFData, Hashable)

instance Format StoragePathPiece where
  format (Field n) = C8.unpack n
  format (Index i) = "[" ++ C8.unpack i ++ "]"

instance Binary StoragePathPiece

newtype StoragePath = StoragePath [StoragePathPiece] deriving (Eq, Ord, Show, Read, Generic, NFData, Hashable)

instance IsString StoragePath where
  fromString s = either (error ("error parsing String to StoragePath: " ++ s)) id . parsePath . C8.pack $ s

instance Format StoragePath where
  format (StoragePath []) = "<empty path>"
  format (StoragePath (first : rest)) =
    format first ++ unwords (map (addConditionalDot . format) rest)
    where
      addConditionalDot :: String -> String
      addConditionalDot w@(c1 : _) | isAlpha c1 = "." ++ w
      addConditionalDot w = w

instance JSON.FromJSON StoragePath where
  parseJSON (JSON.String v) = return $ either (error . (("malformed StoragePath: " ++ show v ++ "\n") ++)) id $ parsePath $ encodeUtf8 v
  parseJSON v = error $ "wrong format in call to parseJSON for StoragePath: " ++ show v

instance JSON.ToJSONKey StoragePath where

instance JSON.ToJSON StoragePath where
  toJSON v = JSON.String $ decodeUtf8 $ unparsePath v

instance Binary StoragePath where

instance PersistField StoragePath where
  toPersistValue = toPersistValue . C8.unpack . unparsePath
  fromPersistValue v =
    case fromPersistValue v of
      Left e -> Left e
      Right theString ->
        case parsePath theString of
          Left e -> Left $ T.pack $ "malformed value string in call to fromPersistValue: " ++ show theString ++ "\n" ++ e
          Right theStoragePath -> Right theStoragePath

instance PersistFieldSql StoragePath where
  sqlType _ = SqlString

instance E.SqlString StoragePath where

instance ToHttpApiData StoragePath where
  toUrlPiece = decodeUtf8 . unparsePath

instance FromHttpApiData StoragePath where
  parseUrlPiece v =
    case parsePath $ encodeUtf8 v of
      Left e -> Left $ T.pack $ "malformed value string in call to parseUrlPiece: " ++ show v ++ "\n" ++ e
      Right theStoragePath -> Right theStoragePath

instance OPENAPI.ToParamSchema StoragePath where
  toParamSchema _ =
      mempty
        & OPENAPI.type_   ?~ OPENAPI.OpenApiString
        & OPENAPI.format  ?~ "Path to SolidVM storage location"

instance OPENAPI.ToSchema StoragePath where
  declareNamedSchema _ =
    pure $ OPENAPI.NamedSchema (Just "StoragePath") $
      mempty
        & OPENAPI.type_        ?~ OPENAPI.OpenApiString
        & OPENAPI.format       ?~ "Path to SolidVM storage location"

empty :: StoragePath
empty = StoragePath []

singleton :: B.ByteString -> StoragePath
singleton bs = StoragePath [Field bs]

getField :: StoragePath -> Either String B.ByteString
getField (StoragePath (Field f : _)) = Right f
getField path = Left $ "StoragePath must begin with field: " ++ show path

snoc :: StoragePath -> StoragePathPiece -> StoragePath
snoc (StoragePath p) piece = StoragePath $ p ++ [piece]

snocList :: StoragePath -> [StoragePathPiece] -> StoragePath
snocList (StoragePath p) pieces = StoragePath $ p ++ pieces

toList :: StoragePath -> [StoragePathPiece]
toList (StoragePath p) = p

fromList :: [StoragePathPiece] -> StoragePath
fromList = StoragePath

size :: StoragePath -> Int
size (StoragePath p) = length p

last :: StoragePath -> StoragePathPiece
last (StoragePath p) = Prelude.last p

type StorageDelta = [(StoragePath, BasicValue)]

parseInteger :: Parser Integer
parseInteger = do
  sci <- scientific
  if (isInteger sci)
    then return . round $ sci
    else fail "fractional found for integer"

parseInt :: Parser Int
parseInt = do
  sci <- scientific
  case toBoundedInteger sci of
    Nothing -> fail "int overflow"
    Just i -> return i

pathParser :: Parser [StoragePathPiece]
pathParser = do
  ( do
      n <- Atto.takeWhile1 (inClass "_a-zA-Z0-9")
      (Field n :) <$> pathParser'
    )
    <|> endOfInput *> return []

pathParser' :: Parser [StoragePathPiece]
pathParser' = do
  ch <- fmap w82c <$> peekWord8
  case ch of
    Nothing -> return []
    Just '.' -> parseField
    Just '[' -> parseIndex
    _ -> fail "unexpected character for next field"

c2w8 :: Char -> Word8
c2w8 = fromIntegral . ord

w82c :: Word8 -> Char
w82c = chr . fromIntegral

parseIndex :: Parser [StoragePathPiece]
parseIndex = do
  skip (== c2w8 '[')
  let ignoreEscapedClosingBracket False 0x5d = Nothing -- Unescaped closing bracket
      ignoreEscapedClosingBracket False 0x5c = Just True -- Begin of escape sequence
      ignoreEscapedClosingBracket _ _ = Just False
  idx <- scan False ignoreEscapedClosingBracket
  skip (== c2w8 ']')
  (Index (unescapeKey idx) :) <$> pathParser'

parseField :: Parser [StoragePathPiece]
parseField = do
  skip (== c2w8 '.')
  ( do
      n <- Atto.takeWhile1 (inClass "_a-zA-Z0-9")
      (Field n :) <$> pathParser'
    )

parsePath :: B.ByteString -> Either String StoragePath
parsePath = fmap StoragePath . parseOnly pathParser

-- | Escape a mapping-index payload so the resulting bytes are safe to
--   round-trip through the storage table's `key` column. The column
--   is a Postgres TEXT (UTF-8); any non-ASCII / non-printable byte
--   would be lossy across the Haskell `String` ↔ `Text` ↔ wire path
--   that PersistField StoragePath uses.
--
--   Output alphabet is pure ASCII printable characters (0x20..0x7E),
--   minus the closing-bracket terminator. Encoding rules:
--
--     * 0x5C  ('\\')                  → "\\\\"
--     * 0x5D  (']')                   → "\\]"
--     * 0x20..0x7E (printable ASCII)  → byte itself
--     * everything else               → "\\x" ++ two-hex-digit byte
--
--   The new "\\xHH" form is forward-compatible because the old
--   escapeKey only ever emitted "\\\\" or "\\]" — no existing key
--   contains a literal "\\x" sequence.
escapeKey :: B.ByteString -> B.ByteString
escapeKey = B.concatMap escapeByte
  where
    escapeByte :: Word8 -> B.ByteString
    escapeByte 0x5C = B.pack [0x5C, 0x5C]                 -- \   -> \\
    escapeByte 0x5D = B.pack [0x5C, 0x5D]                 -- ]   -> \]
    escapeByte b
      | b >= 0x20 && b <= 0x7E = B.singleton b            -- printable ASCII
      | otherwise              = B.pack [0x5C, 0x78] <> B16.encode (B.singleton b)
                                                          -- non-ASCII -> \xHH

-- | Inverse of {escapeKey}. Recognises the legacy "\\\\" / "\\]"
--   escapes and the new "\\xHH" hex escape; any other "\\X" sequence
--   collapses to literal X (matches the prior implementation's
--   behaviour for bytes that happened to be paired with a stray
--   backslash).
unescapeKey :: B.ByteString -> B.ByteString
unescapeKey = go
  where
    go :: B.ByteString -> B.ByteString
    go bs = case B.uncons bs of
      Nothing -> B.empty
      Just (0x5C, rest) -> case B.uncons rest of
        -- Trailing lone backslash — keep verbatim. (Mirrors the
        -- previous unsafe-IO implementation's "len - srcOff == 1"
        -- branch.)
        Nothing -> B.singleton 0x5C
        Just (0x78, rest1)                                 -- "\xHH"
          | B.length rest1 >= 2,
            (hex, rest2) <- B.splitAt 2 rest1,
            Right b <- B16.decode hex
            -> b <> go rest2
        Just (c, rest1) -> B.singleton c <> go rest1       -- "\X" -> X
      Just (c, rest) -> B.singleton c <> go rest

unparsePath :: StoragePath -> B.ByteString
unparsePath (StoragePath []) = B.empty
unparsePath (StoragePath (Field p : rest)) =
  B.concat (p : concatMap go rest)
  where
    go :: StoragePathPiece -> [B.ByteString]
    go (Field q) = [".", q]
    go (Index i) = ["[", escapeKey i, "]"]
unparsePath v = error $ "StoragePath must always start with a Field: " ++ show v

instance RLPSerializable BasicValue where
  rlpEncode = \case
    BDefault -> RLPString ""
    BInteger n -> RLPArray [RLPScalar 0, rlpEncode n]
    BString t -> RLPArray [RLPScalar 1, rlpEncode t]
    BBool b -> RLPArray [RLPScalar 2, rlpEncode b]
    BAddress a -> RLPArray [RLPScalar 3, rlpEncode a]
    BContract n a -> RLPArray [RLPScalar 4, rlpEncode n, rlpEncode a]
    BEnumVal a b c -> RLPArray [RLPScalar 5, rlpEncode a, rlpEncode b, rlpEncode c]
    BDecimal v -> RLPArray [RLPScalar 7, rlpEncode v]
    BBytes bs -> RLPArray [RLPScalar 8, rlpEncode bs]
  rlpDecode x@(RLPArray ((RLPScalar t) : s)) =
    case (t, s) of
      (0, [f]) -> BInteger $ rlpDecode f
      (1, [f]) -> BString $ rlpDecode f
      (2, [f]) -> BBool $ rlpDecode f
      (3, [f]) -> BAddress $ rlpDecode f
      (4, [f, a']) -> BContract (rlpDecode f) (rlpDecode a')
      (5, [f, s', c']) -> BEnumVal (rlpDecode f) (rlpDecode s') (rlpDecode c')
      (7, [f]) -> BDecimal (rlpDecode f)
      (8, [f]) -> BBytes $ rlpDecode f
      _ -> error $ "invalid type or data length for BasicValue: " ++ show x
  rlpDecode (RLPString "") = BDefault
  rlpDecode x = error $ "invalid shape for BasicValue: " ++ show x

pathToStorageKey :: StoragePath -> Text
pathToStorageKey = decodeUtf8 . unparsePath

basicToStorageValue :: BasicValue -> Text
basicToStorageValue = T.pack . format

storageKeyToPath :: Text -> Either String StoragePath
storageKeyToPath = parsePath . encodeUtf8

storageValueByteStringToBasic :: B.ByteString -> Either String BasicValue
storageValueByteStringToBasic bs =
  unsafeDupablePerformIO . handle handler
    . evaluate
    . force
    . Right
    . rlpDecode
    . rlpDeserialize
    $ bs
  where
    handler :: SomeException -> IO (Either String BasicValue)
    handler = return . Left . show

storageValueToText :: BasicValue -> Text
storageValueToText = formatBasicValueForSQL
