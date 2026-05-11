{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module StorageTest (spec) where

import Blockchain.Data.RLP
import Control.Monad
import qualified Data.ByteString as B
import Data.Word (Word8)
import SolidVM.Model.Storable
import Test.Hspec
import Test.QuickCheck
import UnliftIO.Exception

spec :: Spec
spec = do
  describe "ByteString escaping" $ do
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

    it "should hex-escape non-printable and non-ASCII bytes" $ do
      -- 0x00, 0x1F, 0x7F (DEL), 0x80, 0xC2, 0xFF — all outside 0x20..0x7E.
      escapeKey (B.singleton 0x00) `shouldBe` "\\x00"
      escapeKey (B.singleton 0x1f) `shouldBe` "\\x1f"
      escapeKey (B.singleton 0x7f) `shouldBe` "\\x7f"
      escapeKey (B.singleton 0x80) `shouldBe` "\\x80"
      escapeKey (B.singleton 0xc2) `shouldBe` "\\xc2"
      escapeKey (B.singleton 0xff) `shouldBe` "\\xff"
      escapeKey (B.pack [0xa0, 0xd6, 0xcb]) `shouldBe` "\\xa0\\xd6\\xcb"

    it "should round-trip arbitrary bytes (the bytes32-mapping-key case)" $
      property $ \(bytes :: [Word8]) ->
        let bs = B.pack bytes
        in unescapeKey (escapeKey bs) === bs

    it "should produce pure ASCII-printable output" $
      property $ \(bytes :: [Word8]) ->
        let escaped = escapeKey (B.pack bytes)
        in B.all (\b -> b >= 0x20 && b <= 0x7e) escaped

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
