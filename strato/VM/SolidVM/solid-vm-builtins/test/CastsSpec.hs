{-# LANGUAGE OverloadedStrings #-}

module CastsSpec (spec) where

import qualified Blockchain.SolidVM.Builtins.Casts as B
import Blockchain.Strato.Model.Address (Address)
import qualified Data.ByteString as BS
import qualified Data.Text as T
import Test.Hspec

spec :: Spec
spec = do
  describe "builtin conversions" $ do
    it "preserves hex-default and explicit decimal integer parsing" $ do
      B.int ("10" :: String, 16 :: Integer) `shouldBe` Right 16
      B.int ("10" :: String, 10 :: Integer) `shouldBe` Right 10
      B.int ("0xabc" :: String, 16 :: Integer) `shouldBe` Right 2748
    it "preserves integer string padding and fixed-size bytes truncation" $ do
      B.string ((10,16,2) :: (Integer,Integer,Integer)) `shouldBe` Right "0x000a"
      B.bytes (2 :: Int, 65537 :: Integer) `shouldBe` Right (BS.pack [0, 1])
      B.bytes (Just 1 :: Maybe Int, "abc" :: String) `shouldBe` Right "a"
    it "keeps UTF-8 and raw byte conversion distinct" $ do
      B.bytes ("\233" :: String) `shouldBe` Right (BS.pack [195, 169])
      B.bytes ("\233" :: String, "raw" :: String) `shouldBe` Right (BS.pack [233])
      B.string (BS.pack [255]) `shouldBe` Right "\255"

  describe "typed cast implementations" $ do
    it "parses text integers with the native base and error rules" $ do
      B.int ("abc" :: T.Text) `shouldBe` Right 2748
      B.int ("10" :: T.Text, 10 :: Integer) `shouldBe` Right 10
      B.int ("hello" :: T.Text) `shouldBe` Left ("invalid hexadecimal integer", ["\"hello\""])
      B.int ("hello" :: T.Text, 10 :: Integer) `shouldBe` Left ("invalid decimal integer", ["\"hello\""])
      B.int ("10" :: T.Text, 2 :: Integer) `shouldBe` Left ("unsupported integer base", ["\"10\"", "2"])
    it "selects integer casts from their Haskell input types" $ do
      (B.int (42 :: Integer) :: B.CastResult Integer) `shouldBe` Right 42
      (B.int (BS.pack [1, 2]) :: B.CastResult Integer) `shouldBe` Right 258
      (B.int () :: B.CastResult Integer) `shouldBe` Right 0
      (B.int ("abc" :: String) :: B.CastResult Integer) `shouldBe` Right 2748
      (B.int ("hello" :: String) :: B.CastResult Integer)
        `shouldBe` Left ("numeric cast - not a hex string hello", ["\"hello\""])
    it "keeps decimal and address parse failures typed" $ do
      B.decimal ("2.75" :: T.Text) `shouldBe` Right 2.75
      B.decimal ("hello" :: T.Text) `shouldBe` Left ("decimal cast", ["\"hello\""])
      B.address ("0xabc" :: T.Text) `shouldBe` Right 0xabc
      B.address ("hello" :: T.Text) `shouldBe` Left ("address cast", ["\"hello\""])
    it "preserves byte-to-address padding and truncation" $ do
      mapM_ (\bytes -> (B.address bytes) `shouldBe` (B.int bytes >>= (B.address :: Integer -> B.CastResult Address)))
        [BS.empty, BS.pack [1, 2], BS.replicate 20 255, BS.replicate 33 255]
    it "preserves string format errors and invalid UTF-8 diagnostics" $ do
      B.string ((255,16,2) :: (Integer,Integer,Integer)) `shouldBe` Right "0x00ff"
      B.string ((1,2) :: (Integer,Integer)) `shouldBe` Left ("string cast", ["1", "2"])
      B.string ((1,10,2) :: (Integer,Integer,Integer)) `shouldBe` Left ("string cast", ["1", "10", "2"])
      B.string ("abc" :: BS.ByteString, "raw" :: T.Text) `shouldBe` Right "abc"
      B.string (BS.pack [255], "utf-8" :: T.Text)
        `shouldBe` Left ("bytestring is not UTF-8 encoded", [T.pack $ show $ BS.pack [255], "\"utf-8\""])
    it "uses the public bool and bytes casts for every supported input form" $ do
      B.bool ("true" :: String) `shouldBe` Right True
      B.bool ("false" :: String) `shouldBe` Right False
      B.bool ("invalid" :: String) `shouldBe` Left ("bool cast", ["\"invalid\""])
      (B.bool () :: B.CastResult Bool) `shouldBe` Right False
      B.bytes (258 :: Integer) `shouldBe` Right (BS.pack [1, 2])
      B.bytes (0xabc :: Address) `shouldBe` Right (BS.replicate 18 0 <> BS.pack [10, 188])
      B.bytes ("abc" :: BS.ByteString) `shouldBe` Right "abc"
      (B.bytes () :: B.CastResult BS.ByteString) `shouldBe` Right BS.empty
      B.bytes ("é" :: String, "utf-8" :: String) `shouldBe` Right (BS.pack [195, 169])
      B.bytes (Just 2 :: Maybe Int, "abc" :: BS.ByteString) `shouldBe` Right "ab"
