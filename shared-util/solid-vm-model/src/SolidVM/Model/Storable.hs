{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE TemplateHaskell #-}
module SolidVM.Model.Storable where

import           Control.DeepSeq
import qualified Data.Aeson as Ae
import           Data.Attoparsec.ByteString as Atto
import           Data.Attoparsec.ByteString.Char8 (scientific)
import           Data.Bifunctor (first)
import qualified Data.ByteString as B
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.Unsafe as BU
import qualified Data.ByteString.Char8 as C8
import           Data.Char
import           Data.Hashable
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import           Data.Scientific (isInteger, toBoundedInteger)
import qualified Data.Text as T
import           Data.Word
import           Foreign.Ptr
import           Foreign.Storable
import           GHC.Generics
import           System.IO.Unsafe

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Address


data BasicValue = BInteger !Integer
                | BString !B.ByteString
                | BBool !Bool
                | BAddress !Address
                | BEnumVal !T.Text !T.Text
                | BContract !T.Text !Address
                | BDefault -- Indicates a not present value
                deriving (Show, Eq, Generic, NFData, Hashable)

data IndexType = INum Integer
               | IText B.ByteString
               | IBool Bool
               | IAddress Address
               deriving (Eq, Show, Ord, Generic, Hashable, NFData)

data StorableValue = BasicValue BasicValue
                   | SStruct (HM.HashMap B.ByteString StorableValue)
                   | SArray (I.IntMap StorableValue)
                   | SMapping (HM.HashMap IndexType StorableValue)
                   deriving (Eq, Show, Generic, NFData)

data StoragePathPiece = Field B.ByteString
                      | MapIndex IndexType
                      | ArrayIndex Int
                      deriving (Eq, Show, Generic, NFData, Hashable)

newtype StoragePath = StoragePath [StoragePathPiece] deriving (Eq, Show, Generic, NFData, Hashable)

empty :: StoragePath
empty = StoragePath []

singleton :: StoragePathPiece -> StoragePath
singleton piece = StoragePath [piece]

getField :: StoragePath -> B.ByteString
getField (StoragePath (Field f:_)) = f
getField path = error "StoragePath must begin with field" path

snoc :: StoragePath -> StoragePathPiece -> StoragePath
snoc (StoragePath p) piece = StoragePath $ p ++ [piece]

toList :: StoragePath -> [StoragePathPiece]
toList (StoragePath p) = p

fromList :: [StoragePathPiece] -> StoragePath
fromList = StoragePath

size :: StoragePath -> Int
size (StoragePath p) = length p

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
  (ArrayIndex idx:) <$> pathParser

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
      IAddress <$> either fail return eAddress
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
  (MapIndex idx:) <$> pathParser

parseField :: Parser [StoragePathPiece]
parseField = do
  skip (== c2w8 '.')
  n <- Atto.takeWhile1 (inClass "_a-zA-Z0-9")
  (Field n:) <$> pathParser

parsePath :: B.ByteString-> Either String StoragePath
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
                   copyAndEscape (dstOff+1) (srcOff+1)
                 else do
                   pokeByteOff dst dstOff (0x5c :: Word8)
                   pokeByteOff dst (dstOff+1) ch
                   copyAndEscape (dstOff+2) (srcOff+1)
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
                    ch' <- peekByteOff src (srcOff+1) :: IO Word8
                    pokeByteOff dst dstOff ch'
                    copyAndUnescape (dstOff+1) (srcOff+2)
                  else do
                    pokeByteOff dst dstOff ch
                    copyAndUnescape (dstOff +1) (srcOff+1)
              else if len - srcOff == 1 then do
                ch <- peekByteOff src srcOff :: IO Word8
                pokeByteOff dst dstOff ch
                copyAndUnescape (dstOff+1) (srcOff+1)
              else return dstOff
      copyAndUnescape 0 0

unparsePath :: StoragePath -> B.ByteString
unparsePath (StoragePath ps) = B.concat . concatMap go $ ps
  where go :: StoragePathPiece -> [B.ByteString]
        go (Field p) = [".", p]
        go (ArrayIndex n) = ["[", C8.pack $ show n, "]"]
        go (MapIndex (INum n)) = ["<", C8.pack $ show n, ">"]
        go (MapIndex (IText t)) = ["<\"", escapeKey t, "\">"]
        go (MapIndex (IBool True)) = ["<true>"]
        go (MapIndex (IBool False)) = ["<false>"]
        go (MapIndex (IAddress a)) = ["<a:", addressToHex a, ">"]

type TotalStorage = HM.HashMap B.ByteString StorableValue

data ReplayFailure = MissingPath StoragePath
                   | TypeMismatch
                   | MissingStructField B.ByteString
                   | FieldRequiredAtTopLevel
                   | NoPathsProvided
                   deriving (Show, Eq, Generic, NFData)

replayDelta :: StorageDelta -> TotalStorage -> Either ReplayFailure TotalStorage
replayDelta [] ts = Right ts
replayDelta ((StoragePath (Field f:sp), bv):rs) ts =
  case HM.lookup f ts of
    Just sv -> do
      ts' <- (\v' -> HM.insert f v' ts) <$> applyDelta (StoragePath sp) bv sv
      replayDelta rs ts'
    Nothing -> Left . MissingPath . singleton $ Field f
replayDelta ((p, _):_) _ = Left $ MissingPath p

applyDelta :: StoragePath -> BasicValue -> StorableValue -> Either ReplayFailure StorableValue
applyDelta (StoragePath sp) = applyDelta' sp

applyDelta' :: [StoragePathPiece] -> BasicValue -> StorableValue -> Either ReplayFailure StorableValue
applyDelta' [] bv (BasicValue _) = Right $ BasicValue bv
applyDelta' (Field n:sp) bv (SStruct ss) =
  case HM.lookup n ss of
    Just v -> SStruct . (\x -> HM.insert n x ss) <$> applyDelta' sp bv v
    Nothing -> Right . SStruct $ HM.insert n (constructFromNothing' sp bv) ss
applyDelta' (MapIndex n:sp) bv (SMapping ms) =
  case HM.lookup n ms of
    Just v -> SMapping . (\x -> HM.insert n x ms) <$> applyDelta' sp bv v
    Nothing -> Right . SMapping $ HM.insert n (constructFromNothing' sp bv) ms
applyDelta' (ArrayIndex n:sp) bv (SArray vs) =
  case I.lookup n vs of
    Just v -> SArray . (\x -> I.insert n x vs) <$> applyDelta' sp bv v
    Nothing -> Right . SArray $ I.insert n (constructFromNothing' sp bv) vs
applyDelta' _ _ _ = Left TypeMismatch

constructFromNothing :: StoragePath -> BasicValue -> StorableValue
constructFromNothing (StoragePath p) = constructFromNothing' p

constructFromNothing' :: [StoragePathPiece] -> BasicValue -> StorableValue
constructFromNothing' [] = BasicValue
constructFromNothing' (Field n:sp) = SStruct . HM.singleton n . constructFromNothing' sp
constructFromNothing' (MapIndex n:sp) = SMapping . HM.singleton n . constructFromNothing' sp
constructFromNothing' (ArrayIndex n:sp) = SArray . I.singleton n . constructFromNothing' sp

instance RLPSerializable BasicValue where
  rlpEncode = \case
    BDefault -> RLPString ""
    BInteger n -> RLPArray [RLPScalar 0, rlpEncode n]
    BString t -> RLPArray [RLPScalar 1, rlpEncode t]
    BBool b -> RLPArray [RLPScalar 2, rlpEncode b]
    BAddress a -> RLPArray [RLPScalar 3, rlpEncode a]
    BContract n a -> RLPArray [RLPScalar 4, rlpEncode n, rlpEncode a]
    BEnumVal a b -> RLPArray [RLPScalar 5, rlpEncode a, rlpEncode b]
  rlpDecode x@(RLPArray ((RLPScalar t):f:s)) =
    case (t, s) of
      (0, []) -> BInteger $ rlpDecode f
      (1, []) -> BString $ rlpDecode f
      (2, []) -> BBool $ rlpDecode f
      (3, []) -> BAddress $ rlpDecode f
      (4, [a']) -> BContract (rlpDecode f) (rlpDecode a')
      (5, [s']) -> BEnumVal (rlpDecode f) (rlpDecode s')
      _ -> error $ "invalid type or data length for BasicValue: " ++ show x
  rlpDecode (RLPString "") = BDefault
  rlpDecode x = error $ "invalid shape for BasicValue: " ++ show x


instance Ae.ToJSON StorableValue where
  toJSON = error "TODO(tim): StorableValue toJSON"

instance Ae.FromJSON StorableValue where
  parseJSON = error "TODO(tim): StorableValue fromJSON"

analyze :: TotalStorage -> [(StoragePath, BasicValue)]
analyze = HM.foldlWithKey' go []
  where go prev field sv = map (first (StoragePath . (Field field:))) (analyze' sv) <> prev

analyze' :: StorableValue -> [([StoragePathPiece], BasicValue)]
analyze' (BasicValue bv) = [([], bv)]
analyze' (SMapping sm) = HM.foldlWithKey' go [] sm
  where go prev k sv = map (first (MapIndex k:)) (analyze' sv) <> prev
analyze' (SStruct ss) = HM.foldlWithKey' go [] ss
  where go prev k sv = map (first (Field k:)) (analyze' sv) <> prev
analyze' (SArray vs) = I.foldMapWithKey go vs
  where go k sv = map (first (ArrayIndex k:)) $ analyze' sv

synthesize :: [(StoragePath, BasicValue)] -> Either ReplayFailure TotalStorage
synthesize spbvs = do
  byFields <- mapM fieldsOnly spbvs
  let basicLists = foldr (\(t, p) m -> HM.alter (Just . maybe [p] (p:)) t m) HM.empty byFields
  sequence $ HM.map synthesize' basicLists
 where fieldsOnly (StoragePath (Field t:sp), bv) = return (t, (StoragePath sp, bv))
       fieldsOnly _ = Left FieldRequiredAtTopLevel

synthesize' :: [(StoragePath, BasicValue)] -> Either ReplayFailure StorableValue
synthesize' ([]) = Left NoPathsProvided
synthesize' ((sp, bv):rest) =
  let initState = constructFromNothing sp bv
  in go rest initState
 where go :: [(StoragePath, BasicValue)] -> StorableValue -> Either ReplayFailure StorableValue
       go [] sv' = Right sv'
       go ((sp',bv'):t) sv' = go t =<< applyDelta sp' bv' sv'
