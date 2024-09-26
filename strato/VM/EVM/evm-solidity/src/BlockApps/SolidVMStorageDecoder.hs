{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

module BlockApps.SolidVMStorageDecoder
  ( decodeSolidVMValues,
    decodeCacheValues,
    decodeCacheValuesForCollections,
    replayDeltas, -- Testing only
    ReplayFailure (..),
    synthesize, -- Testing only
    TotalStorage,
  )
where

import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Value as V
import Blockchain.SolidVM.Model
import Control.DeepSeq
import Control.Monad.Extra
import Data.Bifunctor
import Data.Bitraversable
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import Data.Char
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, decodeUtf8')
import Data.Text.Encoding.Error (UnicodeException)
import GHC.Generics
import SolidVM.Model.SolidString
import SolidVM.Model.Storable
import Text.Printf

decodeSolidVMValues :: [(HexStorage, HexStorage)] -> [(T.Text, SolidityValue)]
decodeSolidVMValues hxs = either (error . printf "decodeSolidVMValues: %s" . show) id $ do
  pathValues <- mapM (bimapM hexStorageToPath hexStorageToBasic) hxs
  totalStorage <- bimap show HM.toList $ synthesize pathValues
  mapMaybeM (bimapValue bsToText) totalStorage

bimapValue :: (t1 -> Either String t2) -> (t1, V.Value) -> Either String (Maybe (t2, SolidityValue))
bimapValue f (name', value') = do
  name <- f name'
  mValue <- valueToSolidityValue value'
  return $ fmap (name,) mValue

decodeCacheValues :: M.Map B.ByteString B.ByteString -> [(T.Text, Value)]
decodeCacheValues hxs = either (error . (++ ": " ++ show hxs) . printf "SVM.decodeCacheValues: %s" . show) id $ do
  let parseM = bimapM (hexStorageToPath . HexStorage) (hexStorageToBasic . HexStorage)
      isBasic (StoragePath ([Field _])) = True
      isBasic (StoragePath [Field _, Field fieldBS]) = C8.unpack fieldBS /= "length"
      isBasic _ = False
  pathValues <- mapM parseM $ M.toList hxs
  let pathValues' = filter (isBasic . fst) pathValues
  finalState <- bimap show HM.toList $ synthesize pathValues'
  mapM (bimapM bsToText return) finalState

decodeCacheValuesForCollections :: M.Map B.ByteString B.ByteString -> [(T.Text, Value)]
decodeCacheValuesForCollections hxs = either (error . (++ ": " ++ show hxs) . printf "SVM.decodeCacheValuesForCollections: %s" . show) id $ do
  let parseM = bimapM (hexStorageToPath . HexStorage) (hexStorageToBasic . HexStorage)
      isBasic (StoragePath [Field _, MapIndex _]) = True
      isBasic (StoragePath [Field _, ArrayIndex _]) = True
      isBasic (StoragePath [Field _, MapIndex _, Field fieldBS]) = C8.unpack fieldBS /= "length"
      isBasic (StoragePath [Field _, ArrayIndex _, Field fieldBS]) = C8.unpack fieldBS /= "length"
      isBasic _ = False
  pathValues <- mapM parseM $ M.toList hxs
  let pathValues' = filter (isBasic . fst) pathValues
  finalState <- bimap show HM.toList $ synthesize pathValues'
  mapM (bimapM bsToText return) finalState

bsToText :: B.ByteString -> Either String T.Text
bsToText = first show . decodeUtf8'

-- Why another time?
--  - original vToSV can't handle sentinels without introducing a monad
--  - SolidVM shares a bytes/string typeA and cannot hexencode all strings returned
--  - Enums don't have numeric values in SolidVM
valueToSolidityValue :: V.Value -> Either String (Maybe SolidityValue)
valueToSolidityValue = \case
  SimpleValue sv -> case sv of
    ValueBytes _ b -> Just . SolidityValueAsString <$> (first show . decodeUtf8') b
    ValueBool b -> Right . Just $ SolidityBool b
    ValueInt _ _ n -> fromShowable n
    ValueDecimal n -> Right . Just $ SolidityValueAsString $ decodeUtf8 n
    ValueAddress a -> fromShowable a
    ValueAccount a -> fromShowable a
    ValueString s -> fromText s
  ValueEnum _ ev _ -> fromText ev
  ValueArraySentinel {} -> Right Nothing
  ValueContract c -> fromShowable c
  ValueStruct fs -> Just . SolidityObject <$> mapMaybeM (bimapValue Right) (M.toList fs)
  ValueMapping kvs -> Just . SolidityObject <$> mapMaybeM (bimapValue tshowIdx) (M.toList kvs)
  ValueArrayDynamic ivs -> Just . SolidityArray <$> mapMaybeM valueToSolidityValue (unsparse ivs)
  ValueArrayFixed {} -> Left "internal error: SolidVM generate state for static arrays"
  ValueFunction {} -> Left "internal error: SolidVM generating state for functions"
  ValueVariadic {} -> Left "internal error: SolidVM generating state for variadic"
  where
    fromShowable :: (Show a) => a -> Either String (Maybe SolidityValue)
    fromShowable = Right . Just . SolidityValueAsString . T.pack . show

    fromText :: T.Text -> Either String (Maybe SolidityValue)
    fromText = Right . Just . SolidityValueAsString

    tshowIdx :: SimpleValue -> Either String T.Text
    tshowIdx = \case
      ValueInt _ _ n -> Right . T.pack . show $ n
      ValueDecimal n -> Right . T.pack . show $ n
      ValueAddress a -> Right . T.pack . show $ a
      ValueAccount a -> Right . T.pack . show $ a
      ValueString t -> Right t
      -- The collapse of bytes and str to a single types means that selecting an encoding
      -- for keys is not obvious. bytestrings may contain non UTF8 text, and at the same time
      -- we wouldn't want to hex encode user readable strings. Unprintable characters are
      -- escaped, so that the text will maintain readability and data is not lost on encoding
      -- (c.f. T.pack . C8.unpack, which will silently truncate non-UTF8 byte sequences)
      ValueBytes _ bs -> Right . T.pack . (foldr showLitChar "") . C8.unpack $ bs
      ValueBool True -> Right "true"
      ValueBool False -> Right "false"

type TotalStorage = HM.HashMap B.ByteString V.Value

data ReplayFailure
  = MissingPath StoragePath
  | TypeMismatch StoragePath BasicValue V.Value
  | MissingStructField B.ByteString
  | FieldRequiredAtTopLevel
  | NoPathsProvided
  | UnicodeError B.ByteString UnicodeException
  deriving (Show, Eq, Generic, NFData)

replayDeltas :: StorageDelta -> TotalStorage -> Either ReplayFailure TotalStorage
replayDeltas [] ts = Right ts
replayDeltas ((StoragePath (Field f : sp), bv) : rs) ts =
  case HM.lookup f ts of
    Just sv -> do
      ts' <- (\v' -> HM.insert f v' ts) <$> applyDelta (StoragePath sp) bv sv
      replayDeltas rs ts'
    Nothing -> replayDeltas rs $ HM.insert f (constructFromNothing' sp bv) ts
replayDeltas ((p, _) : _) _ = Left $ MissingPath p

applyDelta :: StoragePath -> BasicValue -> V.Value -> Either ReplayFailure V.Value
applyDelta (StoragePath sp) = applyDelta' sp

applyDelta' :: [StoragePathPiece] -> BasicValue -> V.Value -> Either ReplayFailure V.Value
applyDelta' [] bv (SimpleValue {}) = Right $ fromBasic bv
applyDelta' [] bv (ValueEnum {}) = Right $ fromBasic bv
applyDelta' [] bv (ValueContract {}) = Right $ fromBasic bv
applyDelta' (Field n : sp) bv (ValueStruct ss) = do
  n' <- first (UnicodeError n) $ decodeUtf8' n
  case M.lookup n' ss of
    Just v -> ValueStruct . (\x -> M.insert n' x ss) <$> applyDelta' sp bv v
    Nothing -> Right . ValueStruct $ M.insert n' (constructFromNothing' sp bv) ss
applyDelta' (MapIndex n : sp) bv (ValueMapping ms) =
  let n' = fromIndex n
   in case M.lookup n' ms of
        Just v -> ValueMapping . (\x -> M.insert n' x ms) <$> applyDelta' sp bv v
        Nothing -> Right . ValueMapping $ M.insert n' (constructFromNothing' sp bv) ms
applyDelta' (ArrayIndex n : sp) bv (ValueArrayDynamic vs) =
  case I.lookup n vs of
    Just v -> ValueArrayDynamic . (\x -> I.insert n x vs) <$> applyDelta' sp bv v
    Nothing -> Right . ValueArrayDynamic $ I.insert n (constructFromNothing' sp bv) vs
applyDelta' (ArrayIndex n : sp) bv sent@(ValueArraySentinel len) =
  Right . ValueArrayDynamic $ I.fromList [(n, constructFromNothing' sp bv), (len, sent)]
applyDelta' [Field "length"] (BInteger n) (ValueArrayDynamic vs) =
  let n' = fromIntegral n
   in Right . ValueArrayDynamic $ I.insert n' (ValueArraySentinel n') vs
applyDelta' [Field "length"] (BInteger n) (ValueArraySentinel {}) = Right . ValueArraySentinel $ fromIntegral n
applyDelta' [Field _] bv _ = Right $ fromBasic bv -- Handle struct value assignment case
applyDelta' sp bv (ValueArraySentinel {}) = Right $ constructFromNothing' sp bv
applyDelta' sp b s = Left $ TypeMismatch (StoragePath sp) b s

constructFromNothing :: StoragePath -> BasicValue -> V.Value
constructFromNothing (StoragePath p) = constructFromNothing' p

constructFromNothing' :: [StoragePathPiece] -> BasicValue -> V.Value
constructFromNothing' [] = fromBasic
constructFromNothing' [Field "length"] = \case
  BInteger n -> ValueArraySentinel $ fromIntegral n
  bv -> ValueStruct . M.singleton "length" $ constructFromNothing' [] bv
constructFromNothing' (Field n : sp) = ValueStruct . M.singleton (decodeUtf8 n) . constructFromNothing' sp
constructFromNothing' (MapIndex n : sp) =
  ValueMapping . M.singleton (fromIndex n) . constructFromNothing' sp
constructFromNothing' (ArrayIndex n : sp) =
  ValueArrayDynamic . I.singleton n . constructFromNothing' sp

synthesize :: [(StoragePath, BasicValue)] -> Either ReplayFailure TotalStorage
synthesize spbvs = do
  byFields <- mapM fieldsOnly $ filter correctFields spbvs
  let basicLists = foldr (\(t, p) m -> HM.alter (Just . maybe [p] (p :)) t m) HM.empty byFields
  sequence $ HM.map synthesize' basicLists
  where
    correctFields (StoragePath (Field _ : _), _) = True -- Motivation: we are filting out the
    correctFields (StoragePath [], _) = False -- the :creator field. Without doing this registerCert
    correctFields _ = True -- causes issues. See commit's diff & parseField.
    fieldsOnly (StoragePath (Field t : sp), bv) = return (t, (StoragePath sp, bv))
    fieldsOnly _ = Left FieldRequiredAtTopLevel

synthesize' :: [(StoragePath, BasicValue)] -> Either ReplayFailure V.Value
synthesize' ([]) = Left NoPathsProvided
synthesize' ((sp, bv) : rest) =
  let initState = constructFromNothing sp bv
   in go rest initState
  where
    go :: [(StoragePath, BasicValue)] -> V.Value -> Either ReplayFailure V.Value
    go [] sv' = Right sv'
    go ((sp', bv') : t) sv' = go t =<< applyDelta sp' bv' sv'

fromBasic :: BasicValue -> V.Value
fromBasic = \case
  BBool b -> SimpleValue $ ValueBool b
  BInteger n -> SimpleValue $! valueInt n
  BString bs -> SimpleValue $! valueBytes bs
  BDecimal v -> SimpleValue $! ValueDecimal v
  BAccount a -> SimpleValue $! ValueAccount a
  BContract _ c -> ValueContract c
  BEnumVal tipe name num -> ValueEnum (labelToText tipe) (labelToText name) (fromIntegral num)
  BMappingSentinel -> ValueMapping M.empty
  BDefault -> SimpleValue $ ValueAddress 0x0

fromIndex :: IndexType -> V.SimpleValue
fromIndex = \case
  IBool b -> ValueBool b
  INum n -> valueInt n
  IText bs -> valueBytes bs
  IAccount a -> ValueAccount a
