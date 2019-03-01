{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE MagicHash #-}
import Control.Monad
import qualified Data.Bits as Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.Word
import GHC.Exts
import GHC.Integer.GMP.Internals
import Test.Hspec
import Test.QuickCheck

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Network.Haskoin.Internals (BigWord(..))

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "fastSerialize" $ do
    it "works on 0" $ word256ToBytes 0 `shouldBe` B.replicate 32 0
    it "works on ff" $ word256ToBytes 0xff `shouldBe` (B.replicate 31 0 <> B.replicate 1 0xff)
    it "works of aabbccdd" $
      word256ToBytes 0xaabbccdd `shouldBe` (B.replicate 28 0 <> B.pack [0xaa, 0xbb, 0xcc, 0xdd])
    it "works on first large size" $
      word256ToBytes 0x887766554433221100 `shouldBe`
        (B.replicate 23 0 <> B.pack [0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0])

    it "works on mid size" $
      replicateM_ 1000 $
        word256ToBytes 0x60646359b0ecaf704caa6f35 `shouldBe` fst (B16.decode
              "000000000000000000000000000000000000000060646359b0ecaf704caa6f35")
    it "works on max" $
      word256ToBytes 0xffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100 `shouldBe`
        B.pack [0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22,
                0x11, 0x00, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44,
                0x33, 0x22, 0x11, 0x00]

    it "works on arbitrary word256" $ property $ \n ->
      word256ToBytes n `shouldBe` B.pack (slowWord256ToBytes n)

    it "works on small word256" $ do
        let input = BigWord (S# 1#)
        let want = B.replicate 31 0 <> B.replicate 1 1
        word256ToBytes input `shouldBe` want

  describe "fastDeserialize" $ do
    it "maintains Integer invariants" $ property $ \n ->
      let n' = bytesToWord256 . word256ToBytes $ n
      in I# (isValidInteger# (getBigWordInteger n')) `shouldBe` 1
    it "works on 99656985947821947480 (66 bits)" $ do
      let b = word256ToBytes 99656985947821947480
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)
    it "works on 10291335769063634520 (63+\\epsilon bits)" $ do
      let b = word256ToBytes 10291335769063634520
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)
    it "works on arbitrary serialized word256" $ property $ \n -> do
      let b = word256ToBytes n
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)

  describe "fastLowByte" $ do
    let slowByte :: Word256 -> Word8
        slowByte n = fromIntegral $ n Bits..&. 0xff
    it "works on arbitrary word256" $ property $ \n ->
      fastWord256LSB n `shouldBe` slowByte n
    it "works on S# Word256" $ do
      fastWord256LSB (BigWord (S# 0x93342434#)) `shouldBe` 0x34

  describe "Address serialization" $ do
    it "should be fixed width" $ do
      addressToHex 0xdeadbeef `shouldBe`
                    "00000000000000000000000000000000deadbeef"
      addressToHex 0 `shouldBe` C8.replicate 40 '0'
      addressToHex 0xca35b7d915458ef540ade6068dfe2f44e8fa733c `shouldBe`
                    "ca35b7d915458ef540ade6068dfe2f44e8fa733c"
