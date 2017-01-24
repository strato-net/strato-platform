{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings, TypeApplications #-}

module BlockApps.Strato.TypesSpec where

import Control.Applicative
import Data.Aeson
import Data.LargeWord
import Generic.Random.Generic
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Read

import BlockApps.Strato.Types

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do
  describe "Hex" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ (Hex Word)
    prop "has inverse read/show" $ readShowProp @ (Hex Word)
  describe "Strung" $
    prop "has inverse JSON decode/encode" $ jsonProp @ (Strung Integer)
  describe "TransactionType" $
    prop "has inverse JSON decode/encode" $ jsonProp @ TransactionType
  describe "Transaction" $
    prop "has inverse JSON decode/encode" $ jsonProp @ Transaction
  describe "WithNext" $
    prop "has inverse JSON decode/encode" $ jsonProp @ (WithNext Transaction)
  describe "BlockData" $
    prop "has inverse JSON decode/encode" $ jsonProp @ BlockData
  describe "Block" $
    prop "has inverse JSON decode/encode" $ jsonProp @ Block
  describe "Account" $
    prop "has inverse JSON decode/encode" $ jsonProp @ Account
  describe "Difficulty" $
    prop "has inverse JSON decode/encode" $ jsonProp @ Difficulty
  describe "TxCount" $
    prop "has inverse JSON decode/encode" $ jsonProp @ TxCount
  describe "Storage" $
    prop "has inverse JSON decode/encode" $ jsonProp @ Storage

-- helpers

jsonProp :: (Eq x, Show x, FromJSON x, ToJSON x) => x -> Property
jsonProp = liftA2 (===) (decode . encode) Just

readShowProp :: (Eq x, Read x, Show x) => x -> Property
readShowProp = liftA2 (===) (readMaybe . show) Just

-- orphans

instance Arbitrary TransactionType where arbitrary = genericArbitrary
instance Arbitrary Addresses where arbitrary = genericArbitrary
instance (Arbitrary x, Arbitrary y) => Arbitrary (LargeKey x y) where
  arbitrary = LargeKey <$> arbitrary <*> arbitrary
instance Arbitrary Transaction where arbitrary = genericArbitrary
instance Arbitrary x => Arbitrary (WithNext x) where
  arbitrary = genericArbitrary
instance Arbitrary BlockData where arbitrary = genericArbitrary
instance Arbitrary Block where arbitrary = genericArbitrary
instance Arbitrary Account where arbitrary = genericArbitrary
instance Arbitrary Difficulty where arbitrary = genericArbitrary
instance Arbitrary TxCount where arbitrary = genericArbitrary
instance Arbitrary Storage where arbitrary = genericArbitrary
