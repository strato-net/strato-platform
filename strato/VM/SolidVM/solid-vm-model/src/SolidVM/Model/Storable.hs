{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Model.Storable where

import Blockchain.Data.RLP
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Control.Applicative ((<|>))
import Control.DeepSeq
import Control.Exception
import Data.Attoparsec.ByteString as Atto
import Data.Attoparsec.ByteString.Char8 (scientific)
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.UTF8 as UTF8
import qualified Data.ByteString.Unsafe as BU
import Data.Char
import Data.Hashable
import Data.Scientific (isInteger, toBoundedInteger)
import Foreign.Ptr
import Foreign.Storable
import GHC.Generics
import qualified LabeledError
import SolidVM.Model.SolidString
import System.IO.Unsafe
import Text.Format

data BasicValue
  = BInteger !Integer
  | BString !B.ByteString
  | BDecimal !B.ByteString
  | BBool !Bool
  | BAccount !NamedAccount
  | BEnumVal !SolidString !SolidString !Word32
  | BContract !SolidString !NamedAccount
  | -- The sole purpose of this sentinel is to make slipstream reserve
    -- a column for this mapping
    BMappingSentinel
  | BDefault -- Indicates a not present value
  deriving (Show, Eq, Generic, NFData, Hashable, Binary)

isDefault :: BasicValue -> Bool
isDefault (BInteger i) = i == 0
isDefault (BString bs) = B.null bs
isDefault (BDecimal v) = v == "0"
isDefault (BBool b) = not b
isDefault (BAccount a) = a == unspecifiedChain 0x0
isDefault (BEnumVal _ _ w) = w == 0
isDefault (BContract _ a) = a == unspecifiedChain 0x0
isDefault BMappingSentinel = False
isDefault BDefault = True

instance Format BasicValue where
  format (BInteger i) = show i
  format (BString s) = ('"' :) . (++ "\"") $ UTF8.toString s
  format (BDecimal v) = show v
  format (BBool True) = "true"
  format (BBool False) = "false"
  format (BAccount a) = "account(" ++ show a ++ ")"
  format (BEnumVal n1 n2 _) = labelToString n1 ++ "." ++ labelToString n2
  format (BContract n a) = labelToString n ++ "(" ++ format a ++ ")"
  format BMappingSentinel = "<MappingSentinel>"
  format BDefault = "<unknown>"
--function that gives index type, wrap in map index 
data IndexType
  = INum Integer
  | IText B.ByteString
  | IBool Bool
  | IAccount NamedAccount
  deriving (Eq, Show, Ord, Generic, Hashable, NFData)

data StoragePathPiece
  = Field B.ByteString
  | MapIndex IndexType
  | ArrayIndex Int
  deriving (Eq, Show, Generic, NFData, Hashable)

instance Format StoragePathPiece where
  format (Field n) = C8.unpack n
  format (MapIndex i) = "[" ++ show i ++ "]"
  format (ArrayIndex i) = "[" ++ show i ++ "]"

newtype StoragePath = StoragePath [StoragePathPiece] deriving (Eq, Show, Generic, NFData, Hashable)

instance Format StoragePath where
  format (StoragePath []) = "<empty path>"
  format (StoragePath (first : rest)) =
    format first ++ unwords (map (addConditionalDot . format) rest)
    where
      addConditionalDot :: String -> String
      addConditionalDot w@(c1 : _) | isAlpha c1 = "." ++ w
      addConditionalDot w = w

empty :: StoragePath
empty = StoragePath []

singleton :: B.ByteString -> StoragePath
singleton bs = StoragePath [Field bs]

getField :: StoragePath -> B.ByteString
getField (StoragePath (Field f : _)) = f
getField path = error "StoragePath must begin with field" path

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
  ch <- fmap w82c <$> peekWord8
  case ch of
    Nothing -> return []
    Just '.' -> parseField
    Just '[' -> parseArrayIndex
    Just '<' -> parseMapIndex
    _ -> fail "unexpected character for next field"

c2w8 :: Char -> Word8
c2w8 = fromIntegral . ord

w82c :: Word8 -> Char
w82c = chr . fromIntegral

parseArrayIndex :: Parser [StoragePathPiece]
parseArrayIndex = do
  skip (== c2w8 '[')
  idx <- parseInt
  skip (== c2w8 ']')
  (ArrayIndex idx :) <$> pathParser

parseMapIndex :: Parser [StoragePathPiece]
parseMapIndex = do
  skip (== c2w8 '<')
  nextChar <- peekWord8'
  idx <- case w82c nextChar of
    't' -> string "true" >> return (IBool True)
    'f' -> string "false" >> return (IBool False)
    'a' -> do
      _ <- string "a:"
      eAddress <- addressFromHex <$> Atto.take 40
      mColon <- peekWord8
      mChain <- case w82c <$> mColon of
        Just ':' -> do
          _ <- string ":"
          (MainChain <$ string "main") <|> (ExplicitChain . bytesToWord256 . LabeledError.b16Decode "parseMapIndex" <$> Atto.take 64) <?> "parseMapIndex"
        _ -> pure UnspecifiedChain
      IAccount <$> either fail (return . flip NamedAccount mChain) eAddress
    '"' -> do
      skip (== c2w8 '"')
      let ignoreEscapedQuotes False 0x22 = Nothing -- Unescaped quote
          ignoreEscapedQuotes False 0x5c = Just True -- Begin of escape sequence
          ignoreEscapedQuotes _ _ = Just False
      strContents <- scan False ignoreEscapedQuotes
      skip (== c2w8 '"')
      return . IText . unescapeKey $ strContents
    _ -> INum <$> parseInteger
  skip (== c2w8 '>')
  (MapIndex idx :) <$> pathParser

parseField :: Parser [StoragePathPiece]
parseField = do
  skip (== c2w8 '.')
  ( do
      n <- Atto.takeWhile1 (inClass "_a-zA-Z0-9")
      (Field n :) <$> pathParser
    )
    <|> ((string ":creator") *> pathParser)
    <|> ((string ":creatorAddress") *> pathParser)
    <|> ((string ":originAddress") *> pathParser)

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
                if ch /= 0x22 && ch /= 0x5c
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
unparsePath (StoragePath ps) = B.concat . concatMap go $ ps
  where
    go :: StoragePathPiece -> [B.ByteString]
    go (Field p) = [".", p]
    go (ArrayIndex n) = ["[", C8.pack $ show n, "]"]
    go (MapIndex (INum n)) = ["<", C8.pack $ show n, ">"]
    go (MapIndex (IText t)) = ["<\"", escapeKey t, "\">"]
    go (MapIndex (IBool True)) = ["<true>"]
    go (MapIndex (IBool False)) = ["<false>"]
    go (MapIndex (IAccount a)) = ["<a:", C8.pack $ show a, ">"]

instance RLPSerializable BasicValue where
  rlpEncode = \case
    BDefault -> RLPString ""
    BInteger n -> RLPArray [RLPScalar 0, rlpEncode n]
    BString t -> RLPArray [RLPScalar 1, rlpEncode t]
    BBool b -> RLPArray [RLPScalar 2, rlpEncode b]
    BAccount a -> RLPArray [RLPScalar 3, rlpEncode a]
    BContract n a -> RLPArray [RLPScalar 4, rlpEncode n, rlpEncode a]
    BEnumVal a b c -> RLPArray [RLPScalar 5, rlpEncode a, rlpEncode b, rlpEncode c]
    BMappingSentinel -> RLPArray [RLPScalar 6]
    BDecimal v -> RLPArray [RLPScalar 7, rlpEncode v]
  rlpDecode x@(RLPArray ((RLPScalar t) : s)) =
    case (t, s) of
      (0, [f]) -> BInteger $ rlpDecode f
      (1, [f]) -> BString $ rlpDecode f
      (2, [f]) -> BBool $ rlpDecode f
      (3, [f]) -> BAccount $ rlpDecode f
      (4, [f, a']) -> BContract (rlpDecode f) (rlpDecode a')
      (5, [f, s', c']) -> BEnumVal (rlpDecode f) (rlpDecode s') (rlpDecode c')
      (6, []) -> BMappingSentinel
      (7, [f]) -> BDecimal (rlpDecode f)
      _ -> error $ "invalid type or data length for BasicValue: " ++ show x
  rlpDecode (RLPString "") = BDefault
  rlpDecode x = error $ "invalid shape for BasicValue: " ++ show x

pathToHexStorage :: StoragePath -> HexStorage
pathToHexStorage = HexStorage . unparsePath

basicToHexStorage :: BasicValue -> HexStorage
basicToHexStorage = HexStorage . rlpSerialize . rlpEncode

hexStorageToPath :: HexStorage -> Either String StoragePath
hexStorageToPath (HexStorage hs) = parsePath hs

hexStorageToBasic :: HexStorage -> Either String BasicValue
hexStorageToBasic (HexStorage hs) =
  unsafeDupablePerformIO . handle handler
    . evaluate
    . force
    . Right
    . rlpDecode
    . rlpDeserialize
    $ hs
  where
    handler :: SomeException -> IO (Either String BasicValue)
    handler = return . Left . show
