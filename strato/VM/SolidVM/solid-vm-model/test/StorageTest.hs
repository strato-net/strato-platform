{-# LANGUAGE OverloadedStrings #-}

module StorageTest (spec) where

import Blockchain.Data.RLP
import Control.Monad
import qualified Data.ByteString as B
import SolidVM.Model.Storable
import Test.Hspec
import UnliftIO.Exception

spec :: Spec
spec = do
  xdescribe "ByteString escaping" $ do
    it "should be able to escape quotes" $ do
      escapeKey "" `shouldBe` ""
      escapeKey (B.singleton 0x22) `shouldBe` B.pack [0x5c, 0x22]
      escapeKey "ok\"fail\"ok\"" `shouldBe` "ok\\\"fail\\\"ok\\\""

    it "should be able to unescape quotes" $ do
      unescapeKey "" `shouldBe` ""
      unescapeKey (B.pack [0x5c, 0x22]) `shouldBe` B.singleton 0x22
      unescapeKey "ok\\\"fail\\\"ok\\\"" `shouldBe` "ok\"fail\"ok\""

  describe "BasicValue RLP encoding" $ do
    it "should be reversible" $ do
      let examples =
            [ BInteger 3399293429,
              BString "This is text",
              BBool True,
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
