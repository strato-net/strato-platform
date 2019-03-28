{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

module BlockApps.SolidVMStorageDecoder
  ( decodeSolidVMValues
  , decodeCacheValues
  , replayDeltas -- Testing only
  , ReplayFailure(..)
  , synthesize -- Testing only
  , TotalStorage
  ) where

import Control.DeepSeq
import Control.Monad.Extra
import Data.Bifunctor
import Data.Bitraversable
import qualified Data.ByteString as B
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, decodeUtf8', encodeUtf8)
import Data.Text.Encoding.Error (UnicodeException)
import GHC.Generics
import Text.Printf

import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Value as V
import Blockchain.SolidVM.Model
import SolidVM.Model.Storable

decodeSolidVMValues :: [(HexStorage, HexStorage)] -> [(T.Text, SolidityValue)]
decodeSolidVMValues hxs = either (error . printf "decodeSolidVMValues: %s" . show) id $ do
  pathValues <- mapM (bimapM hexStorageToPath hexStorageToBasic) hxs
  totalStorage <- bimap show HM.toList $ synthesize pathValues
  mapMaybeM (bimapValue bsToText) totalStorage

bimapValue:: (t1 -> Either String t2) -> (t1, V.Value) -> Either String (Maybe (t2, SolidityValue))
bimapValue f (name', value') = do
  name <- f name'
  mValue <- valueToSolidityValue value'
  return $ fmap (name,) mValue


decodeCacheValues :: M.Map B.ByteString B.ByteString -> [(T.Text, Value)] -> [(T.Text, Value)]
decodeCacheValues hxs prevState = either (error . printf "SVM.decodeCacheValues: %s" . show) id $ do
  let parseM = bimapM (hexStorageToPath . HexStorage) (hexStorageToBasic . HexStorage)
  pathValues <- mapM parseM $ M.toList hxs
  finalState <- bimap show HM.toList $ case prevState of
    [] -> synthesize pathValues
    tvs -> replayDeltas pathValues . HM.fromList . map (first encodeUtf8) $ tvs
  mapM (firstM bsToText) finalState

bsToText :: B.ByteString -> Either String T.Text
bsToText = first show . decodeUtf8'

firstM :: Monad m => (a1 -> m a2) -> (a1, b) -> m (a2, b)
firstM f (a1, b) = (,b) <$> f a1

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
    ValueAddress a -> fromShowable a
    ValueString s -> fromText s
  ValueEnum _ ev _ -> fromText ev
  ValueArraySentinel{} -> Right Nothing
  ValueContract c -> fromShowable c
  ValueStruct fs -> Just . SolidityObject <$> mapMaybeM (bimapValue Right) (M.toList fs)
  ValueMapping kvs -> Just . SolidityObject <$> mapMaybeM (bimapValue tshowIdx) (M.toList kvs)
  ValueArrayDynamic ivs -> Just . SolidityArray <$> mapMaybeM valueToSolidityValue (unsparse ivs)
  ValueArrayFixed{} -> Left "internal error: SolidVM generate state for static arrays"
  ValueFunction{} -> Left "internal error: SolidVM generating state for functions"


  where fromShowable :: (Show a) => a -> Either String (Maybe SolidityValue)
        fromShowable = Right . Just . SolidityValueAsString . T.pack . show

        fromText :: T.Text -> Either String (Maybe SolidityValue)
        fromText = Right . Just . SolidityValueAsString

        tshowIdx :: SimpleValue -> Either String T.Text
        tshowIdx = \case
          ValueInt _ _ n -> Right . T.pack . show $ n
          ValueAddress a -> Right . T.pack . show $ a
          ValueString t -> Right t
          ValueBytes _ bs -> error $ "bytes index" ++ show bs
          ValueBool True -> Right "true"
          ValueBool False -> Right "false"

type TotalStorage = HM.HashMap B.ByteString V.Value

data ReplayFailure = MissingPath StoragePath
                   | TypeMismatch StoragePath BasicValue V.Value
                   | MissingStructField B.ByteString
                   | FieldRequiredAtTopLevel
                   | NoPathsProvided
                   | UnicodeError B.ByteString UnicodeException
                   deriving (Show, Eq, Generic, NFData)

replayDeltas :: StorageDelta -> TotalStorage -> Either ReplayFailure TotalStorage
replayDeltas [] ts = Right ts
replayDeltas ((StoragePath (Field f:sp), bv):rs) ts =
  case HM.lookup f ts of
    Just sv -> do
      ts' <- (\v' -> HM.insert f v' ts) <$> applyDelta (StoragePath sp) bv sv
      replayDeltas rs ts'
    Nothing -> return $ HM.insert f (constructFromNothing' sp bv) ts
replayDeltas ((p, _):_) _ = Left $ MissingPath p

applyDelta :: StoragePath -> BasicValue -> V.Value -> Either ReplayFailure V.Value
applyDelta (StoragePath sp) = applyDelta' sp

applyDelta' :: [StoragePathPiece] -> BasicValue -> V.Value -> Either ReplayFailure V.Value
applyDelta' [] bv (SimpleValue{}) = Right $ fromBasic bv
applyDelta' [] bv (ValueEnum{}) = Right $ fromBasic bv
applyDelta' [] bv (ValueContract{}) = Right $ fromBasic bv
applyDelta' (Field n:sp) bv (ValueStruct ss) = do
  n' <- first (UnicodeError n) $ decodeUtf8' n
  case M.lookup n' ss of
    Just v -> ValueStruct . (\x -> M.insert n' x ss) <$> applyDelta' sp bv v
    Nothing -> Right . ValueStruct $ M.insert n' (constructFromNothing' sp bv) ss
applyDelta' (MapIndex n:sp) bv (ValueMapping ms) =
  let n' = fromIndex n
  in case M.lookup n' ms of
    Just v -> ValueMapping . (\x -> M.insert n' x ms) <$> applyDelta' sp bv v
    Nothing -> Right . ValueMapping $ M.insert n' (constructFromNothing' sp bv) ms
applyDelta' (ArrayIndex n:sp) bv (ValueArrayDynamic vs) =
  case I.lookup n vs of
    Just v -> ValueArrayDynamic . (\x -> I.insert n x vs) <$> applyDelta' sp bv v
    Nothing -> Right . ValueArrayDynamic $ I.insert n (constructFromNothing' sp bv) vs
applyDelta' (ArrayIndex n:sp) bv sent@(ValueArraySentinel len) =
  Right . ValueArrayDynamic $ I.fromList [(n, constructFromNothing' sp bv), (len, sent)]
applyDelta' [Field "length"] (BInteger n) (ValueArrayDynamic vs) =
  let n' = fromIntegral n
  in Right . ValueArrayDynamic $ I.insert n' (ValueArraySentinel n') vs
applyDelta' sp b s = Left $ TypeMismatch (StoragePath sp) b s

constructFromNothing :: StoragePath -> BasicValue -> V.Value
constructFromNothing (StoragePath p) = constructFromNothing' p

constructFromNothing' :: [StoragePathPiece] -> BasicValue -> V.Value
constructFromNothing' [] = fromBasic
constructFromNothing' [Field "length"] = \case
  BInteger n -> ValueArraySentinel $ fromIntegral n
  bv -> ValueStruct . M.singleton "length" $ constructFromNothing' [] bv
constructFromNothing' (Field n:sp) = ValueStruct . M.singleton (decodeUtf8 n) . constructFromNothing' sp
constructFromNothing' (MapIndex n:sp) =
  ValueMapping . M.singleton (fromIndex n) . constructFromNothing' sp
constructFromNothing' (ArrayIndex n:sp) =
  ValueArrayDynamic . I.singleton n . constructFromNothing' sp

synthesize :: [(StoragePath, BasicValue)] -> Either ReplayFailure TotalStorage
synthesize spbvs = do
  byFields <- mapM fieldsOnly spbvs
  let basicLists = foldr (\(t, p) m -> HM.alter (Just . maybe [p] (p:)) t m) HM.empty byFields
  sequence $ HM.map synthesize' basicLists
 where fieldsOnly (StoragePath (Field t:sp), bv) = return (t, (StoragePath sp, bv))
       fieldsOnly _ = Left FieldRequiredAtTopLevel

synthesize' :: [(StoragePath, BasicValue)] -> Either ReplayFailure V.Value
synthesize' ([]) = Left NoPathsProvided
synthesize' ((sp, bv):rest) =
  let initState = constructFromNothing sp bv
  in go rest initState
 where go :: [(StoragePath, BasicValue)] -> V.Value -> Either ReplayFailure V.Value
       go [] sv' = Right sv'
       go ((sp',bv'):t) sv' = go t =<< applyDelta sp' bv' sv'

fromBasic :: BasicValue -> V.Value
fromBasic = \case
  BBool b -> SimpleValue $ ValueBool b
  BInteger n -> SimpleValue $! valueInt n
  BString bs -> SimpleValue $! valueBytes bs
  BAddress a -> SimpleValue $! ValueAddress a
  BContract _ c -> ValueContract c
  BEnumVal k n -> ValueEnum k n 0x77777 -- TODO: Keep enum ord in BasicValue
  BDefault -> SimpleValue $ ValueAddress 0x0

fromIndex :: IndexType -> V.SimpleValue
fromIndex = \case
  IBool b -> ValueBool b
  INum n -> valueInt n
  IText bs -> valueBytes bs
  IAddress a -> ValueAddress a
