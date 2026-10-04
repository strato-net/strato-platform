{-# LANGUAGE OverloadedStrings #-}

module StorageTest (spec) where

import Blockchain.Data.RLP
import Control.Monad
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString as B
import qualified Data.Aeson as JSON
import qualified Data.Text as T
import Database.Persist (PersistValue(..), fromPersistValue, toPersistValue)
import Servant (parseUrlPiece, toUrlPiece)
import SolidVM.Model.Storable
import Test.Hspec
import UnliftIO.Exception

spec :: Spec
spec = do
  describe "binary storage path text encoding" $ do
    let failingKeys = map (either error id . B16.decode)
          [ "c009e7c12890c67a2e36deb34ca9540060e3e542f456c818a91761be623b7fce"
          , "5005003b069d49e0dafab23b4707eb4268a0ec810b3afd2544fa2e00ac575329"
          , "8ba17cf7e0b522e539d7ab3abb8e8298133627a0a0b1df05f96c005d57773f77"
          , "9447435bc2498ad4bbf93d6b48dfe52bb82b0250bfd700b4bf6651ee217defd9"
          ]
    let path key = StoragePath [Field "settlementAttestationCounts", Index key]
        keys = failingKeys ++ [B.pack [0..255], B.replicate 32 0, "a\0b", "\\]", "~hex:00", "caf\xc3\xa9"]
    it "round-trips every byte through SQL, JSON and URL text without NUL" $
      forM_ keys $ \key -> do
        let original = path key
        fromPersistValue (toPersistValue original) `shouldBe` Right original
        JSON.eitherDecode (JSON.encode original) `shouldBe` Right original
        parseUrlPiece (toUrlPiece original) `shouldBe` Right original
        T.any (== '\0') (pathToStorageKey original) `shouldBe` False
        "settlementAttestationCounts[" `T.isPrefixOf` pathToStorageKey original `shouldBe` True
        parsePath (unparsePath original) `shouldBe` Right original
    it "keeps ASCII paths and legacy SQL rows readable" $ do
      pathToStorageKey "withdrawals[18].status" `shouldBe` "withdrawals[18].status"
      fromPersistValue (PersistText "withdrawals[18].status") `shouldBe` Right ("withdrawals[18].status" :: StoragePath)
    it "does not confuse literal hex-like keys with binary keys" $
      pathToStorageKey (path "~hex:00") `shouldNotBe` pathToStorageKey (path "\0")
    it "rejects malformed hex paths" $
      storageKeyToPath "counts[~hex:zz]" `shouldSatisfy` either (const True) (const False)

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
