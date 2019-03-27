{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}

{-# OPTIONS_GHC -fno-warn-unused-imports #-} -- TODO(tim): Remove
module BlockApps.SolidVMStorageDecoderSpec where

import Data.Aeson
import Data.Aeson.QQ
import Data.Bifunctor
import qualified Data.ByteString as B
import Data.List (sort)
import qualified Data.Map as M
import Test.Hspec

import BlockApps.SolidVMStorageDecoder
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Value as SV
import BlockApps.Strato.Types
import Blockchain.SolidVM.Model
import SolidVM.Model.Storable

forceParse :: B.ByteString -> StoragePath
forceParse = either error id . parsePath

toInput :: (StoragePath, BasicValue) -> (HexStorage, HexStorage)
toInput = bimap pathToHexStorage basicToHexStorage

unHS :: HexStorage -> B.ByteString
unHS (HexStorage hs) = hs

toInputMap :: [(StoragePath, BasicValue)] -> M.Map B.ByteString B.ByteString
toInputMap = M.fromList . map (bimap unHS unHS) . map toInput

spec :: Spec
spec = do
  return ()
  -- describe "StorageDelta" $ do
  --   let exStorage = HM.fromList [ ("count", BasicValue $ BInteger 99)
  --                               , ("name", BasicValue $ BString "iago")]
  --   it "should be able to do nothing" $ do
  --     replayDelta [] exStorage `shouldBe` Right exStorage

  --   it "should fail to do the impossible" $ do
  --     replayDelta [(empty, BInteger 99)] exStorage `shouldBe` Left (MissingPath empty)
  --     replayDelta [(forceParse ".no_such_field", BInteger 300)] exStorage
  --       `shouldBe` Left (MissingPath $ singleton "no_such_field")

  --   it "should be able to increment" $ do
  --     replayDelta [(forceParse ".count", BInteger 100)] exStorage `shouldBe`
  --       Right (HM.fromList [("count", BasicValue $ BInteger 100), ("name", BasicValue $ BString "iago")])

  --   it "should be able to insert into a map" $ do
  --     let spine = HM.singleton "hashmap" . SMapping . HM.fromList
  --         input = spine []
  --         want  = spine [(INum 30, BasicValue $ BInteger 0x234)]
  --         got = replayDelta [(forceParse ".hashmap<30>", BInteger 0x234)] input
  --     got `shouldBe` Right want

  --   it "should be able to insert into a struct" $ do
  --     let spine = HM.singleton "struct" . SStruct . HM.singleton "name" . BasicValue . BString
  --         input = spine "iago"
  --         want  = spine "alladin"
  --         got = replayDelta [(forceParse ".struct.name", BString "alladin")] input
  --     got `shouldBe` Right want

  --   it "should be able to insert into an array" $ do
  --     let spine = HM.singleton "array" . SArray . I.fromList
  --         input = spine []
  --         want  = spine [(0, BasicValue $ BInteger 0x882)]
  --         got = replayDelta [(forceParse ".array[0]", BInteger 0x882)] input
  --     got `shouldBe` Right want

  --   it "should be able to target nested fields" $ do
  --     let spine = HM.singleton "array" . SArray
  --               . I.singleton 3 . SMapping
  --               . HM.singleton (IText "brimstone") . SStruct
  --               . HM.singleton "and_fire" . BasicValue . BInteger
  --         input = spine 0x12345
  --         want  = spine 700000
  --         got = replayDelta [(forceParse ".array[3]<\"brimstone\">.and_fire", BInteger 700000)] input
  --     got `shouldBe` Right want

  --   it "should be able to guess the intermediate structure from a path" $ do
  --     let input = HM.singleton "map" $ SMapping HM.empty
  --         want = HM.singleton "map" . SMapping
  --              . HM.singleton (IText "array") . SArray
  --              . I.singleton 9292 . SStruct
  --              . HM.singleton "array2" . SArray
  --              . I.singleton 14 . BasicValue . BBool $ True
  --         got = replayDelta [(forceParse ".map<\"array\">[9292].array2[14]", BBool True)] input
  --     got `shouldBe` Right want

  --   it "should be able to play multiple deltas" $ do
  --     let input = HM.singleton "map" $ SMapping HM.empty
  --         want = HM.singleton "map" . SMapping . HM.fromList
  --              $ [ (INum 4, BasicValue $ BBool True)
  --                , (INum 5, BasicValue $ BBool False)
  --                , (INum 7, BasicValue $ BInteger 43)]
  --         got = flip replayDelta input [ (forceParse ".map<4>", BBool True)
  --                                      , (forceParse ".map<7>", BInteger 43)
  --                                      , (forceParse ".map<5>", BBool False)]
  --     got `shouldBe` Right want

  -- describe "Analysis" $ do
  --   it "can analyze nothing" $ do
  --     analyze HM.empty `shouldBe` []

  --   it "can analyze a number" $ do
  --     analyze (HM.singleton "count" (BasicValue (BInteger 99)))
  --       `shouldBe` [(forceParse ".count", BInteger 99)]

  --   it "can analyze a map" $ do
  --     let input = HM.singleton "coll" . SMapping
  --               $ HM.fromList [(IText "monarch", BasicValue $ BString "4cm"),
  --                              (IText "mariposa", BasicValue $ BInteger 6)]
  --     analyze input `shouldMatchList` [(forceParse ".coll<\"monarch\">", BString "4cm")
  --                                     , (forceParse ".coll<\"mariposa\">", BInteger 6)]

  --   it "can analyze a map of maps" $ do
  --     let input = HM.singleton "coll" . SMapping
  --               $ HM.fromList [
  --               (IText "results", SMapping $ HM.fromList [
  --                 (IText "ok", BasicValue $ BInteger 20),
  --                 (IText "fail", BasicValue $ BInteger 4),
  --                 (IText "pending", BasicValue $ BInteger 2)]),
  --               (IText "todo", SMapping $ HM.fromList [
  --                 (IText "tasks", BasicValue $ BInteger 3),
  --                 (IText "stories", BasicValue $ BInteger 2)])]
  --     analyze input `shouldMatchList`
  --        [ (forceParse ".coll<\"results\"><\"ok\">", BInteger 20)
  --        , (forceParse ".coll<\"results\"><\"fail\">", BInteger 4)
  --        , (forceParse ".coll<\"results\"><\"pending\">", BInteger 2)
  --        , (forceParse ".coll<\"todo\"><\"tasks\">", BInteger 3)
  --        , (forceParse ".coll<\"todo\"><\"stories\">", BInteger 2)
  --        ]
  --   it "can analyze an array" $ do
  --     let input = HM.singleton "measurements" . SArray
  --               $ I.fromList [
  --                 (0, BasicValue $ BInteger 22),
  --                 (1, BasicValue $ BInteger 30),
  --                 (3, BasicValue $ BInteger 0)]
  --     analyze input `shouldMatchList`
  --       [ (forceParse ".measurements[0]", BInteger 22)
  --       , (forceParse ".measurements[1]", BInteger 30)
  --       , (forceParse ".measurements[3]", BInteger 0)
  --       ]

  --   it "can analyze a struct" $ do
  --     let input = HM.singleton "person" . SStruct
  --               $ HM.fromList [
  --                 ("age", BasicValue $ BInteger 84),
  --                 ("height", BasicValue $ BString "170cm"),
  --                 ("name", BasicValue $ BString "Voltaire"),
  --                 ("books", SArray $ I.fromList [
  --                     (0, BasicValue $ BString "Candide"),
  --                     (2, BasicValue $ BString "Treatise on tolerance")
  --                     ])
  --               ]
  --     analyze input `shouldMatchList`
  --       [ (forceParse ".person.age", BInteger 84)
  --       , (forceParse ".person.height", BString "170cm")
  --       , (forceParse ".person.name", BString "Voltaire")
  --       , (forceParse ".person.books[0]", BString "Candide")
  --       , (forceParse ".person.books[2]", BString "Treatise on tolerance")
  --       ]

  -- describe "Synthesis" $ do
  --   it "can synthesize nothing" $ do
  --     synthesize [] `shouldBe` Right HM.empty

  --   it "can synthesize a number" $ do
  --     let input = [(forceParse ".age", BInteger 30)]
  --         want = HM.singleton "age" . BasicValue . BInteger $ 30
  --     synthesize input `shouldBe` Right want

  --   it "can synthesize a mapping" $ do
  --     let input = [ (forceParse ".byDepth<20>", BString "river")
  --                 , (forceParse ".byDepth<4>", BString "stream")
  --                 , (forceParse ".byDepth<0>", BString "puddle")
  --                 , (forceParse ".byDepth<100>", BString "bay")
  --                 ]
  --         want = HM.singleton "byDepth" . SMapping $ HM.fromList
  --              [ (INum 20, BasicValue $ BString "river")
  --              , (INum 4, BasicValue $ BString "stream")
  --              , (INum 0, BasicValue $ BString "puddle")
  --              , (INum 100, BasicValue $ BString "bay")
  --              ]
  --     synthesize input `shouldBe` Right want
  --     synthesize (reverse input) `shouldBe` Right want

  --   it "can synthesize a complicated contract" $ do
  --     let input = [ (forceParse ".person.age", BInteger 84)
  --                 , (forceParse ".person.height", BString "170cm")
  --                 , (forceParse ".person.name", BString "Voltaire")
  --                 , (forceParse ".person.books[0]", BString "Candide")
  --                 , (forceParse ".person.books[2]", BString "Treatise on tolerance")
  --                 , (forceParse ".age", BString "Enlightenment")
  --                 ]
  --         want = HM.fromList
  --           [ ("person", SStruct $ HM.fromList
  --               [ ("age", BasicValue $ BInteger 84)
  --               , ("height", BasicValue $ BString "170cm")
  --               , ("name", BasicValue $ BString "Voltaire")
  --               , ("books", SArray $ I.fromList
  --                   [ (0, BasicValue $ BString "Candide")
  --                   , (2, BasicValue $ BString "Treatise on tolerance")
  --                   ])])
  --           , ("age", BasicValue $ BString "Enlightenment")
  --           ]
  --     synthesize input `shouldBe` Right want
  --     synthesize (reverse input) `shouldBe` Right want

  --   it "can synthesize an array with length" $ do
  --     let input = [ (forceParse ".owners.length", BInteger 2)
  --                 , (forceParse ".owners[0]", BAddress 0x88)
  --                 ]
  --         want = HM.singleton "owners" . SArray $ I.fromList
  --           [(0, BasicValue $ BAddress 0x88), (2, SArraySentinel 2)]
  --     synthesize input `shouldBe` Right want
  --     synthesize (reverse input) `shouldBe` Right want

  -- describe "Bloch decoding" $ do
  --   it "can decode addresses" $ do
  --     let input = toInput (singleton "owner",  BAddress 0xdeadbeef)
  --     decodeSolidVMValues [input] `shouldBe`
  --       [("owner", SolidityValueAsString "00000000000000000000000000000000deadbeef")]

  --   it "can decode everything" $ do
  --     let input = map toInput
  --               [ (singleton "addr", BAddress 0xdeadbeef)
  --               , (singleton "boolean", BBool True)
  --               , (singleton "contract", BContract "X" 0x999)
  --               , (singleton "number", BInteger 77714314)
  --               , (singleton "str", BString "Hello, World!")
  --               , (singleton "enum_val", BEnumVal "E" "C")
  --               , (fromList [Field "array_of_nums", ArrayIndex 1], BInteger 20)
  --               , (fromList [Field "array_of_nums", ArrayIndex 2], BInteger 40)
  --               , (fromList [Field "array_of_nums", ArrayIndex 3], BInteger 77)
  --               , (fromList [Field "strukt", Field "first_field"], BInteger 887)
  --               , (fromList [Field "strukt", Field "second_field"], BString "CLOROX DISINFECTING WIPES")
  --               , (fromList [Field "set", MapIndex (INum 22)], BBool True)
  --               , (fromList [Field "set", MapIndex (INum 23)], BBool True)
  --               , (fromList [Field "set", MapIndex (INum 46)], BBool True)
  --               ]
  --     toJSON (M.fromList (decodeSolidVMValues input)) `shouldBe` [aesonQQ|{
  --          "addr": "00000000000000000000000000000000deadbeef",
  --          "array_of_nums": [
  --            "0",
  --            "20",
  --            "40",
  --            "77"
  --          ],
  --          "boolean": true,
  --          "contract": "0000000000000000000000000000000000000999",
  --          "enum_val": "C",
  --          "number": "77714314",
  --          "strukt": {
  --            "first_field": "887",
  --            "second_field": "CLOROX DISINFECTING WIPES"
  --          },
  --          "set": {
  --            "22": true,
  --            "23": true,
  --            "46": true
  --          },
  --          "str": "Hello, World!"
  --        }|]

  --   it "can deal with array lengths" $ do
  --     let Success input = rawInput
  --         kvs = map (\Storage{storageKV=SolidVMEntry k v} -> (k, v)) input
  --         got = decodeSolidVMValues kvs
  --     got `shouldBe` [("fields", SolidityArray
  --             [ SolidityValueAsString "3032415547323000000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "3731313532383138373337333436393330300000000000000000000000000000"
  --             , SolidityValueAsString "3339393034313432000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "3330534550313900000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "5900000000000000000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "3530383038313731303039313400000000000000000000000000000000000000"
  --             , SolidityValueAsString "544b545400000000000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "3538383020202020202020202020203000000000000000000000000000000000"
  --             , SolidityValueAsString "3433320000000000000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "4745483156325a384d0000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "2f00000000000000000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "3431363739343236303536000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "5553443200000000000000000000000000000000000000000000000000000000"
  --             , SolidityValueAsString "4f4c440000000000000000000000000000000000000000000000000000000000"])]

  -- describe "Slipstream decoding" $ do
  --   let int :: Integer -> SV.Value
  --       int = SimpleValue . ValueInt True Nothing

  --       bool :: Bool -> SV.Value
  --       bool = SimpleValue . ValueBool

  --       address :: Address -> SV.Value
  --       address = SimpleValue . ValueAddress

  --   it "can decode an address (with empty cache)" $ do
  --     let input = toInputMap [(singleton "owner",  BAddress 0xdeadbeef)]
  --         got = decodeCacheValues input []
  --     got `shouldBe`
  --       [("owner", SimpleValue $ ValueAddress 0xdeadbeef)]

  --   it "can decode everything (with empty cache)" $ do
  --     let input = toInputMap
  --               [ (singleton "addr", BAddress 0xdeadbeef)
  --               , (singleton "boolean", BBool True)
  --               , (singleton "contract", BContract "X" 0x999)
  --               , (singleton "number", BInteger 77714314)
  --               , (singleton "str", BString "Hello, World!")
  --               , (singleton "enum_val", BEnumVal "E" "C")
  --               , (fromList [Field "array_of_nums", ArrayIndex 1], BInteger 20)
  --               , (fromList [Field "array_of_nums", ArrayIndex 2], BInteger 40)
  --               , (fromList [Field "array_of_nums", ArrayIndex 3], BInteger 77)
  --               , (fromList [Field "strukt", Field "first_field"], BInteger 887)
  --               , (fromList [Field "strukt", Field "second_field"], BString "CLOROX DISINFECTING WIPES")
  --               , (fromList [Field "set", MapIndex (INum 22)], BBool True)
  --               , (fromList [Field "set", MapIndex (INum 23)], BBool True)
  --               , (fromList [Field "set", MapIndex (INum 46)], BBool True)
  --               ]
  --         got = decodeCacheValues input []
  --     got `shouldBe` sort
  --         [ ("addr", address 0xdeadbeef)
  --         , ("array_of_nums", ValueArrayDynamic [ int 0, int 20, int 40, int 77])
  --         , ("boolean", bool True)
  --         , ("contract", ValueContract 0x999)
  --         , ("enum_val", ValueEnum "E" "C" 0x77777)
  --         , ("number", int 77714314)
  --         , ("strukt", ValueStruct
  --             [ ("first_field", int 887)
  --             , ("second_field", SimpleValue $ ValueBytes Nothing "CLOROX DISINFECTING WIPES")
  --             ])
  --         , ("set", ValueMapping $ M.fromList
  --             [ (ValueInt True Nothing 22, bool True)
  --             , (ValueInt True Nothing 23, bool True)
  --             , (ValueInt True Nothing 46, bool True)
  --             ])
  --         , ("str", SimpleValue $ ValueBytes Nothing "Hello, World!")
  --         ]

  --   it "can deal with array lengths (with empty cache)" $ do
  --     let Success input' = rawInput
  --         input = M.fromList $ map (\Storage{storageKV=SolidVMEntry (HexStorage k) (HexStorage v)} -> (k, v)) input'
  --         bytes = SimpleValue . ValueBytes Nothing
  --         got = decodeCacheValues input []
  --     got `shouldBe` [("fields", ValueArrayDynamic
  --             [ bytes "3032415547323000000000000000000000000000000000000000000000000000"
  --             , bytes "3731313532383138373337333436393330300000000000000000000000000000"
  --             , bytes "3339393034313432000000000000000000000000000000000000000000000000"
  --             , bytes "3330534550313900000000000000000000000000000000000000000000000000"
  --             , bytes "5900000000000000000000000000000000000000000000000000000000000000"
  --             , bytes "3530383038313731303039313400000000000000000000000000000000000000"
  --             , bytes "544b545400000000000000000000000000000000000000000000000000000000"
  --             , bytes "3538383020202020202020202020203000000000000000000000000000000000"
  --             , bytes "3433320000000000000000000000000000000000000000000000000000000000"
  --             , bytes "4745483156325a384d0000000000000000000000000000000000000000000000"
  --             , bytes "2f00000000000000000000000000000000000000000000000000000000000000"
  --             , bytes "3431363739343236303536000000000000000000000000000000000000000000"
  --             , bytes "5553443200000000000000000000000000000000000000000000000000000000"
  --             , bytes "4f4c440000000000000000000000000000000000000000000000000000000000"])]

  --   describe "Simple field updates" $ do
  --     it "can update ints" $ do
  --       let input = toInputMap [(singleton "number", BInteger 100)]
  --           cache = [("number", int 99)]
  --       decodeCacheValues input cache `shouldBe` [("number", int 100)]

  --     it "can update addresses" $ do
  --       let input = toInputMap [(singleton "address", BAddress 0xddba11)]
  --           cache = [("address", SimpleValue $ ValueAddress 0x21345)]
  --       decodeCacheValues input cache `shouldBe` [("address", address 0xddba11)]

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
