{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

{-# OPTIONS_GHC -fno-warn-unused-imports #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
module BlockApps.SolidVMStorageDecoder
  ( decodeSolidVMValues
  , decodeCacheValues
  , replayDelta -- Testing only
  , ReplayFailure(..)
  ) where

import Control.DeepSeq
import Control.Exception
import Control.Monad.Extra
import Data.Bifunctor
import Data.Bitraversable
import qualified Data.ByteString as B
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import Data.List (findIndex)
import Data.List.Index
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, decodeUtf8')
import Data.Text.Encoding.Error (UnicodeException)
import GHC.Generics
import Text.Printf

import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Value as V
import Blockchain.SolidVM.Model
import SolidVM.Model.Storable

-- bimapSToS :: (t1 -> Either String t2) -> (t1, StorableValue) -> Either String (Maybe (t2, SolidityValue))
-- bimapSToS f (name', value') = do
--   name <- f name'
--   mValue <- storableToSolidity value'
--   return $ fmap (name,) mValue

-- bimapSToV :: (t1 -> Either String t2) -> (t1, StorableValue) -> Either String (Maybe (t2, Value))
-- bimapSToV f (name', value') = do
--   name <- f name'
--   mValue <- storableToValue value'
--   return $ fmap (name,) mValue

-- bsToText :: B.ByteString -> Either String T.Text
-- bsToText = first show . decodeUtf8'

decodeSolidVMValues :: [(HexStorage, HexStorage)] -> [(T.Text, SolidityValue)]
decodeSolidVMValues = error "TODO(decodeSolidVMValues)"
-- decodeSolidVMValues hexs = either (error . printf "decodeSolidVMValues: %s" . show) id $ do
--   pathValues <- mapM (bimapM hexStorageToPath hexStorageToBasic) hexs
--   totalStorage <- bimap show HM.toList $ synthesize pathValues
--   mapMaybeM (bimapSToS bsToText) totalStorage

decodeCacheValues :: M.Map B.ByteString B.ByteString -> [(T.Text, Value)] -> [(T.Text, Value)]
-- decodeCacheValues :: M.Map B.ByteString B.ByteString -> TotalStorage -> (TotalStorage, [(T.Text, Value)])
decodeCacheValues = error "TODO(decodeCacheValues"
-- decodeCacheValues hxs [] = either (error . printf "SVM.decodeCacheValues: %s" . show) id $ do
--   pathValues <- mapM (bimapM (hexStorageToPath . HexStorage) (hexStorageToBasic . HexStorage)) $ M.toList hxs
--   totalStorage <- bimap show HM.toList $ synthesize pathValues
--   mapMaybeM (bimapSToV bsToText) totalStorage

-- decodeCacheValues _ _ = error "todo: updates"

-- storableToValue :: V.Value -> Either String (Maybe Value)
-- storableToValue = \case
--   BasicValue bv -> case bv of
--     BDefault -> sv $ ValueAddress 0x0 -- Is this the best way?
--     BInteger n -> sv $ ValueInt True Nothing n
--     BString t -> sv $ ValueBytes Nothing t
--     BBool b -> sv $ ValueBool b
--     BAddress a -> sv $ ValueAddress a
--     BContract _ c -> Right . Just $ ValueContract c
--     BEnumVal k n -> Right . Just $ ValueEnum k n 0x77777 -- TODO: SolidVM enums should be numbered
--   SArray ivs -> Just . ValueArrayDynamic <$> mapMaybeM storableToValue (unsparse $ I.toList ivs)
--   SArraySentinel{} -> Right Nothing
--   SMapping kvs -> Just . ValueMapping . M.fromList <$> mapMaybeM (bimapSToV idxToSimple) (HM.toList kvs)
--   SStruct fs -> Just . ValueStruct <$> mapMaybeM (bimapSToV bsToText) (HM.toList fs)

--  where sv :: SimpleValue -> Either String (Maybe Value)
--        sv = Right . Just . SimpleValue

--        idxToSimple :: IndexType -> Either String SimpleValue
--        idxToSimple = Right . \case
--           INum n -> ValueInt True Nothing n
--           IAddress a -> ValueAddress a
--           IText t -> ValueBytes Nothing t
--           IBool b -> ValueBool b


-- storableToSolidity :: StorableValue -> Either String (Maybe SolidityValue)
-- storableToSolidity = \case
--   BasicValue bv  -> case bv of
--     BDefault -> fromShowable (0 ::Int)
--     BInteger n -> fromShowable n
--     BString t -> Just . SolidityValueAsString <$> (first show . decodeUtf8') t
--     BBool b -> Right . Just $ SolidityBool b
--     BAddress a -> Right . Just . SolidityValueAsString . T.pack $ show a
--     BContract _ a -> fromShowable a
--     BEnumVal _ ev -> Right . Just $ SolidityValueAsString ev
--   SStruct fs -> Just . SolidityObject <$> mapMaybeM (bimapSToS bsToText) (HM.toList fs)
--   SArray ivs -> Just . SolidityArray <$> mapMaybeM storableToSolidity (unsparse $ I.toList ivs)
--   SArraySentinel{} -> Right Nothing
--   SMapping kvs -> Just . SolidityObject <$> mapMaybeM (bimapSToS tshowIdx) (HM.toList kvs)

--  where fromShowable :: (Show a) => a -> Either String (Maybe SolidityValue)
--        fromShowable = Right . Just . SolidityValueAsString . T.pack . show
--        tshowIdx :: IndexType -> Either String T.Text
--        tshowIdx = \case
--          INum n -> Right . T.pack . show $ n
--          IAddress a -> Right . T.pack . show $ a
--          IText t -> first show $ decodeUtf8' t
--          IBool True -> Right "true"
--          IBool False -> Right "false"

-- unsparse :: [(Int, StorableValue)] -> [StorableValue]
-- unsparse = go 0
--  where go _ [] = []
--        go n kvs@((k, v):kvs') | n == k = v:go (n +1) kvs'
--                               | otherwise = zeroOf v:go (n+1) kvs

-- zeroOf :: StorableValue -> StorableValue
-- zeroOf = \case
--   BasicValue bv -> BasicValue $ case bv of
--     BDefault -> BDefault
--     BInteger{} -> BInteger 0
--     BString{} -> BString ""
--     BBool{} -> BBool False
--     BAddress{} -> BAddress 0x0
--     BContract c _ -> BContract c 0x0
--     -- This is not quite accurate, as the minimum should be the BEnumVal
--     -- However, we don't have enough context to know which string is minimum
--     BEnumVal{} -> BInteger 0
--   SArray{} -> SArray I.empty
--   SArraySentinel{} -> SArray I.empty
--   SMapping{} -> SMapping HM.empty
--   SStruct fs -> SStruct $ HM.map zeroOf fs




type TotalStorage = HM.HashMap B.ByteString V.Value

data ReplayFailure = MissingPath StoragePath
                   | TypeMismatch StoragePath BasicValue V.Value
                   | MissingStructField B.ByteString
                   | FieldRequiredAtTopLevel
                   | NoPathsProvided
                   | UnicodeError UnicodeException B.ByteString
                   deriving (Show, Eq, Generic, NFData)

replayDelta :: StorageDelta -> TotalStorage -> Either ReplayFailure TotalStorage
replayDelta [] ts = Right ts
replayDelta ((StoragePath (Field f:sp), bv):rs) ts =
  case HM.lookup f ts of
    Just sv -> do
      ts' <- (\v' -> HM.insert f v' ts) <$> applyDelta (StoragePath sp) bv sv
      replayDelta rs ts'
    Nothing -> Left . MissingPath $ singleton f
replayDelta ((p, _):_) _ = Left $ MissingPath p

applyDelta :: StoragePath -> BasicValue -> V.Value -> Either ReplayFailure V.Value
applyDelta (StoragePath sp) = applyDelta' sp

fromBasic :: BasicValue -> V.Value
fromBasic = \case
  BBool b -> SimpleValue $ ValueBool b
  BInteger n -> SimpleValue $! valueInt n
  BString bs -> SimpleValue $! valueBytes bs
  BAddress a -> SimpleValue $! ValueAddress a
  BContract _ c -> ValueContract c
  BEnumVal k n -> ValueEnum k n 0x44444 -- TODO: Keep enum ord in BasicValue
  BDefault -> SimpleValue $ ValueAddress 0x0

fromIndex :: IndexType -> V.SimpleValue
fromIndex = \case
  IBool b -> ValueBool b
  INum n -> valueInt n
  IText bs -> valueBytes bs
  IAddress a -> ValueAddress a

applyDelta' :: [StoragePathPiece] -> BasicValue -> V.Value -> Either ReplayFailure V.Value
applyDelta' [] bv (SimpleValue{}) = Right $ fromBasic bv
applyDelta' [] bv (ValueEnum{}) = Right $ fromBasic bv
applyDelta' [] bv (ValueContract{}) = Right $ fromBasic bv
-- Field updates are consed to the front, with the expectation that the struct is nubbed later
-- Let's hope that order doesn't matter
applyDelta' (Field n:sp) bv (ValueStruct ss) = case decodeUtf8' n of
  Left uex -> Left $ UnicodeError uex n
  Right n' -> case findIndex ((== n') . fst) ss of
    -- todo what the fuck
    Just idx -> fmap ValueStruct
              . sequence
              . modifyAt idx (\p -> do
                  (t, v) <- p
                  (t,) <$> applyDelta' sp bv v)
              . map Right $ ss
    Nothing -> Right . ValueStruct $ (n', (constructFromNothing' sp bv)):ss
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
  bv -> ValueStruct [("length", constructFromNothing' [] bv)]
constructFromNothing' (Field n:sp) = \bv -> ValueStruct [(decodeUtf8 n, constructFromNothing' sp bv)]
constructFromNothing' (MapIndex n:sp) =
  ValueMapping . M.singleton (fromIndex n) . constructFromNothing' sp
constructFromNothing' (ArrayIndex n:sp) =
  ValueArrayDynamic . I.singleton n . constructFromNothing' sp

-- -- analyze :: TotalStorage -> [(StoragePath, BasicValue)]
-- -- analyze = HM.foldlWithKey' go []
-- --   where go prev field sv = map (first (StoragePath . (Field field:))) (analyze' sv) <> prev

-- -- analyze' :: StorableValue -> [([StoragePathPiece], BasicValue)]
-- -- analyze' (BasicValue bv) = [([], bv)]
-- -- analyze' (SMapping sm) = HM.foldlWithKey' go [] sm
-- --   where go prev k sv = map (first (MapIndex k:)) (analyze' sv) <> prev
-- -- analyze' (SStruct ss) = HM.foldlWithKey' go [] ss
-- --   where go prev k sv = map (first (Field k:)) (analyze' sv) <> prev
-- -- analyze' (SArray vs) = I.foldMapWithKey go vs
-- --   where go k sv = map (first (ArrayIndex k:)) $ analyze' sv
-- -- analyze' (SArraySentinel n) = [([Field "length"], BInteger $ fromIntegral n)]

-- synthesize :: [(StoragePath, BasicValue)] -> Either ReplayFailure TotalStorage
-- synthesize spbvs = do
--   byFields <- mapM fieldsOnly spbvs
--   let basicLists = foldr (\(t, p) m -> HM.alter (Just . maybe [p] (p:)) t m) HM.empty byFields
--   sequence $ HM.map synthesize' basicLists
--  where fieldsOnly (StoragePath (Field t:sp), bv) = return (t, (StoragePath sp, bv))
--        fieldsOnly _ = Left FieldRequiredAtTopLevel

-- synthesize' :: [(StoragePath, BasicValue)] -> Either ReplayFailure V.Value
-- synthesize' ([]) = Left NoPathsProvided
-- synthesize' ((sp, bv):rest) =
--   let initState = constructFromNothing sp bv
--   in go rest initState
--  where go :: [(StoragePath, BasicValue)] -> V.Value -> Either ReplayFailure V.Value
--        go [] sv' = Right sv'
--        go ((sp',bv'):t) sv' = go t =<< applyDelta sp' bv' sv'

