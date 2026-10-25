{-# LANGUAGE OverloadedStrings #-}

module FunctionsSpec (spec) where

import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import qualified Blockchain.SolidVM.Builtins.Functions as B
import Blockchain.VM.SolidException (SolidException (..))
import Control.Exception (evaluate)
import qualified Data.ByteString as BS
import Data.IORef
import Data.Time.Clock
import Data.Time.Calendar (fromGregorian)
import Test.Hspec

spec :: Spec
spec = do
  describe "builtin conversions and encoding" $ do
    it "preserves odd-length hex input and lowercase normalization" $ do
      B.b16decode "abc" `shouldBe` BS.pack [10, 188]
      B.normalizeHex "0xAbC" `shouldBe` "0x0abc"
    it "preserves the invalid hex error payload" $
      evaluate (B.b16decode "zz") `shouldThrow` (== InvalidArguments "b16decode: invalid hex string" "\"zz\"")
    it "preserves hex-default and explicit decimal integer parsing" $ do
      B.parseBaseInt "10" 16 `shouldBe` Right 16
      B.parseBaseInt "10" 10 `shouldBe` Right 10
      B.parseBaseInt "0xabc" 16 `shouldBe` Right 2748
    it "preserves integer string padding and fixed-size bytes truncation" $ do
      B.stringFromInteger 10 16 (Just 2) `shouldBe` "0x000a"
      B.sizedBytesFromInteger 2 65537 `shouldBe` BS.pack [0, 1]
      B.sizedBytesFromString (Just 1) "abc" `shouldBe` "a"
    it "keeps UTF-8 and raw byte conversion distinct" $ do
      B.bytesFromString "\233" `shouldBe` BS.pack [195, 169]
      B.bytesFromRawString "\233" `shouldBe` BS.pack [233]
      B.stringFromBytes (BS.pack [255]) `shouldBe` "\255"
    it "preserves base64 padding and URL-safe unpadded output" $ do
      B.base64encode (BS.pack [251, 255]) `shouldBe` "+/8="
      B.base64urlencode (BS.pack [251, 255]) `shouldBe` "-_8"
    it "preserves the SHA-256 digest" $
      B.b16encode (B.sha256 "abc") `shouldBe` "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

  describe "ABI layout and malformed data" $ do
    it "preserves head offsets, byte lengths, and right padding" $ do
      ABI.abiEncode [(False, ABI.encodeUint256 7), (True, ABI.encodeDynamicBytes "abc")]
        `shouldBe` ABI.encodeUint256 7 <> ABI.encodeUint256 64 <> ABI.encodeUint256 3 <> "abc" <> BS.replicate 29 0
    it "preserves signed decoding" $
      ABI.decodeInt 256 (ABI.encodeInt256 (-2)) 0 `shouldBe` (-2)
    it "clamps malformed array lengths to available element slots" $ do
      let bs = ABI.encodeUint256 32 <> ABI.encodeUint256 (2 ^ (255 :: Integer)) <> ABI.encodeUint256 7
      ABI.decodeArray ABI.decodeUint bs 0 `shouldBe` [7]
    it "preserves unknown decode types as the supplied null value" $
      ABI.abiDecode (\_ bs offset -> ABI.decodeUint bs offset) (-1)
        (ABI.encodeUint256 7 <> ABI.encodeUint256 9) [Nothing, Just "uint"] `shouldBe` [-1, 9]

  describe "stateful builtin operation order" $ do
    it "clears code, pays, and purges storage even when payment returns false" $ do
      events <- newIORef ([] :: [String])
      let record event = modifyIORef' events (++ [event])
      result <- B.selfdestruct (record "address" >> pure (1 :: Int))
        (\_ -> record "balance" >> pure 5)
        (\_ -> record "clear")
        (\_ _ _ -> record "pay" >> pure False)
        (\_ -> record "purge") 2
      result `shouldBe` False
      readIORef events `shouldReturn` ["address", "balance", "clear", "pay", "purge"]
    it "rejects an empty create input before compilation or allocation" $ do
      compiled <- newIORef False
      B.create (pure (0 :: Int)) (writeIORef compiled True) (\_ -> pure ()) (\_ _ -> pure 1) "" "source"
        `shouldReturn` 0
      readIORef compiled `shouldReturn` False
    it "validates blockhash before querying state" $ do
      queried <- newIORef False
      B.blockhash (\_ -> writeIORef queried True >> pure Nothing) (-1)
        `shouldThrow` (== InvalidArguments "blockhash() only accepts arguments greater than or equal to 0" "[-1]")
      readIORef queried `shouldReturn` False
    it "preserves the minimum one-second fastForward and signed block increment" $ do
      let timestamp = UTCTime (fromGregorian 2026 1 1) 0
      result <- newIORef (timestamp, 10)
      B.fastForward True (error "unexpected test guard") timestamp 10 (-3) (-2)
        (\t n -> writeIORef result (t, n))
      readIORef result `shouldReturn` (addUTCTime 1 timestamp, 8)
    it "validates a P-256 digest before decoding the public key or signature" $
      B.verifyP256 "short" (error "public key evaluated") (error "signature evaluated")
        `shouldThrow` (== InvalidArguments "Could not decode hash from string" "\"short\"")
