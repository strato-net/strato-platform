{-# LANGUAGE DeriveGeneric #-}
module Blockchain.ExtendedECDSA.Model.ExtendedSignature where

import Control.Monad
import Data.Binary
import qualified Data.ByteString as B
import GHC.Generics
import Test.QuickCheck

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ExtendedWord
import qualified Network.Haskoin.Internals as HK

data ExtendedSignature = ExtendedSignature HK.Signature Bool deriving (Show, Eq, Generic)

instance Binary ExtendedSignature where

instance Arbitrary ExtendedSignature where
  arbitrary = liftM2 ExtendedSignature arbitrary arbitrary

instance RLPSerializable ExtendedSignature where
  rlpEncode (ExtendedSignature (HK.Signature r s) yIsOdd) = RLPString . B.pack $ rstr ++ sstr ++ vstr
      where rstr = word256ToBytes . fromIntegral $ r
            sstr = word256ToBytes . fromIntegral $ s
            vstr = [if yIsOdd then 1 else 0]

  rlpDecode (RLPString bs) = ExtendedSignature (HK.Signature r s) yIsOdd
      where r = fromIntegral . bytesToWord256 . B.unpack . B.take 32 $ bs
            s = fromIntegral . bytesToWord256 . B.unpack . B.take 32 . B.drop 32 $ bs
            yIsOdd = (==1) . head . B.unpack . B.drop 64 $ bs
  rlpDecode x = error $ "invalid rlp for extendedsignature: " ++ show x
