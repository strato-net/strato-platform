{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}

module BlockApps.Strato.TypesSpec where

import           Control.Applicative
import           Data.Aeson
import           Generic.Random
import           Test.Hspec
import           Test.Hspec.QuickCheck
import           Test.QuickCheck
import           Test.QuickCheck.Instances ()
import           Text.Read

import           BlockApps.Strato.Types

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do
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
  describe "Account" $ do
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

instance Arbitrary TransactionType where arbitrary = genericArbitrary uniform
instance Arbitrary Transaction where arbitrary = genericArbitrary uniform
instance Arbitrary x => Arbitrary (WithNext x) where
  arbitrary = genericArbitrary uniform
instance Arbitrary BlockData where arbitrary = genericArbitrary uniform
instance Arbitrary Block where arbitrary = genericArbitrary uniform
instance Arbitrary Account where arbitrary = genericArbitrary uniform
instance Arbitrary Difficulty where arbitrary = genericArbitrary uniform
instance Arbitrary TxCount where arbitrary = genericArbitrary uniform
instance Arbitrary Storage where arbitrary = genericArbitrary uniform
