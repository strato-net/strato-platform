{-# LANGUAGE OverloadedStrings #-}
module MessageSpec where

import Data.Time.Clock.POSIX
import Test.Hspec

import Blockchain.Data.Address
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Database.MerklePatricia.StateRoot
import Blockchain.ExtendedECDSA
import Blockchain.Blockstanbul.Messages
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Blockchain.Data.RLP
import Blockchain.SHA
import qualified Network.Haskoin.Internals as HK
import Blockchain.Strato.Model.ExtendedWord

spec :: Spec
spec = parallel $ do
  describe "RLP - quorum test vectors" $ do
    let vw = View 54975581388 45212608023800330
        digest = SHA 0xed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1
        addr = Address 0x787878787878787878787878
        mkCoord = fromIntegral . fastBytesToWord256 . B.pack
        sig = ExtendedSignature (HK.Signature (mkCoord [0..31]) (mkCoord [32..63])) True
        seal = ExtendedSignature (HK.Signature (mkCoord [64..95]) (mkCoord [96..127])) False
    it "matches on serializing Preprepares" $ do
      let blk = Block {
              blockBlockData = BlockData {
                blockDataParentHash = SHA 0x0,
                blockDataUnclesHash = SHA 0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347,
                blockDataCoinbase = Address 0x0,
                blockDataStateRoot = StateRoot . fst . B16.decode $ "0000000000000000000000000000000000000000000000000000000000000000",
                blockDataTransactionsRoot = StateRoot . fst .B16.decode $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                blockDataReceiptsRoot = StateRoot . fst . B16.decode $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
                blockDataLogBloom = B.replicate 256 0,
                blockDataDifficulty = 0,
                blockDataNumber = 999999999,
                blockDataGasLimit = 0,
                blockDataGasUsed = 0,
                blockDataTimestamp = posixSecondsToUTCTime 0,
                blockDataExtraData = "",
                blockDataNonce = 0,
                blockDataMixHash = SHA 0x0
              },
              blockReceiptTransactions = [],
              blockBlockUncles = []
          }

          msg = WireMessage (MsgAuth addr sig) (Preprepare vw blk)
          (rlp, extra) = B16.decode "f9026880b9020bf90208ce850ccccccccc87a0a0a0a0a0aa0af901f6f901f1a00000000000000000000000000000000000000000000000000000000000000000a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b901000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080843b9ac9ff80808080a00000000000000000000000000000000000000000000000000000000000000000880000000000000000c0c0940000000000000000787878787878787878787878b841000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f0180"
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp
    it "matches on serializing Prepares" $ do
      let msg = WireMessage (MsgAuth addr sig) (Prepare vw digest)
          (rlp, extra) = B16.decode "f88c01b1f0ce850ccccccccc87a0a0a0a0a0aa0aa0ed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1940000000000000000787878787878787878787878b841000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f0180"
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp

    it "matches on serializing Commits" $ do
      let msg = WireMessage (MsgAuth addr sig) (Commit vw digest seal)
          (rlp, extra) = B16.decode "f8ce02b1f0ce850ccccccccc87a0a0a0a0a0aa0aa0ed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1940000000000000000787878787878787878787878b841000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f01b841404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f00"
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp

    it "matches on serializing RoundChanges" $ do
      let msg = WireMessage (MsgAuth addr sig) (RoundChange vw)
          (rlp, extra) = B16.decode "f88c03b1f0ce850ccccccccc87a0a0a0a0a0aa0aa00000000000000000000000000000000000000000000000000000000000000000940000000000000000787878787878787878787878b841000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f0180"
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp
