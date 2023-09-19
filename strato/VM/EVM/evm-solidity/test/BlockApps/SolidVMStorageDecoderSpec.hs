{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}

module BlockApps.SolidVMStorageDecoderSpec where

import BlockApps.SolidVMStorageDecoder
import BlockApps.Solidity.SolidityValue
import BlockApps.Solidity.Value as V
import BlockApps.Strato.DeprecatedStorage (Storage (..), StorageKV (..))
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Data.Aeson as Ae
import Data.Aeson.QQ
import Data.Bifunctor
import qualified Data.ByteString as B
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import Data.List (sort)
import qualified Data.Map as M
import Data.Text (Text)
import SolidVM.Model.SolidString
import SolidVM.Model.Storable
import Test.Hspec
import Text.RawString.QQ

forceParse :: B.ByteString -> StoragePath
forceParse = either error id . parsePath

toInput :: (StoragePath, BasicValue) -> (HexStorage, HexStorage)
toInput = bimap pathToHexStorage basicToHexStorage

unHS :: HexStorage -> B.ByteString
unHS (HexStorage hs) = hs

toInputMap :: [(StoragePath, BasicValue)] -> M.Map B.ByteString B.ByteString
toInputMap = M.fromList . map (bimap unHS unHS) . map toInput

int :: Integer -> V.Value
int = SimpleValue . valueInt

bytes :: B.ByteString -> V.Value
bytes = SimpleValue . valueBytes

bool :: Bool -> V.Value
bool = SimpleValue . ValueBool

address :: Address -> V.Value
address = SimpleValue . ValueAccount . unspecifiedChain

bAccount :: Address -> BasicValue
bAccount = BAccount . unspecifiedChain

bAccountPayable :: Address -> BasicValue
bAccountPayable = BAccount . unspecifiedChain

bContract :: Text -> Address -> BasicValue
bContract t = BContract (textToLabel t) . unspecifiedChain

spec :: Spec
spec = do
  describe "StorageDelta" $ do
    let exStorage =
          HM.fromList
            [ ("count", int 99),
              ("name", bytes "iago")
            ]
    it "should be able to do nothing" $ do
      replayDeltas [] exStorage `shouldBe` Right exStorage

    it "should fail to do the impossible" $ do
      replayDeltas [(empty, BInteger 99)] exStorage `shouldBe` Left (MissingPath empty)

    it "should be able to add missing fields" $ do
      replayDeltas [(forceParse ".no_such_field", BInteger 300)] exStorage
        `shouldBe` Right
          ( HM.fromList
              [ ("count", int 99),
                ("name", bytes "iago"),
                ("no_such_field", int 300)
              ]
          )

    it "should be able to increment" $ do
      replayDeltas [(forceParse ".count", BInteger 100)] exStorage
        `shouldBe` Right (HM.fromList [("count", int 100), ("name", bytes "iago")])

    it "should be able to insert into a map" $ do
      let spine = HM.singleton "hashmap" . ValueMapping . M.fromList
          input = spine []
          want = spine [(valueInt 30, int 0x234)]
          got = replayDeltas [(forceParse ".hashmap<30>", BInteger 0x234)] input
      got `shouldBe` Right want

    it "should be able to insert into a struct" $ do
      let spine = HM.singleton "struct" . ValueStruct . M.singleton "name" . bytes
          input = spine "iago"
          want = spine "alladin"
          got = replayDeltas [(forceParse ".struct.name", BString "alladin")] input
      got `shouldBe` Right want

    it "should be able to insert into an array" $ do
      let spine = HM.singleton "array" . ValueArrayDynamic . I.fromList
          input = spine []
          want = spine [(0, int 0x882)]
          got = replayDeltas [(forceParse ".array[0]", BInteger 0x882)] input
      got `shouldBe` Right want

    it "should be able to target nested fields" $ do
      let spine =
            HM.singleton "array" . ValueArrayDynamic
              . I.singleton 3
              . ValueMapping
              . M.singleton (valueBytes "brimstone")
              . ValueStruct
              . M.singleton "and_fire"
              . int
          input = spine 0x12345
          want = spine 700000
          got = replayDeltas [(forceParse ".array[3]<\"brimstone\">.and_fire", BInteger 700000)] input
      got `shouldBe` Right want

    it "should be able to guess the intermediate structure from a path" $ do
      let input = HM.singleton "map" $ ValueMapping M.empty
          want =
            HM.singleton "map" . ValueMapping
              . M.singleton (valueBytes "array")
              . ValueArrayDynamic
              . I.singleton 9292
              . ValueStruct
              . M.singleton "array2"
              . ValueArrayDynamic
              . I.singleton 14
              . bool
              $ True
          got = replayDeltas [(forceParse ".map<\"array\">[9292].array2[14]", BBool True)] input
      got `shouldBe` Right want

    it "should be able to play multiple deltas" $ do
      let input = HM.singleton "map" $ ValueMapping M.empty
          want =
            HM.singleton "map" . ValueMapping . M.fromList $
              [ (valueInt 4, bool True),
                (valueInt 5, bool False),
                (valueInt 7, int 43)
              ]
          got =
            flip
              replayDeltas
              input
              [ (forceParse ".map<4>", BBool True),
                (forceParse ".map<7>", BInteger 43),
                (forceParse ".map<5>", BBool False)
              ]
      got `shouldBe` Right want

    it "should be able to override an array sentinel" $ do
      let spine = HM.singleton "arr" . ValueArrayDynamic . I.singleton 3
          cache = spine $ ValueArraySentinel 3
          want = spine $ ValueContract $ unspecifiedChain 0x888
      replayDeltas [(forceParse ".arr[3]", bContract "ok" 0x888)] cache `shouldBe` Right want

  describe "Synthesis" $ do
    it "can synthesize nothing" $ do
      synthesize [] `shouldBe` Right HM.empty

    it "can synthesize a number" $ do
      let input = [(forceParse ".age", BInteger 30)]
          want = HM.singleton "age" . int $ 30
      synthesize input `shouldBe` Right want

    it "can synthesize a mapping" $ do
      let input =
            [ (forceParse ".byDepth<20>", BString "river"),
              (forceParse ".byDepth<4>", BString "stream"),
              (forceParse ".byDepth<0>", BString "puddle"),
              (forceParse ".byDepth<100>", BString "bay")
            ]
          want =
            HM.singleton "byDepth" . ValueMapping $
              M.fromList
                [ (valueInt 20, bytes "river"),
                  (valueInt 4, bytes "stream"),
                  (valueInt 0, bytes "puddle"),
                  (valueInt 100, bytes "bay")
                ]
      synthesize input `shouldBe` Right want
      synthesize (reverse input) `shouldBe` Right want

    it "can synthesize a complicated contract" $ do
      let input =
            [ (forceParse ".person.age", BInteger 84),
              (forceParse ".person.height", BString "170cm"),
              (forceParse ".person.name", BString "Voltaire"),
              (forceParse ".person.books[0]", BString "Candide"),
              (forceParse ".person.books[2]", BString "Treatise on tolerance"),
              (forceParse ".age", BString "Enlightenment")
            ]
          want =
            HM.fromList
              [ ( "person",
                  ValueStruct $
                    M.fromList
                      [ ("age", int 84),
                        ("height", bytes "170cm"),
                        ("name", bytes "Voltaire"),
                        ( "books",
                          ValueArrayDynamic $
                            I.fromList
                              [ (0, bytes "Candide"),
                                (2, bytes "Treatise on tolerance")
                              ]
                        )
                      ]
                ),
                ("age", bytes "Enlightenment")
              ]
      synthesize input `shouldBe` Right want
      synthesize (reverse input) `shouldBe` Right want

    it "can synthesize an array with length" $ do
      let input =
            [ (forceParse ".owners.length", BInteger 2),
              (forceParse ".owners[0]", bAccount 0x88)
            ]
          want =
            HM.singleton "owners" . ValueArrayDynamic $
              I.fromList
                [(0, address 0x88), (2, ValueArraySentinel 2)]
      synthesize input `shouldBe` Right want
      synthesize (reverse input) `shouldBe` Right want

  describe "Bloch decoding" $ do
    it "can decode addresses" $ do
      let input = toInput (singleton "owner", bAccount 0xdeadbeef)
      decodeSolidVMValues [input]
        `shouldBe` [("owner", SolidityValueAsString "00000000000000000000000000000000deadbeef")]

    it "can decode everything" $ do
      let input =
            map
              toInput
              [ (singleton "addr", bAccount 0xdeadbeef),
                (singleton "boolean", BBool True),
                (singleton "contract", bContract "X" 0x999),
                (singleton "number", BInteger 77714314),
                (singleton "str", BString "Hello, World!"),
                (singleton "enum_val", BEnumVal "E" "C" 23),
                (fromList [Field "array_of_nums", ArrayIndex 1], BInteger 20),
                (fromList [Field "array_of_nums", ArrayIndex 2], BInteger 40),
                (fromList [Field "array_of_nums", ArrayIndex 3], BInteger 77),
                (fromList [Field "strukt", Field "first_field"], BInteger 887),
                (fromList [Field "strukt", Field "second_field"], BString "CLOROX DISINFECTING WIPES"),
                (fromList [Field "set"], BMappingSentinel),
                (fromList [Field "set", MapIndex (INum 22)], BBool True),
                (fromList [Field "set", MapIndex (INum 23)], BBool True),
                (fromList [Field "set", MapIndex (INum 46)], BBool True)
              ]
      toJSON (M.fromList (decodeSolidVMValues input))
        `shouldBe` [aesonQQ|{
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

    it "can encode a map of strings" $ do
      let input =
            map
              toInput
              [ (singleton "strMap", BMappingSentinel),
                (fromList [Field "strMap", MapIndex (IText "ok")], BInteger 17),
                (fromList [Field "strMap", MapIndex (IText "\x76\x90\x00\x90")], BInteger 81)
              ]
          got = decodeSolidVMValues input
      got
        `shouldBe` [ ( "strMap",
                       SolidityObject
                         [ ("ok", SolidityValueAsString "17"),
                           ([r|v\144\NUL\144|], SolidityValueAsString "81")
                         ]
                     )
                   ]

    it "can deal with array lengths" $ do
      let Success input = rawInput
          kvs = map (\Storage {storageKV = SolidVMEntry k v} -> (k, v)) input
          got = decodeSolidVMValues kvs
      got
        `shouldBe` [ ( "fields",
                       SolidityArray
                         [ SolidityValueAsString "3032415547323000000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "3731313532383138373337333436393330300000000000000000000000000000",
                           SolidityValueAsString "3339393034313432000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "3330534550313900000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "5900000000000000000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "3530383038313731303039313400000000000000000000000000000000000000",
                           SolidityValueAsString "544b545400000000000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "3538383020202020202020202020203000000000000000000000000000000000",
                           SolidityValueAsString "3433320000000000000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "4745483156325a384d0000000000000000000000000000000000000000000000",
                           SolidityValueAsString "2f00000000000000000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "3431363739343236303536000000000000000000000000000000000000000000",
                           SolidityValueAsString "5553443200000000000000000000000000000000000000000000000000000000",
                           SolidityValueAsString "4f4c440000000000000000000000000000000000000000000000000000000000"
                         ]
                     )
                   ]

  describe "Slipstream decoding" $ do
    it "can decode an address (with empty cache)" $ do
      let input = toInputMap [(singleton "owner", bAccount 0xdeadbeef)]
          got = decodeCacheValues input []
      got
        `shouldBe` [("owner", SimpleValue $ ValueAccount $ unspecifiedChain 0xdeadbeef)]

    it "can decode an empty mapping" $ do
      let input = toInputMap [(singleton "mp", BMappingSentinel)]
      decodeCacheValues input [] `shouldBe` [("mp", ValueMapping M.empty)]

    it "can decode everything (with empty cache)" $ do
      let input =
            toInputMap
              [ -- We are currently filtering out arrays, maps from decodeCacheValues, since cirrus
                -- should not handle these types...  the tests for arrays and maps also need to
                -- be filtered out
                (singleton "addr", bAccount 0xdeadbeef),
                (singleton "boolean", BBool True),
                (singleton "contract", bContract "X" 0x999),
                (singleton "number", BInteger 77714314),
                (singleton "str", BString "Hello, World!"),
                (singleton "enum_val", BEnumVal "E" "C" 22)
                --                , (fromList [Field "array_of_nums", ArrayIndex 1], BInteger 20)
                --                , (fromList [Field "array_of_nums", ArrayIndex 2], BInteger 40)
                --                , (fromList [Field "array_of_nums", ArrayIndex 3], BInteger 77)
                --                , (fromList [Field "array_of_nums", Field "length"], BInteger 4)
                --                , (fromList [Field "strukt", Field "first_field"], BInteger 887)
                --                , (fromList [Field "strukt", Field "second_field"], BString "CLOROX DISINFECTING WIPES")
                --                , (fromList [Field "set"], BMappingSentinel)
                --                , (fromList [Field "set", MapIndex (INum 22)], BBool True)
                --                , (fromList [Field "set", MapIndex (INum 23)], BBool True)
                --                , (fromList [Field "set", MapIndex (INum 46)], BBool True)
              ]
          got = decodeCacheValues input []
      sort got
        `shouldBe` sort
          [ ("addr", address 0xdeadbeef),
            --          , ("array_of_nums", ValueArrayDynamic . I.fromList $
            --               zip [1..] [ int 20, int 40, int 77, ValueArraySentinel 4])
            ("boolean", bool True),
            ("contract", ValueContract $ unspecifiedChain 0x999),
            ("enum_val", ValueEnum "E" "C" 22),
            ("number", int 77714314),
            --          , ("strukt", ValueStruct $ M.fromList
            --              [ ("first_field", int 887)
            --              , ("second_field", SimpleValue $ ValueBytes Nothing "CLOROX DISINFECTING WIPES")
            --              ])
            --          , ("set", ValueMapping $ M.fromList
            --              [ (ValueInt True Nothing 22, bool True)
            --              , (ValueInt True Nothing 23, bool True)
            --              , (ValueInt True Nothing 46, bool True)
            --              ])
            ("str", SimpleValue $ ValueBytes Nothing "Hello, World!")
          ]
    {-
        it "can deal with array lengths (with empty cache)" $ do
          let Success input' = rawInput
              input = M.fromList $ map (\Storage{storageKV=SolidVMEntry (HexStorage k) (HexStorage v)} -> (k, v)) input'
              got = decodeCacheValues input []
          got `shouldBe` [("fields", ValueArrayDynamic $ tosparse
                  [ bytes "3032415547323000000000000000000000000000000000000000000000000000"
                  , bytes "3731313532383138373337333436393330300000000000000000000000000000"
                  , bytes "3339393034313432000000000000000000000000000000000000000000000000"
                  , bytes "3330534550313900000000000000000000000000000000000000000000000000"
                  , bytes "5900000000000000000000000000000000000000000000000000000000000000"
                  , bytes "3530383038313731303039313400000000000000000000000000000000000000"
                  , bytes "544b545400000000000000000000000000000000000000000000000000000000"
                  , bytes "3538383020202020202020202020203000000000000000000000000000000000"
                  , bytes "3433320000000000000000000000000000000000000000000000000000000000"
                  , bytes "4745483156325a384d0000000000000000000000000000000000000000000000"
                  , bytes "2f00000000000000000000000000000000000000000000000000000000000000"
                  , bytes "3431363739343236303536000000000000000000000000000000000000000000"
                  , bytes "5553443200000000000000000000000000000000000000000000000000000000"
                  , bytes "4f4c440000000000000000000000000000000000000000000000000000000000"
                  , ValueArraySentinel 14])]
    -}
    describe "Simple field updates" $ do
      it "can update ints" $ do
        let input = toInputMap [(singleton "number", BInteger 100)]
            cache = [("number", int 99)]
        decodeCacheValues input cache `shouldBe` [("number", int 100)]

      it "can update addresses" $ do
        let input = toInputMap [(singleton "address", bAccount 0xddba11)]
            cache = [("address", address 0x21345)]
        decodeCacheValues input cache `shouldBe` [("address", address 0xddba11)]

rawInput :: Result [Storage]
rawInput =
  fromJSON
    [aesonQQ|
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
