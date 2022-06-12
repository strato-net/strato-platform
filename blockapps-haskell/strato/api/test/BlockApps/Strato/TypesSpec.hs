{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TypeApplications  #-}

module BlockApps.Strato.TypesSpec where

import           Control.Applicative
import           Data.Aeson
import           Data.Aeson.QQ
import           Test.Hspec
import           Test.Hspec.QuickCheck
import           Test.QuickCheck
import           Test.QuickCheck.Instances ()
import           Text.Read

import           Blockchain.SolidVM.Model
import           BlockApps.Strato.Types
import           BlockApps.Bloc22.API.TypeWrappers

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do
  describe "Strung" $
    prop "has inverse JSON decode/encode" $ jsonProp @ (Strung Integer)
  describe "Hex" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ (Hex Word)
    prop "has inverse read/show" $ readShowProp @ (Hex Word)    
  describe "Storage" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ Storage

    it "maintains compatibility" $ do
      let oldStyle = [aesonQQ| {
          "kind": "EVM",
          "value": "00000000000000000000000000000000000000000000000000000000000020b6",
          "address": "65cf21347c2978d8352b7f144f92f3036b61b6b4",
          "key": "0000000000000000000000000000000000000000000000000000000000000000"
        }|]
      eitherDecode (encode oldStyle) `shouldBe` Right (Storage
          { storageAddress = 0x65cf21347c2978d8352b7f144f92f3036b61b6b4
          , storageKV = EVMEntry (Hex 0x0) (Hex 0x20b6)
          , storageChainId = Nothing
          , storageKind = EVM
          })

    it "can parse solidvm storage" $ do
      let solidVMStyle = [aesonQQ| {
          "kind": "SolidVM",
          "value": "c20001",
          "address": "5613461cbc3297c5fd851bd4e53b648a87e2c4da",
          "key": "2e76616c7565732e6c656e677468"
         }|]
      eitherDecode (encode solidVMStyle) `shouldBe` Right (Storage
          { storageAddress = 0x5613461cbc3297c5fd851bd4e53b648a87e2c4da
          , storageKV = SolidVMEntry (HexStorage ".values.length") (HexStorage "\xc2\x00\x01")
          , storageChainId = Nothing
          , storageKind = SolidVM
          })


-- helpers

jsonProp :: (Eq x, Show x, FromJSON x, ToJSON x) => x -> Property
jsonProp = liftA2 (===) (decode . encode) Just

readShowProp :: (Eq x, Read x, Show x) => x -> Property
readShowProp = liftA2 (===) (readMaybe . show) Just

-- orphans

instance Arbitrary Storage where
  arbitrary = do
    addr <- arbitrary
    kv <- arbitrary
    cid <- arbitrary
    let ck = case kv of
                SolidVMEntry{} -> SolidVM
                EVMEntry{} -> EVM
    return $ Storage addr kv cid ck
