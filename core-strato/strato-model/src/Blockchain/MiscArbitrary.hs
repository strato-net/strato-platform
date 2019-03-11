{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.MiscArbitrary () where

import Test.QuickCheck

import qualified Data.ByteString as B
import qualified Data.ByteString.Short as BSS
import Data.ByteString.Arbitrary
import qualified Data.Text as T
import Data.Time

instance Arbitrary UTCTime where
    arbitrary =
        do randomDay <- choose (1, 28) :: Gen Int
           randomMonth <- choose (1, 12) :: Gen Int
           randomYear <- choose (1970, 2018) :: Gen Integer
           randomTime <- choose (0, 86399) :: Gen Int
           return $ UTCTime (fromGregorian randomYear randomMonth randomDay) (fromIntegral randomTime)

instance Arbitrary B.ByteString where
  arbitrary = fromABS <$> arbitrary

instance Arbitrary BSS.ShortByteString where
  arbitrary = do
    n <- choose (0, 256)
    BSS.toShort <$> slowRandBs n

instance Arbitrary T.Text where
  arbitrary = T.pack <$> arbitrary
