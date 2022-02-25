{-# LANGUAGE OverloadedStrings #-}
module MessageSpec where

import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8  as C8
import Data.Maybe
import Data.Time.Clock.POSIX
import Test.Hspec

import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Blockstanbul.Messages
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.StateRoot

spec :: Spec
spec = parallel $ do
  describe "RLP - message serialization tests" $ do
    let vw = View 54975581388 45212608023800330
        digest = unsafeCreateKeccak256FromWord256 0xed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1
        addr = Address 0x787878787878787878787878
        priv = fromMaybe (error "could not import private key") (importPrivateKey (fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))
        sigMsg = keccak256ToByteString blockstanbulMixHash 
        sealMsg = keccak256ToByteString $ unsafeCreateKeccak256FromWord256 0x0
        sig = signMsg priv sigMsg
        seal = signMsg priv sealMsg 
    it "matches on serializing Preprepares" $ do
      let bData = BlockData {
                blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0,
                blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347,
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
                blockDataMixHash = blockstanbulMixHash
              }
      let blk = Block bData [] []
          msg = WireMessage (MsgAuth addr sig) (Preprepare vw blk)
          (rlp, extra) = B16.decode "f9026880b9020bf90208ce850ccccccccc87a0a0a0a0a0aa0af901f6f901f1a00000000000000000000000000000000000000000000000000000000000000000a01dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347940000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421a056e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421b901000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080843b9ac9ff80808080a063746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365880000000000000000c0c0940000000000000000787878787878787878787878b841750650a73723d1e37dcd40dde70fdf4cc3a38694d37c5de66bbbfb3284dbf3e3557cd60f05df24b251ea2d49677bfef397c664374e35bda99bcd603b8be0f11c0180"
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp
    it "matches on serializing Prepares" $ do
      let msg = WireMessage (MsgAuth addr sig) (Prepare vw digest)
          (rlp, extra) = B16.decode "f88c01b1f0ce850ccccccccc87a0a0a0a0a0aa0aa0ed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1940000000000000000787878787878787878787878b841750650a73723d1e37dcd40dde70fdf4cc3a38694d37c5de66bbbfb3284dbf3e3557cd60f05df24b251ea2d49677bfef397c664374e35bda99bcd603b8be0f11c0180" 
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp

    it "matches on serializing Commits" $ do
      let msg = WireMessage (MsgAuth addr sig) (Commit vw digest seal)
          (rlp, extra) = B16.decode "f8ce02b1f0ce850ccccccccc87a0a0a0a0a0aa0aa0ed92eeba73797150099ef9035b92e3bc3a3cd3b18da36f51385910726606e1f1940000000000000000787878787878787878787878b841750650a73723d1e37dcd40dde70fdf4cc3a38694d37c5de66bbbfb3284dbf3e3557cd60f05df24b251ea2d49677bfef397c664374e35bda99bcd603b8be0f11c01b84113087c26f26c4648a77dd8dd0a29fde7f51e20098ea678fa087c8685001aeaa43a474e288df281a531bf8092049593d9e7b379f3277936d933c5da86294f9bdf00" 
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp

    it "matches on serializing RoundChanges" $ do
      let msg = WireMessage (MsgAuth addr sig) (RoundChange vw 0x0)
          (rlp, extra) = B16.decode "f86c0391d0ce850ccccccccc87a0a0a0a0a0aa0a80940000000000000000787878787878787878787878b841750650a73723d1e37dcd40dde70fdf4cc3a38694d37c5de66bbbfb3284dbf3e3557cd60f05df24b251ea2d49677bfef397c664374e35bda99bcd603b8be0f11c0180" 
      extra `shouldBe` ""
      msg `shouldBe` rlpDecode (rlpDeserialize rlp)
      rlpEncode msg `shouldBe` rlpDeserialize rlp
      rlpSerialize (rlpEncode msg) `shouldBe` rlp
