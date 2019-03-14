import qualified Data.ByteString as B
import Control.Monad
import Data.Either (isLeft)
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import Test.Hspec
import UnliftIO.Exception

import Blockchain.Data.RLP
import SolidVM.Model.Storable

main :: IO ()
main = hspec spec

forceParse :: B.ByteString -> StoragePath
forceParse = either error id . parsePath

toAns :: [StoragePathPiece] -> Either a StoragePath
toAns = Right . fromList

spec :: Spec
spec = do
  describe "ByteString escaping" $ do

    it "should be able to escape quotes" $ do
      escapeKey "" `shouldBe` ""
      escapeKey (B.singleton 0x22) `shouldBe` B.pack [0x5c, 0x22]
      escapeKey "ok\"fail\"ok\"" `shouldBe` "ok\\\"fail\\\"ok\\\""

    it "should be able to unescape quotes" $ do
      unescapeKey "" `shouldBe` ""
      unescapeKey (B.pack [0x5c, 0x22]) `shouldBe` B.singleton 0x22
      unescapeKey "ok\\\"fail\\\"ok\\\"" `shouldBe` "ok\"fail\"ok\""

  describe "StoragePath" $ do
    it "should be able to unambiguously parse a path" $ do
      parsePath "" `shouldBe` toAns []
      parsePath "[3]" `shouldBe` toAns [ArrayIndex 3]
      parsePath "<773472>" `shouldBe` toAns [MapIndex (INum 773472)]
      parsePath "<\"xor\">" `shouldBe` toAns [MapIndex (IText "xor")]
      parsePath "<\"\">" `shouldBe` toAns [MapIndex (IText "")]
      parsePath ".extra" `shouldBe` toAns [Field "extra"]
      parsePath ".hashmap" `shouldBe` toAns [Field "hashmap"]
      parsePath ".hashmap<30>" `shouldBe` toAns [Field "hashmap", MapIndex (INum 30)]
      parsePath ".hashmap<true>" `shouldBe` toAns [Field "hashmap", MapIndex (IBool True)]
      parsePath ".hashmap<false>" `shouldBe` toAns [Field "hashmap", MapIndex (IBool False)]
      parsePath ".hashmap<a:ca35b7d915458ef540ade6068dfe2f44e8fa733c>" `shouldBe`
        toAns [Field "hashmap", MapIndex (IAddress 0xca35b7d915458ef540ade6068dfe2f44e8fa733c)]

    it "should fail on badly formed paths" $ do
      let checkFail = (`shouldSatisfy` isLeft) . parsePath
      checkFail ".hashmap<3"
      checkFail ".hashmap<\"unfinished string>"
      checkFail ".hashmap<tr>"
      checkFail ".array[\"wrong type\"]"
      checkFail ".array[false]"
      checkFail ".hashmap<a:>"
      checkFail ".hashmap<a:8888>"

    it "should be able to unparse a path" $ do
      let unparse = unparsePath . fromList
      unparse [] `shouldBe` ""
      unparse [ArrayIndex 3] `shouldBe` "[3]"
      unparse [MapIndex (INum 773472)] `shouldBe` "<773472>"
      unparse [MapIndex (IText "xor")] `shouldBe` "<\"xor\">"
      unparse [MapIndex (IText "")] `shouldBe` "<\"\">"
      unparse [Field "extra"] `shouldBe` ".extra"
      unparse [MapIndex (IBool True)] `shouldBe` "<true>"
      unparse [MapIndex (IBool False)] `shouldBe` "<false>"
      unparse [MapIndex (IAddress 1024)] `shouldBe`
        "<a:0000000000000000000000000000000000000400>"

    it "should allow unbounded map indices" $ do
      parsePath (B.concat ["<1", B.replicate 100 0x30, ">"])
        `shouldBe` toAns [MapIndex (INum (product (replicate 100 10)))]

    it "should not allow unbounded array indices" $ do
      parsePath (B.concat ["[1", B.replicate 100 0x30, "]"])
        `shouldSatisfy` isLeft

    it "should unescape paths" $ do
      parsePath "<\"quoth:\\\"\">" `shouldBe` toAns [MapIndex (IText "quoth:\"")]

    it "should escape quotes in map indices" $ do
      unparsePath (StoragePath [MapIndex (IText "dan\"ger")])`shouldBe` "<\"dan\\\"ger\">"

  describe "StorageDelta" $ do
    let exStorage = HM.fromList [ ("count", BasicValue $ BInteger 99)
                                , ("name", BasicValue $ BString "iago")]
    it "should be able to do nothing" $ do
      replayDelta [] exStorage `shouldBe` Right exStorage

    it "should fail to do the impossible" $ do
      replayDelta [(empty, BInteger 99)] exStorage `shouldBe` Left (MissingPath empty)
      replayDelta [(forceParse ".no_such_field", BInteger 300)] exStorage
        `shouldBe` Left (MissingPath . singleton $ Field "no_such_field")

    it "should be able to increment" $ do
      replayDelta [(forceParse ".count", BInteger 100)] exStorage `shouldBe`
        Right (HM.fromList [("count", BasicValue $ BInteger 100), ("name", BasicValue $ BString "iago")])

    it "should be able to insert into a map" $ do
      let spine = HM.singleton "hashmap" . SMapping . HM.fromList
          input = spine []
          want  = spine [(INum 30, BasicValue $ BInteger 0x234)]
          got = replayDelta [(forceParse ".hashmap<30>", BInteger 0x234)] input
      got `shouldBe` Right want

    it "should be able to insert into a struct" $ do
      let spine = HM.singleton "struct" . SStruct . HM.singleton "name" . BasicValue . BString
          input = spine "iago"
          want  = spine "alladin"
          got = replayDelta [(forceParse ".struct.name", BString "alladin")] input
      got `shouldBe` Right want

    it "should be able to insert into an array" $ do
      let spine = HM.singleton "array" . SArray . I.fromList
          input = spine []
          want  = spine [(0, BasicValue $ BInteger 0x882)]
          got = replayDelta [(forceParse ".array[0]", BInteger 0x882)] input
      got `shouldBe` Right want

    it "should be able to target nested fields" $ do
      let spine = HM.singleton "array" . SArray
                . I.singleton 3 . SMapping
                . HM.singleton (IText "brimstone") . SStruct
                . HM.singleton "and_fire" . BasicValue . BInteger
          input = spine 0x12345
          want  = spine 700000
          got = replayDelta [(forceParse ".array[3]<\"brimstone\">.and_fire", BInteger 700000)] input
      got `shouldBe` Right want

    it "should be able to guess the intermediate structure from a path" $ do
      let input = HM.singleton "map" $ SMapping HM.empty
          want = HM.singleton "map" . SMapping
               . HM.singleton (IText "array") . SArray
               . I.singleton 9292 . SStruct
               . HM.singleton "array2" . SArray
               . I.singleton 14 . BasicValue . BBool $ True
          got = replayDelta [(forceParse ".map<\"array\">[9292].array2[14]", BBool True)] input
      got `shouldBe` Right want

    it "should be able to play multiple deltas" $ do
      let input = HM.singleton "map" $ SMapping HM.empty
          want = HM.singleton "map" . SMapping . HM.fromList
               $ [ (INum 4, BasicValue $ BBool True)
                 , (INum 5, BasicValue $ BBool False)
                 , (INum 7, BasicValue $ BInteger 43)]
          got = flip replayDelta input [ (forceParse ".map<4>", BBool True)
                                       , (forceParse ".map<7>", BInteger 43)
                                       , (forceParse ".map<5>", BBool False)]
      got `shouldBe` Right want

  describe "Analysis" $ do
    it "can analyze nothing" $ do
      analyze HM.empty `shouldBe` []

    it "can analyze a number" $ do
      analyze (HM.singleton "count" (BasicValue (BInteger 99)))
        `shouldBe` [(forceParse ".count", BInteger 99)]

    it "can analyze a map" $ do
      let input = HM.singleton "coll" . SMapping
                $ HM.fromList [(IText "monarch", BasicValue $ BString "4cm"),
                               (IText "mariposa", BasicValue $ BInteger 6)]
      analyze input `shouldMatchList` [(forceParse ".coll<\"monarch\">", BString "4cm")
                                      , (forceParse ".coll<\"mariposa\">", BInteger 6)]

    it "can analyze a map of maps" $ do
      let input = HM.singleton "coll" . SMapping
                $ HM.fromList [
                (IText "results", SMapping $ HM.fromList [
                  (IText "ok", BasicValue $ BInteger 20),
                  (IText "fail", BasicValue $ BInteger 4),
                  (IText "pending", BasicValue $ BInteger 2)]),
                (IText "todo", SMapping $ HM.fromList [
                  (IText "tasks", BasicValue $ BInteger 3),
                  (IText "stories", BasicValue $ BInteger 2)])]
      analyze input `shouldMatchList`
         [ (forceParse ".coll<\"results\"><\"ok\">", BInteger 20)
         , (forceParse ".coll<\"results\"><\"fail\">", BInteger 4)
         , (forceParse ".coll<\"results\"><\"pending\">", BInteger 2)
         , (forceParse ".coll<\"todo\"><\"tasks\">", BInteger 3)
         , (forceParse ".coll<\"todo\"><\"stories\">", BInteger 2)
         ]
    it "can analyze an array" $ do
      let input = HM.singleton "measurements" . SArray
                $ I.fromList [
                  (0, BasicValue $ BInteger 22),
                  (1, BasicValue $ BInteger 30),
                  (3, BasicValue $ BInteger 0)]
      analyze input `shouldMatchList`
        [ (forceParse ".measurements[0]", BInteger 22)
        , (forceParse ".measurements[1]", BInteger 30)
        , (forceParse ".measurements[3]", BInteger 0)
        ]

    it "can analyze a struct" $ do
      let input = HM.singleton "person" . SStruct
                $ HM.fromList [
                  ("age", BasicValue $ BInteger 84),
                  ("height", BasicValue $ BString "170cm"),
                  ("name", BasicValue $ BString "Voltaire"),
                  ("books", SArray $ I.fromList [
                      (0, BasicValue $ BString "Candide"),
                      (2, BasicValue $ BString "Treatise on tolerance")
                      ])
                ]
      analyze input `shouldMatchList`
        [ (forceParse ".person.age", BInteger 84)
        , (forceParse ".person.height", BString "170cm")
        , (forceParse ".person.name", BString "Voltaire")
        , (forceParse ".person.books[0]", BString "Candide")
        , (forceParse ".person.books[2]", BString "Treatise on tolerance")
        ]
  describe "Synthesis" $ do
    it "can synthesize nothing" $ do
      synthesize [] `shouldBe` Right HM.empty

    it "can synthesize a number" $ do
      let input = [(forceParse ".age", BInteger 30)]
          want = HM.singleton "age" . BasicValue . BInteger $ 30
      synthesize input `shouldBe` Right want

    it "can synthesize a mapping" $ do
      let input = [ (forceParse ".byDepth<20>", BString "river")
                  , (forceParse ".byDepth<4>", BString "stream")
                  , (forceParse ".byDepth<0>", BString "puddle")
                  , (forceParse ".byDepth<100>", BString "bay")
                  ]
          want = HM.singleton "byDepth" . SMapping $ HM.fromList
               [ (INum 20, BasicValue $ BString "river")
               , (INum 4, BasicValue $ BString "stream")
               , (INum 0, BasicValue $ BString "puddle")
               , (INum 100, BasicValue $ BString "bay")
               ]
      synthesize input `shouldBe` Right want

    it "can synthesize a complicated contract" $ do
      let input = [ (forceParse ".person.age", BInteger 84)
                  , (forceParse ".person.height", BString "170cm")
                  , (forceParse ".person.name", BString "Voltaire")
                  , (forceParse ".person.books[0]", BString "Candide")
                  , (forceParse ".person.books[2]", BString "Treatise on tolerance")
                  , (forceParse ".age", BString "Enlightenment")
                  ]
          want = HM.fromList
            [ ("person", SStruct $ HM.fromList
                [ ("age", BasicValue $ BInteger 84)
                , ("height", BasicValue $ BString "170cm")
                , ("name", BasicValue $ BString "Voltaire")
                , ("books", SArray $ I.fromList
                    [ (0, BasicValue $ BString "Candide")
                    , (2, BasicValue $ BString "Treatise on tolerance")
                    ])])
            , ("age", BasicValue $ BString "Enlightenment")
            ]
      synthesize input `shouldBe` Right want

  describe "BasicValue RLP encoding" $ do
    it "should be reversible" $ do
      let examples = [ BInteger 3399293429
                     , BString "This is text"
                     , BBool True
                     , BAddress 0x23421421421341232341bbbb
                     , BContract "Wings!" 0xdeadbeef
                     , BEnumVal "type" "num"
                     ]
      forM_ examples $ \bv ->  rlpDecode (rlpEncode bv) `shouldBe` bv

    it "should fail on invalids" $ do
      let examples = [ RLPArray []
                     , RLPArray [RLPScalar 6, rlpEncode (300 :: Integer)]
                     , RLPArray [RLPScalar 0, rlpEncode (8 :: Integer), rlpEncode (7 :: Integer)]
                     ]
      forM_ examples $ \rlp -> evaluate (rlpDecode rlp::BasicValue) `shouldThrow` anyErrorCall
