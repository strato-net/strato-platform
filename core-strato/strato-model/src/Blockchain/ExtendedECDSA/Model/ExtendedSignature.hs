{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
module Blockchain.ExtendedECDSA.Model.ExtendedSignature where

import Control.DeepSeq
import Control.Monad
import Data.Binary
import qualified Data.ByteString as B
import Data.Data
import GHC.Generics
import Test.QuickCheck

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import qualified Network.Haskoin.Internals as HK

data ExtendedSignature = ExtendedSignature HK.Signature Bool deriving (Show, Eq, Generic, Data)

instance Binary ExtendedSignature where

instance Arbitrary ExtendedSignature where
  arbitrary = liftM2 ExtendedSignature arbitrary arbitrary

instance RLPSerializable ExtendedSignature where
  rlpEncode (ExtendedSignature (HK.Signature r s) yIsOdd) = RLPString $ rstr <> sstr <> vstr
      where rstr = word256ToBytes . fromIntegral $ r
            sstr = word256ToBytes . fromIntegral $ s
            vstr = B.singleton $ if yIsOdd then 1 else 0

  rlpDecode (RLPString bs) = ExtendedSignature (HK.Signature r s) yIsOdd
      where r = fromIntegral . bytesToWord256 . B.take 32 $ bs
            s = fromIntegral . bytesToWord256 . B.take 32 . B.drop 32 $ bs
            yIsOdd = (==1) $ B.index bs 64
  rlpDecode x = error $ "invalid rlp for extendedsignature: " ++ show x

instance NFData ExtendedSignature
