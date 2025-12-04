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
  describe "ByteString escaping" $ do
    -- escapeKey/unescapeKey only escape backslash (0x5c) and closing bracket (0x5d)
    it "should escape backslash and closing bracket" $ do
      escapeKey "" `shouldBe` ""
      escapeKey (B.singleton 0x5c) `shouldBe` B.pack [0x5c, 0x5c]  -- \ -> \\
      escapeKey (B.singleton 0x5d) `shouldBe` B.pack [0x5c, 0x5d]  -- ] -> \]
      escapeKey "ok\\test]end" `shouldBe` "ok\\\\test\\]end"

    it "should unescape backslash and closing bracket" $ do
      unescapeKey "" `shouldBe` ""
      unescapeKey (B.pack [0x5c, 0x5c]) `shouldBe` B.singleton 0x5c  -- \\ -> \
      unescapeKey (B.pack [0x5c, 0x5d]) `shouldBe` B.singleton 0x5d  -- \] -> ]
      unescapeKey "ok\\\\test\\]end" `shouldBe` "ok\\test]end"

    it "should not escape quotes" $ do
      escapeKey (B.singleton 0x22) `shouldBe` B.singleton 0x22  -- " stays "
      escapeKey "ok\"test\"end" `shouldBe` "ok\"test\"end"

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
