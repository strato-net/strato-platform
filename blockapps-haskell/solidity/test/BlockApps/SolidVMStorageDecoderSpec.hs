{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
module BlockApps.SolidVMStorageDecoderSpec where

import Data.Aeson
import Data.Aeson.QQ
import Data.Bifunctor
import qualified Data.Map as M
import Test.Hspec

import BlockApps.SolidVMStorageDecoder
import BlockApps.Solidity.SolidityValue
import Blockchain.SolidVM.Model
import SolidVM.Model.Storable

toInput :: (StoragePath, BasicValue) -> (HexStorage, HexStorage)
toInput = bimap pathToHexStorage basicToHexStorage

spec :: Spec
spec = do
  it "can decode addresses" $ do
    let input = toInput (singleton "owner",  BAddress 0xdeadbeef)
    decodeSolidVMValues [input] `shouldBe`
      [("owner", SolidityValueAsString "00000000000000000000000000000000deadbeef")]

  it "can decode everything" $ do
    let input = map toInput
              [ (singleton "addr", BAddress 0xdeadbeef)
              , (singleton "boolean", BBool True)
              , (singleton "contract", BContract "X" 0x999)
              , (singleton "number", BInteger 77714314)
              , (singleton "str", BString "Hello, World!")
              , (singleton "enum_val", BEnumVal "E" "C")
              , (fromList [Field "array_of_nums", ArrayIndex 1], BInteger 20)
              , (fromList [Field "array_of_nums", ArrayIndex 2], BInteger 40)
              , (fromList [Field "array_of_nums", ArrayIndex 3], BInteger 77)
              , (fromList [Field "strukt", Field "first_field"], BInteger 887)
              , (fromList [Field "strukt", Field "second_field"], BString "CLOROX DISINFECTING WIPES")
              , (fromList [Field "set", MapIndex (INum 22)], BBool True)
              , (fromList [Field "set", MapIndex (INum 23)], BBool True)
              , (fromList [Field "set", MapIndex (INum 46)], BBool True)
              ]
    toJSON (M.fromList (decodeSolidVMValues input)) `shouldBe` [aesonQQ|{
         "addr": "00000000000000000000000000000000deadbeef",
         "array_of_nums": [
           "0",
           "20",
           "40",
           "77"
         ],
         "boolean": true,
         "contract": "0000000000000000000000000000000000000999",
         "enum_val": "C",
         "number": "77714314",
         "strukt": {
           "first_field": "887",
           "second_field": "CLOROX DISINFECTING WIPES"
         },
         "set": {
           "22": true,
           "23": true,
           "46": true
         },
         "str": "Hello, World!"
       }|]
