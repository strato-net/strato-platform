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
    it "should be backwords compatible without contractName" $
      let input = "{   \
            \ \"contractRoot\": \"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\
            \ \"next\": \"/eth/v1.2/account?address=50e2752ac29be7777aff0c40850d96cbfc01eaa4&index=5\", \
            \ \"kind\": \"AddressStateRef\",\
            \ \"balance\": \"999999999999931774202\",\
            \ \"address\": \"50e2752ac29be7777aff0c40850d96cbfc01eaa4\",\
            \ \"latestBlockNum\": 21,\
            \ \"codeHash\": \"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470\",\
            \ \"code\": \"\",\
            \ \"source\": \"\",\
            \ \"nonce\": 19 }"
          acc = eitherDecode input :: Either String Account
      in fmap accountContractName acc `shouldBe` Right Nothing
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
