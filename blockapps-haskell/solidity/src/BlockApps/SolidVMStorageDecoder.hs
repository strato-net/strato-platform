{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
module BlockApps.SolidVMStorageDecoder (decodeSolidVMValues) where

import Control.Monad.Extra
import Data.Bifunctor
import Data.Bitraversable
import qualified Data.ByteString as B
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8')
import Text.Printf

import BlockApps.Solidity.SolidityValue
import Blockchain.SolidVM.Model
import SolidVM.Model.Storable

bimapSToS :: (t1 -> Either String t2) -> (t1, StorableValue) -> Either String (Maybe (t2, SolidityValue))
bimapSToS f (name', value') = do
  name <- f name'
  mValue <- storableToSolidity value'
  return $ fmap (name,) mValue

bsToText :: B.ByteString -> Either String T.Text
bsToText = first show . decodeUtf8'

decodeSolidVMValues :: [(HexStorage, HexStorage)] -> [(T.Text, SolidityValue)]
decodeSolidVMValues hexs = either (error . printf "decodeSolidVMValues: %s" . show) id $ do
  pathValues <- mapM (bimapM hexStorageToPath hexStorageToBasic) hexs
  totalStorage <- bimap show HM.toList $ synthesize pathValues
  mapMaybeM (bimapSToS bsToText) totalStorage

storableToSolidity :: StorableValue -> Either String (Maybe SolidityValue)
storableToSolidity = \case
  BasicValue bv  -> case bv of
    BDefault -> fromShowable (0 ::Int)
    BInteger n -> fromShowable n
    BString t -> Just . SolidityValueAsString <$> (first show . decodeUtf8') t
    BBool b -> Right . Just $ SolidityBool b
    BAddress a -> Right . Just . SolidityValueAsString . T.pack $ show a
    BContract _ a -> fromShowable a
    BEnumVal _ ev -> Right . Just $ SolidityValueAsString ev
  SStruct fs -> Just . SolidityObject <$> mapMaybeM (bimapSToS bsToText) (HM.toList fs)
  SArray ivs -> Just . SolidityArray <$> mapMaybeM storableToSolidity (unsparse $ I.toList ivs)
  SArraySentinel{} -> Right Nothing
  SMapping kvs -> Just . SolidityObject <$> mapMaybeM (bimapSToS tshowIdx) (HM.toList kvs)

 where fromShowable :: (Show a) => a -> Either String (Maybe SolidityValue)
       fromShowable = Right . Just . SolidityValueAsString . T.pack . show
       tshowIdx :: IndexType -> Either String T.Text
       tshowIdx = \case
         INum n -> Right . T.pack . show $ n
         IAddress a -> Right . T.pack . show $ a
         IText t -> first show $ decodeUtf8' t
         IBool True -> Right "true"
         IBool False -> Right "false"

       unsparse :: [(Int, StorableValue)] -> [StorableValue]
       unsparse = go 0
         where go _ [] = []
               go n kvs@((k, v):kvs') | n == k = v:go (n +1) kvs'
                                      | otherwise = zeroOf v:go (n+1) kvs

zeroOf :: StorableValue -> StorableValue
zeroOf = \case
  BasicValue bv -> BasicValue $ case bv of
    BDefault -> BDefault
    BInteger{} -> BInteger 0
    BString{} -> BString ""
    BBool{} -> BBool False
    BAddress{} -> BAddress 0x0
    BContract c _ -> BContract c 0x0
    -- This is not quite accurate, as the minimum should be the BEnumVal
    -- However, we don't have enough context to know which string is minimum
    BEnumVal{} -> BInteger 0
  SArray{} -> SArray I.empty
  SArraySentinel{} -> SArray I.empty
  SMapping{} -> SMapping HM.empty
  SStruct fs -> SStruct $ HM.map zeroOf fs

