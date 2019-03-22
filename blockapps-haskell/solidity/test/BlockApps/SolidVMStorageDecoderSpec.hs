{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}
module BlockApps.SolidVMStorageDecoderSpec where

import Data.Aeson
import Data.Aeson.QQ
import Data.Bifunctor
import qualified Data.Map as M
import Test.Hspec

import BlockApps.SolidVMStorageDecoder
import BlockApps.Solidity.SolidityValue
import BlockApps.Strato.Types
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

  it "can deal with array lengths" $ do
    let Success input = rawInput
        kvs = map (\Storage{storageKV=SolidVMEntry k v} -> (k, v)) input
        got = decodeSolidVMValues kvs
    got `shouldBe` [("fields", SolidityArray
            [ SolidityValueAsString "3032415547323000000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "3731313532383138373337333436393330300000000000000000000000000000"
            , SolidityValueAsString "3339393034313432000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "3330534550313900000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "5900000000000000000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "3530383038313731303039313400000000000000000000000000000000000000"
            , SolidityValueAsString "544b545400000000000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "3538383020202020202020202020203000000000000000000000000000000000"
            , SolidityValueAsString "3433320000000000000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "4745483156325a384d0000000000000000000000000000000000000000000000"
            , SolidityValueAsString "2f00000000000000000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "3431363739343236303536000000000000000000000000000000000000000000"
            , SolidityValueAsString "5553443200000000000000000000000000000000000000000000000000000000"
            , SolidityValueAsString "4f4c440000000000000000000000000000000000000000000000000000000000"])]

rawInput :: Result [Storage]
rawInput = fromJSON [aesonQQ|
  [
  {
    "kind": "SolidVM",
    "value": "c2000e",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64732e6c656e677468"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033303332343135353437333233303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b305d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84032663030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b31305d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033343331333633373339333433323336333033353336303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b31315d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84035353533343433323030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b31325d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84034663463343430303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b31335d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033373331333133353332333833313338333733333337333333343336333933333330333030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b315d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033333339333933303334333133343332303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b325d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033333330353334353530333133393030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b335d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84035393030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b345d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033353330333833303338333133373331333033303339333133343030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b355d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84035343462353435343030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b365d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033353338333833303230323032303230323032303230323032303230323033303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b375d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84033343333333230303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b385d"
  },
  {
    "kind": "SolidVM",
    "value": "f84301b84034373435343833313536333235613338346430303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030",
    "address": "06383e9c73a699fe87e1728e2e97f913085ed0dd",
    "key": "2e6669656c64735b395d"
  }
]
|]
