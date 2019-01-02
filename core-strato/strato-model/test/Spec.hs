{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE MagicHash #-}
import Control.Monad
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import GHC.Exts
import GHC.Integer.GMP.Internals
import Test.Hspec
import Test.QuickCheck

import Blockchain.Strato.Model.ExtendedWord
import Network.Haskoin.Internals (getBigWordInteger)

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "fastSerialize" $ do
    it "works on 0" $ fastWord256ToByteString 0 `shouldBe` B.replicate 32 0
    it "works on ff" $ fastWord256ToByteString 0xff `shouldBe` (B.replicate 31 0 <> B.replicate 1 0xff)
    it "works of aabbccdd" $
      fastWord256ToByteString 0xaabbccdd `shouldBe` (B.replicate 28 0 <> B.pack [0xaa, 0xbb, 0xcc, 0xdd])
    it "works on first large size" $
      fastWord256ToByteString 0x887766554433221100 `shouldBe`
        (B.replicate 23 0 <> B.pack [0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0])

    it "works on mid size" $
      replicateM_ 1000 $
        fastWord256ToByteString 0x60646359b0ecaf704caa6f35 `shouldBe` fst (B16.decode
              "000000000000000000000000000000000000000060646359b0ecaf704caa6f35")
    it "works on max" $
      fastWord256ToByteString 0xffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100 `shouldBe`
        B.pack [0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22,
                0x11, 0x00, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44,
                0x33, 0x22, 0x11, 0x00]

    it "works on arbitrary word256" $ property $ \n ->
      fastWord256ToByteString n `shouldBe` B.pack (word256ToBytes n)

  describe "fastDeserialize" $ do
    it "maintains Integer invariants" $ property $ \n ->
      let n' = fastBytesToWord256 . fastWord256ToByteString $ n
      in I# (isValidInteger# (getBigWordInteger n')) `shouldBe` 1
    it "works on 99656985947821947480 (66 bits)" $ do
      let b = fastWord256ToByteString 99656985947821947480
      fastBytesToWord256 b `shouldBe` bytesToWord256 (B.unpack b)
    it "works on 10291335769063634520 (63+\\epsilon bits)" $ do
      let b = fastWord256ToByteString 10291335769063634520
      fastBytesToWord256 b `shouldBe` bytesToWord256 (B.unpack b)
    it "works on arbitrary serialized word256" $ property $ \n -> do
      let b = fastWord256ToByteString n
      fastBytesToWord256 b `shouldBe` bytesToWord256 (B.unpack b)
