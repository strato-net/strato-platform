import Blockchain.Data.RLP
import Blockchain.Strato.Model.Account
import Control.Monad
import qualified Data.ByteString as B
import Data.Either (isLeft)
import SolidVM.Model.Storable
import Test.Hspec
import UnliftIO.Exception

main :: IO ()
main = hspec spec

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
      parsePath ".hashmap<a:ca35b7d915458ef540ade6068dfe2f44e8fa733c>"
        `shouldBe` toAns [Field "hashmap", MapIndex (IAccount $ unspecifiedChain 0xca35b7d915458ef540ade6068dfe2f44e8fa733c)]
      parsePath ".hashmap<a:ca35b7d915458ef540ade6068dfe2f44e8fa733c:main>"
        `shouldBe` toAns [Field "hashmap", MapIndex (IAccount $ mainChain 0xca35b7d915458ef540ade6068dfe2f44e8fa733c)]
      parsePath ".hashmap<a:ca35b7d915458ef540ade6068dfe2f44e8fa733c:ca35b7d915458ef540ade6068dfe2f44e8fa733cca35b7d915458ef540ade606>"
        `shouldBe` toAns
          [ Field "hashmap",
            MapIndex
              ( IAccount $
                  explicitChain
                    0xca35b7d915458ef540ade6068dfe2f44e8fa733c
                    0xca35b7d915458ef540ade6068dfe2f44e8fa733cca35b7d915458ef540ade606
              )
          ]

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
      unparse [MapIndex (IAccount $ unspecifiedChain 1024)]
        `shouldBe` "<a:0000000000000000000000000000000000000400>"
      unparse [MapIndex (IAccount $ mainChain 0xca35b7d915458ef540ade6068dfe2f44e8fa733c)]
        `shouldBe` "<a:ca35b7d915458ef540ade6068dfe2f44e8fa733c:main>"
      unparse
        [ MapIndex
            ( IAccount $
                explicitChain
                  0xca35b7d915458ef540ade6068dfe2f44e8fa733c
                  0xca35b7d915458ef540ade6068dfe2f44e8fa733cca35b7d915458ef540ade606
            )
        ]
        `shouldBe` "<a:ca35b7d915458ef540ade6068dfe2f44e8fa733c:ca35b7d915458ef540ade6068dfe2f44e8fa733cca35b7d915458ef540ade606>"

    it "should allow unbounded map indices" $ do
      parsePath (B.concat ["<1", B.replicate 100 0x30, ">"])
        `shouldBe` toAns [MapIndex (INum (product (replicate 100 10)))]

    it "should not allow unbounded array indices" $ do
      parsePath (B.concat ["[1", B.replicate 100 0x30, "]"])
        `shouldSatisfy` isLeft

    it "should unescape paths" $ do
      parsePath "<\"quoth:\\\"\">" `shouldBe` toAns [MapIndex (IText "quoth:\"")]

    it "should escape quotes in map indices" $ do
      unparsePath (StoragePath [MapIndex (IText "dan\"ger")]) `shouldBe` "<\"dan\\\"ger\">"

  describe "BasicValue RLP encoding" $ do
    it "should be reversible" $ do
      let examples =
            [ BInteger 3399293429,
              BString "This is text",
              BBool True,
              BAccount (unspecifiedChain 0x23421421421341232341bbbb),
              BAccount (mainChain 0x23421421421341232341bbbb),
              BAccount (explicitChain 0x23421421421341232341bbbb 0xdeadbeefd00d),
              BContract "Wings!" (unspecifiedChain 0xdeadbeef),
              BContract "Wings!" (mainChain 0xdeadbeef),
              BContract "Wings!" (explicitChain 0xdeadbeef 0x1234567890),
              BEnumVal "type" "num" 4
            ]
      forM_ examples $ \bv -> rlpDecode (rlpEncode bv) `shouldBe` bv

    it "should fail on invalids" $ do
      let examples =
            [ RLPArray [],
              RLPArray [RLPScalar 6, rlpEncode (300 :: Integer)],
              RLPArray [RLPScalar 0, rlpEncode (8 :: Integer), rlpEncode (7 :: Integer)]
            ]
      forM_ examples $ \rlp -> evaluate (rlpDecode rlp :: BasicValue) `shouldThrow` anyErrorCall
