{-# LANGUAGE OverloadedStrings #-}

module CastsSpec (spec) where

import qualified Blockchain.SolidVM.Builtins.Casts as B
import Blockchain.Strato.Model.Address (Address)
import Blockchain.VM.SolidException (SolidException (InvalidArguments))
import qualified Data.ByteString as BS
import qualified Data.Text as T
import Test.Hspec

spec :: Spec
spec = do
  describe "builtin conversions" $ do
    it "preserves hex-default and explicit decimal integer parsing" $ do
      B.int ("10" :: String, 16 :: Integer) `shouldReturn` 16
      B.int ("10" :: String, 10 :: Integer) `shouldReturn` 10
      B.int ("0xabc" :: String, 16 :: Integer) `shouldReturn` 2748
    it "preserves integer string padding and fixed-size bytes truncation" $ do
      B.string ((10,16,2) :: (Integer,Integer,Integer)) `shouldReturn` "0x000a"
      B.bytes (2 :: Int, 65537 :: Integer) `shouldReturn` BS.pack [0, 1]
      B.bytes (Just 1 :: Maybe Int, "abc" :: String) `shouldReturn` "a"
    it "preserves the native fixed-width integer bytes cast" $ do
      B.bytes32 1 `shouldReturn` (BS.replicate 31 0 <> BS.singleton 1)
      B.bytes32 (-1) `shouldReturn` BS.replicate 32 255
      B.bytes32 (2 ^ (256 :: Integer) + 1) `shouldReturn` (BS.replicate 31 0 <> BS.singleton 1)
      B.bytes ("é" :: T.Text) `shouldReturn` BS.pack [195,169]
    it "keeps UTF-8 and raw byte conversion distinct" $ do
      B.bytes ("\233" :: String) `shouldReturn` BS.pack [195, 169]
      B.bytes ("\233" :: String, "raw" :: String) `shouldReturn` BS.pack [233]
      B.string (BS.pack [255]) `shouldReturn` "\255"

  describe "typed cast implementations" $ do
    it "parses text integers with the native base and error rules" $ do
      B.int ("abc" :: T.Text) `shouldReturn` 2748
      B.int ("10" :: T.Text, 10 :: Integer) `shouldReturn` 10
      B.int ("hello" :: T.Text) `shouldThrow` (== InvalidArguments "invalid hexadecimal integer" (show ["\"hello\"" :: T.Text]))
      B.int ("hello" :: T.Text, 10 :: Integer) `shouldThrow` (== InvalidArguments "invalid decimal integer" (show ["\"hello\"" :: T.Text]))
      B.int ("10" :: T.Text, 2 :: Integer) `shouldThrow` (== InvalidArguments "unsupported integer base" (show ["\"10\"", "2" :: T.Text]))
    it "selects integer casts from their Haskell input types" $ do
      (B.int (42 :: Integer) :: IO Integer) `shouldReturn` 42
      (B.int (BS.pack [1, 2]) :: IO Integer) `shouldReturn` 258
      (B.int () :: IO Integer) `shouldReturn` 0
      (B.int ("abc" :: String) :: IO Integer) `shouldReturn` 2748
      (B.int ("hello" :: String) :: IO Integer)
        `shouldThrow` (== InvalidArguments "numeric cast - not a hex string hello" (show ["\"hello\"" :: T.Text]))
    it "keeps decimal and address parse failures typed" $ do
      B.decimal ("2.75" :: T.Text) `shouldReturn` 2.75
      B.decimal ("hello" :: T.Text) `shouldThrow` (== InvalidArguments "decimal cast" (show ["\"hello\"" :: T.Text]))
      B.address ("0xabc" :: T.Text) `shouldReturn` 0xabc
      B.address ("hello" :: T.Text) `shouldThrow` (== InvalidArguments "address cast" (show ["\"hello\"" :: T.Text]))
    it "preserves byte-to-address padding and truncation" $ do
      mapM_ (\bytes -> do
        expected <- B.int bytes >>= (B.address :: Integer -> IO Address)
        B.address bytes `shouldReturn` expected)
        [BS.empty, BS.pack [1, 2], BS.replicate 20 255, BS.replicate 33 255]
    it "preserves string format errors and invalid UTF-8 diagnostics" $ do
      B.string ((255,16,2) :: (Integer,Integer,Integer)) `shouldReturn` "0x00ff"
      B.string ((1,2) :: (Integer,Integer)) `shouldThrow` (== InvalidArguments "string cast" (show ["1", "2" :: T.Text]))
      B.string ((1,10,2) :: (Integer,Integer,Integer)) `shouldThrow` (== InvalidArguments "string cast" (show ["1", "10", "2" :: T.Text]))
      B.string ("abc" :: BS.ByteString, "raw" :: T.Text) `shouldReturn` "abc"
      B.string (BS.pack [255], "utf-8" :: T.Text)
        `shouldThrow` (== InvalidArguments "bytestring is not UTF-8 encoded" (show [T.pack $ show $ BS.pack [255], "\"utf-8\""]))
    it "uses the public bool and bytes casts for every supported input form" $ do
      B.bool ("true" :: String) `shouldReturn` True
      B.bool ("false" :: String) `shouldReturn` False
      B.bool ("invalid" :: String) `shouldThrow` (== InvalidArguments "bool cast" (show ["\"invalid\"" :: T.Text]))
      (B.bool () :: IO Bool) `shouldReturn` False
      B.bytes (258 :: Integer) `shouldReturn` BS.pack [1, 2]
      B.bytes (0xabc :: Address) `shouldReturn` (BS.replicate 18 0 <> BS.pack [10, 188])
      B.bytes ("abc" :: BS.ByteString) `shouldReturn` "abc"
      (B.bytes () :: IO BS.ByteString) `shouldReturn` BS.empty
      B.bytes ("é" :: String, "utf-8" :: String) `shouldReturn` BS.pack [195, 169]
      B.bytes (Just 2 :: Maybe Int, "abc" :: BS.ByteString) `shouldReturn` "ab"
