{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingVia #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}

{-# OPTIONS -fno-warn-incomplete-uni-patterns #-}
{-# OPTIONS_GHC -fno-warn-orphans #-} -- Store [ByteString]

module SolidVM.Model.Storable where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Control.Applicative ((<|>))
import Control.DeepSeq
import Control.Exception
import Control.Lens.Operators
import Control.Monad (replicateM)
import qualified Data.Aeson as JSON
import Data.Attoparsec.ByteString as Atto
import Data.Attoparsec.ByteString.Char8 (scientific)
import Data.Binary
import Data.Bool (bool)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.UTF8 as UTF8
import qualified Data.ByteString.Unsafe as BU
import Data.Char
import Data.Hashable
import Data.List (foldl')
import Data.Map.Strict (Map)
import qualified Data.Map.Internal as MI
import qualified Data.Map.Strict as Map
import Data.Maybe
import qualified Data.OpenApi as OPENAPI
import Data.Scientific (isInteger, toBoundedInteger)
import qualified Data.Sequence as Seq
import Data.Store (Peek, Size (..), Store (..))
import Data.Store.Core (Poke (..), pokeStatePtr)
import Data.Store.Internal (getSize, peekOrdMapWith)
import Data.String
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, decodeUtf8', encodeUtf8)
import qualified Data.Vector as V
import qualified Database.Esqueleto.Internal.Internal as E
import Database.Persist.Sql
import Foreign.Marshal.Utils (copyBytes)
import Foreign.Ptr
import Foreign.Storable (peekByteOff, pokeByteOff)
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
        ("([a-zA-Z0-9_]+)\\.([a-zA-Z0-9_]+)\\.([0-9]+)", \[enumName, enumValName, enumValNum] -> BEnumVal (stringToLabel enumName) (stringToLabel enumValName) <$> readMaybe enumValNum),
        ("([a-zA-Z0-9_]+)\\(([a-zA-Z0-9\\:]+)\\)", \[contractName, accountString] -> Just $ BContract (stringToLabel contractName) $ read accountString),
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
  parseJSON (JSON.String v) = either fail pure $ storageKeyToPath v
  parseJSON v = error $ "wrong format in call to parseJSON for StoragePath: " ++ show v

instance JSON.ToJSONKey StoragePath where

instance JSON.ToJSON StoragePath where
  toJSON = JSON.String . pathToStorageKey

instance Binary StoragePath where

instance PersistField StoragePath where
  toPersistValue = PersistText . pathToStorageKey
  fromPersistValue v = do
    text <- fromPersistValue v
    either (Left . T.pack) Right $ storageKeyToPath text

instance PersistFieldSql StoragePath where
  sqlType _ = SqlString

instance E.SqlString StoragePath where

instance ToHttpApiData StoragePath where
  toUrlPiece = pathToStorageKey

instance FromHttpApiData StoragePath where
  parseUrlPiece v =
    case storageKeyToPath v of
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

rawPathPiece :: StoragePathPiece -> (Bool, B.ByteString)
rawPathPiece (Field f) = (True, f)
rawPathPiece (Index i) = (False, i)

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

escapeKey :: B.ByteString -> B.ByteString
escapeKey srcBS = unsafePerformIO $ do
  let len = B.length srcBS
  BI.createAndTrim (2 * len) $ \dst ->
    BU.unsafeUseAsCString srcBS $ \src' -> do
      let src = castPtr src'
          copyAndEscape :: Int -> Int -> IO Int
          copyAndEscape !dstOff !srcOff =
            if srcOff >= len
              then return dstOff
              else do
                ch <- peekByteOff src srcOff :: IO Word8
                if ch /= 0x5c && ch /= 0x5d
                  then do
                    pokeByteOff dst dstOff ch
                    copyAndEscape (dstOff + 1) (srcOff + 1)
                  else do
                    pokeByteOff dst dstOff (0x5c :: Word8)
                    pokeByteOff dst (dstOff + 1) ch
                    copyAndEscape (dstOff + 2) (srcOff + 1)
      copyAndEscape 0 0

unescapeKey :: B.ByteString -> B.ByteString
unescapeKey srcBS = unsafePerformIO $ do
  let len = B.length srcBS
  BI.createAndTrim len $ \dst ->
    BU.unsafeUseAsCString srcBS $ \src' -> do
      let src = castPtr src'
          copyAndUnescape :: Int -> Int -> IO Int
          copyAndUnescape !dstOff !srcOff =
            if len - srcOff > 1
              then do
                ch <- peekByteOff src srcOff :: IO Word8
                if ch == 0x5c
                  then do
                    ch' <- peekByteOff src (srcOff + 1) :: IO Word8
                    pokeByteOff dst dstOff ch'
                    copyAndUnescape (dstOff + 1) (srcOff + 2)
                  else do
                    pokeByteOff dst dstOff ch
                    copyAndUnescape (dstOff + 1) (srcOff + 1)
              else
                if len - srcOff == 1
                  then do
                    ch <- peekByteOff src srcOff :: IO Word8
                    pokeByteOff dst dstOff ch
                    copyAndUnescape (dstOff + 1) (srcOff + 1)
                  else return dstOff
      copyAndUnescape 0 0

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

-- SQL text cannot contain NUL, and mapping indexes need not be UTF-8.
-- Keep field names visible for storage searches; tag binary indexes reversibly.
-- Raw trie/Binary encoding is unchanged.
pathToStorageKey :: StoragePath -> Text
pathToStorageKey (StoragePath pieces) = decodeUtf8 . unparsePath . StoragePath $ map encodeIndex pieces
  where
    encodeIndex (Index raw)
      | not (B.all (\w -> w >= 0x20 && w < 0x7f) raw) || "~hex:" `B.isPrefixOf` raw =
          Index $ "~hex:" <> B16.encode raw
    encodeIndex piece = piece

basicToStorageValue :: BasicValue -> Text
basicToStorageValue = T.pack . format

storageKeyToPath :: Text -> Either String StoragePath
storageKeyToPath text = do
  StoragePath pieces <- parsePath $ encodeUtf8 text
  StoragePath <$> traverse decodeIndex pieces
  where
    decodeIndex (Index raw) | Just hex <- B.stripPrefix "~hex:" raw = Index <$> B16.decode hex
    decodeIndex piece = Right piece

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

-- ---------------------------------------------------------------------------
-- Store instances
--
-- Actions go to the slipstream as their Store encoding (Blockchain.Stream.Action). The
-- derived instances are store's own; the container and byte encodings below replace
-- store's generic ones for the concrete types on that path, with the same wire layout:
--
--   * store writes every container through one generic fold that threads the offset
--     through the Poke monad per element, which GHC cannot flatten, so each element
--     costs a boxed offset. These loops carry the offset as a plain accumulator.
--   * store copies bytes under 'withForeignPtr' (a keepAlive# frame per copy). These use
--     'unsafeWithForeignPtr', which is safe for a single non-diverging memcpy.
--
-- store's own container instances cannot be replaced wholesale (same instance head), only
-- overlapped per concrete type, so each container type on the path gets one line:
--
-- > deriving via (StoreList Value) instance {-# OVERLAPPING #-} Store [Value]
--
-- The newtype pokes are written as lambdas (@poke = \(StoreList xs) -> ...@), not clauses:
-- the derived instance applies them to the dictionary alone, and an INLINE method is only
-- inlined when saturated. As clauses they stay out-of-line generic loops (+0.08 s, +0.6 GB).
--
-- The derived pokes for BasicValue and Value still allocate ~60-80 B per value (a thunk
-- for `from x`, the returned Poke closure and a boxed (Offset, ()) result): GHC treats
-- these large recursive writers as loop breakers, so INLINE has no effect. Measured at
-- ~0.6 GB per recorded stream with no time difference, so left as is; a writer returning
-- a bare offset (PokeState -> Offset -> IO Offset) instead of a Poke would avoid it.

instance Store BasicValue

peekElems :: Store a => Peek [a]
peekElems = do n <- peek :: Peek Int; replicateM n peek
{-# INLINE peekElems #-}

newtype StoreList a = StoreList [a]

instance Store a => Store (StoreList a) where
  size = VarSize (\(StoreList xs) -> foldl' (\n x -> n + getSize x) 8 xs)
  poke = \(StoreList xs) -> Poke $ \ps o0 -> do
    (o1, ()) <- runPoke (poke (length xs)) ps o0
    let go [] !o = pure (o, ())
        go (x : rest) !o = do (o2, ()) <- runPoke (poke x) ps o; go rest o2
    go xs o1
  peek = StoreList <$> peekElems
  {-# INLINE size #-}
  {-# INLINE poke #-}
  {-# INLINE peek #-}

newtype StoreSeq a = StoreSeq (Seq.Seq a)

instance Store a => Store (StoreSeq a) where
  size = VarSize (\(StoreSeq xs) -> foldl' (\n x -> n + getSize x) 8 xs)
  poke = \(StoreSeq xs) -> Poke $ \ps o0 -> do
    (o1, ()) <- runPoke (poke (Seq.length xs)) ps o0
    o2 <- foldr (\x k !o -> do (o3, ()) <- runPoke (poke x) ps o; k o3) pure xs o1
    pure (o2, ())
  peek = StoreSeq . Seq.fromList <$> peekElems
  {-# INLINE size #-}
  {-# INLINE poke #-}
  {-# INLINE peek #-}

newtype StoreVector a = StoreVector (V.Vector a)

instance Store a => Store (StoreVector a) where
  size = VarSize (\(StoreVector xs) -> V.foldl' (\n x -> n + getSize x) 8 xs)
  poke = \(StoreVector xs) -> Poke $ \ps o0 -> do
    (o1, ()) <- runPoke (poke (V.length xs)) ps o0
    o2 <- V.foldM' (\o x -> do (o3, ()) <- runPoke (poke x) ps o; pure o3) o1 xs
    pure (o2, ())
  peek = StoreVector . V.fromList <$> peekElems
  {-# INLINE size #-}
  {-# INLINE poke #-}
  {-# INLINE peek #-}

-- Same layout as store's Map: ascending-order marker, count, then key/value pairs in order.
-- The marker is store's unexported 'markMapPokedInAscendingOrder'; 'peekOrdMapWith' checks it.
mapAscendingMarker :: Word32
mapAscendingMarker = 1217678090

newtype StoreMap k v = StoreMap (Map k v)

instance (Store k, Store v) => Store (StoreMap k v) where
  size = VarSize (\(StoreMap m) -> go m 12)
    where
      go MI.Tip !n = n
      go (MI.Bin _ k v l r) !n = go r (go l n + getSize k + getSize v)
  poke = \(StoreMap m) -> Poke $ \ps o0 -> do
    (o1, ()) <- runPoke (poke mapAscendingMarker >> poke (Map.size m)) ps o0
    let go MI.Tip !o = pure o
        go (MI.Bin _ k v l r) !o = do
          oa <- go l o
          (ob, ()) <- runPoke (poke k) ps oa
          (oc, ()) <- runPoke (poke v) ps ob
          go r oc
    o2 <- go m o1
    pure (o2, ())
  peek = StoreMap <$> peekOrdMapWith Map.fromDistinctAscList
  {-# INLINE size #-}
  {-# INLINE poke #-}
  {-# INLINE peek #-}

-- | Length-prefixed bytes, as store writes a ByteString.
bytesPoke :: B.ByteString -> Poke ()
bytesPoke (BI.BS fp len) = Poke $ \ps o0 -> do
  (o1, ()) <- runPoke (poke len) ps o0
  BI.unsafeWithForeignPtr fp $ \src -> copyBytes (pokeStatePtr ps `plusPtr` o1) src len
  pure (o1 + len, ())
{-# INLINE bytesPoke #-}

instance {-# OVERLAPPING #-} Store [B.ByteString] where
  size = VarSize (foldl' (\n b -> n + 8 + B.length b) 8)
  poke xs = Poke $ \ps o0 -> do
    (o1, ()) <- runPoke (poke (length xs)) ps o0
    let go [] !o = pure (o, ())
        go (b : rest) !o = do (o2, ()) <- runPoke (bytesPoke b) ps o; go rest o2
    go xs o1
  peek = peekElems

-- Same layout as the derived instance: Word8 tag, then length-prefixed bytes.
instance Store StoragePathPiece where
  size = VarSize (\p -> case p of Field b -> 9 + B.length b; Index b -> 9 + B.length b)
  poke (Field b) = poke (0 :: Word8) >> bytesPoke b
  poke (Index b) = poke (1 :: Word8) >> bytesPoke b
  peek =
    (peek :: Peek Word8) >>= \case
      0 -> Field <$> peek
      1 -> Index <$> peek
      t -> fail ("StoragePathPiece: bad tag " ++ show t)

deriving via (StoreList StoragePathPiece) instance {-# OVERLAPPING #-} Store [StoragePathPiece]

instance Store StoragePath
