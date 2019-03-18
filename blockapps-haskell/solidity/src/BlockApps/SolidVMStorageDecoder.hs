{-# LANGUAGE OverloadedStrings #-}
module BlockApps.SolidVMStorageDecoder (decodeSolidVMValues) where

import Data.Bifunctor
import Data.Bitraversable
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8')
import Text.Printf

import BlockApps.Solidity.SolidityValue
import Blockchain.SolidVM.Model
import SolidVM.Model.Storable

decodeSolidVMValues :: [(HexStorage, HexStorage)] -> [(T.Text, SolidityValue)]
decodeSolidVMValues hexs = either (error . printf "decodeSolidVMValues: %s" . show) id $ do
  pathValues <- mapM (bimapM hexStorageToPath hexStorageToBasic) hexs
  totalStorage <- bimap show HM.toList $ synthesize pathValues
  mapM (bimapM (first show . decodeUtf8') storableToSolidity) totalStorage

storableToSolidity :: StorableValue -> Either String SolidityValue
storableToSolidity = \case
  BasicValue bv  -> case bv of
    BDefault -> fromShowable (0 ::Int)
    BInteger n -> fromShowable n
    BString t -> SolidityValueAsString <$> (first show . decodeUtf8') t
    BBool b -> Right $ SolidityBool b
    BAddress a -> Right . SolidityValueAsString . T.pack $ show a
    BContract _ a -> fromShowable a
    BEnumVal _ ev -> Right $ SolidityValueAsString ev
  SStruct fs -> SolidityObject <$> mapM (bimapM (first show . decodeUtf8') storableToSolidity)
                                        (HM.toList fs)
  SArray ivs -> SolidityArray <$> mapM storableToSolidity (unsparse $ I.toList ivs)
  SMapping kvs -> SolidityObject <$> mapM (bimapM tshowIdx storableToSolidity)
                                          (HM.toList kvs)
 where fromShowable :: (Show a) => a -> Either String SolidityValue
       fromShowable = Right . SolidityValueAsString . T.pack . show
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
  SStruct fs -> SStruct $ HM.map zeroOf fs
  SArray{} -> SArray I.empty
  SMapping{} -> SMapping HM.empty

