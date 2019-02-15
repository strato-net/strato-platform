import qualified Data.ByteString as B
import Data.Either (isLeft)
import qualified Data.HashMap.Strict as HM
import qualified Data.IntMap as I
import Test.Hspec

import SolidVM.Model.Storable

main :: IO ()
main = hspec spec

forceParse :: B.ByteString -> StoragePath
forceParse = either error id . parsePath

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
      parsePath "" `shouldBe` Right Null
      parsePath "[3]" `shouldBe` Right (ArrayIndex 3 Null)
      parsePath "<773472>" `shouldBe` Right (MapIndex (Num 773472) Null)
      parsePath "<\"xor\">" `shouldBe` Right (MapIndex (Text "xor") Null)
      parsePath "<\"\">" `shouldBe` Right (MapIndex (Text "") Null)
      parsePath ".extra" `shouldBe` Right (Field "extra" Null)
      parsePath ".hashmap" `shouldBe` Right (Field "hashmap" Null)
      parsePath ".hashmap<30>" `shouldBe` Right (Field "hashmap" (MapIndex (Num 30) Null))

    it "should be able to unparse a path" $ do
      unparsePath Null `shouldBe` ""
      unparsePath (ArrayIndex 3 Null) `shouldBe` "[3]"
      unparsePath (MapIndex (Num 773472) Null) `shouldBe` "<773472>"
      unparsePath (MapIndex (Text "xor") Null) `shouldBe` "<\"xor\">"
      unparsePath (MapIndex (Text "") Null) `shouldBe` "<\"\">"
      unparsePath (Field "extra" Null) `shouldBe` ".extra"

    it "should allow unbounded map indices" $ do
      parsePath (B.concat ["<1", B.replicate 100 0x30, ">"])
        `shouldBe` Right (MapIndex (Num (product (replicate 100 10))) Null)

    it "should not allow unbounded array indices" $ do
      parsePath (B.concat ["[1", B.replicate 100 0x30, "]"])
        `shouldSatisfy` isLeft

    it "should unescape paths" $ do
      parsePath "<\"quoth:\\\"\">" `shouldBe`
        Right (MapIndex (Text "quoth:\"") Null)

    it "should escape quotes in map indices" $ do
      unparsePath (MapIndex (Text "dan\"ger") Null) `shouldBe` "<\"dan\\\"ger\">"

  describe "StorageDelta" $ do
    let exStorage = HM.fromList [("count", BasicValue $ BInteger 99), ("name", BasicValue $ BString "iago")]
    it "should be able to do nothing" $ do
      replayDelta [] exStorage `shouldBe` Right exStorage

    it "should fail to do the impossible" $ do
      replayDelta [(Null, BInteger 99)] exStorage `shouldBe` Left (MissingPath Null)
      replayDelta [(forceParse ".no_such_field", BInteger 300)] exStorage `shouldBe` Left (MissingPath (Field "no_such_field" Null))

    it "should be able to increment" $ do
      replayDelta [(forceParse ".count", BInteger 100)] exStorage `shouldBe`
        Right (HM.fromList [("count", BasicValue $ BInteger 100), ("name", BasicValue $ BString "iago")])

    it "should be able to insert into a map" $ do
      let spine = HM.singleton "hashmap" . SMapping . HM.fromList
          input = spine []
          want  = spine [(Num 30, BasicValue $ BInteger 0x234)]
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
                . HM.singleton (Text "brimstone") . SStruct
                . HM.singleton "and_fire" . BasicValue . BInteger
          input = spine 0x12345
          want  = spine 700000
          got = replayDelta [(forceParse ".array[3]<\"brimstone\">.and_fire", BInteger 700000)] input
      got `shouldBe` Right want

    it "should be able to guess the intermediate structure from a path" $ do
      let input = HM.singleton "map" $ SMapping HM.empty
          want = HM.singleton "map" . SMapping
               . HM.singleton (Text "array") . SArray
               . I.singleton 9292 . SStruct
               . HM.singleton "array2" . SArray
               . I.singleton 14 . BasicValue . BBool $ True
          got = replayDelta [(forceParse ".map<\"array\">[9292].array2[14]", BBool True)] input
      got `shouldBe` Right want

    it "should be able to play multiple deltas" $ do
      let input = HM.singleton "map" $ SMapping HM.empty
          want = HM.singleton "map" . SMapping . HM.fromList
               $ [ (Num 4, BasicValue $ BBool True)
                 , (Num 5, BasicValue $ BBool False)
                 , (Num 7, BasicValue $ BInteger 43)]
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
                $ HM.fromList [(Text "monarch", BasicValue $ BString "4cm"),
                               (Text "mariposa", BasicValue $ BInteger 6)]
      analyze input `shouldMatchList` [(forceParse ".coll<\"monarch\">", BString "4cm")
                                      , (forceParse ".coll<\"mariposa\">", BInteger 6)]

    it "can analyze a map of maps" $ do
      let input = HM.singleton "coll" . SMapping
                $ HM.fromList [
                (Text "results", SMapping $ HM.fromList [
                  (Text "ok", BasicValue $ BInteger 20),
                  (Text "fail", BasicValue $ BInteger 4),
                  (Text "pending", BasicValue $ BInteger 2)]),
                (Text "todo", SMapping $ HM.fromList [
                  (Text "tasks", BasicValue $ BInteger 3),
                  (Text "stories", BasicValue $ BInteger 2)])]
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
               [ (Num 20, BasicValue $ BString "river")
               , (Num 4, BasicValue $ BString "stream")
               , (Num 0, BasicValue $ BString "puddle")
               , (Num 100, BasicValue $ BString "bay")
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


