{-# LANGUAGE OverloadedStrings #-}
module AuthenticationSpec where

import Control.Lens
import Data.Maybe (fromMaybe, isJust, catMaybes)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Monoid ((<>))
import qualified Data.Set as S
import Data.Time.Clock.POSIX
import Test.Hspec
import Test.QuickCheck

import Blockchain.Blockstanbul.Authentication
import Blockchain.Data.Address
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.StateRoot
import qualified Network.Haskoin.Crypto as HK

testBlock :: Block
testBlock =
  Block {
    blockBlockData = BlockData {
      blockDataParentHash = SHA 0x0,
      blockDataUnclesHash = SHA 0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347,
      blockDataCoinbase = Address 0x0,
      blockDataStateRoot = StateRoot . fst . B16.decode $ "0000000000000000000000000000000000000000000000000000000000000000",
      blockDataTransactionsRoot = StateRoot . fst .B16.decode $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      blockDataReceiptsRoot = StateRoot . fst . B16.decode $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      blockDataLogBloom = B.replicate 256 0,
      blockDataDifficulty = 0,
      blockDataNumber = 40,
      blockDataGasLimit = 0,
      blockDataGasUsed = 0,
      blockDataTimestamp = posixSecondsToUTCTime 0,
      blockDataExtraData = "",
      blockDataNonce = 0,
      blockDataMixHash = blockstanbulMixHash
    },
    blockReceiptTransactions = [],
    blockBlockUncles = []
  }

testValidators :: [Address]
testValidators = [Address 0x101, Address 0xaaa]

private :: HK.PrvKey
private = fromMaybe (error "working key now fails") $ HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5

keys :: [HK.PrvKey]
keys = catMaybes [ HK.makePrvKey 0x2d5daffcc515a23155bc5b5d21f852ab2554e6cae0351c5561b44fad6931f62d
                 , HK.makePrvKey 0xafed2a302584130b650e6ef7727e0daefa3a3d557a8bd45c20418f2c2fab1a95
                 , HK.makePrvKey 0x3734309034f9b5bf36142295eec56ecb6ea4b095b3fe85e82797cbefdd7c1925
                 , HK.makePrvKey 0xafed2a302584130b650e6ef7727e0daefa3a3d557a8bd45c20418f2c2fab1a95
                 ]

spec :: Spec
spec = do
  describe "Commitment seals" $ do
    it "verifies the signatures" $ do
      let digest = SHA 0x1234
          want = Just . prvKey2Address $ private
      sig <- commitmentSeal digest private
      let got = verifyCommitmentSeal digest sig
      got `shouldBe` want

  describe "Proposal seals" $ do
    it "verifies the signatures, without including the seals" $ do
      let istExtra = IstanbulExtra testValidators Nothing []
          initialExtra = uncookRawExtra $ ExtraData (B.replicate 32 0) (Just istExtra)
      sig <- proposerSeal (set extraLens initialExtra testBlock) private
      let
          sealedExtra = uncookRawExtra $ ExtraData (B.replicate 32 0) (Just istExtra)
          sealedBlock = set extraLens sealedExtra testBlock
          got = verifyProposerSeal sealedBlock sig
          want = Just . prvKey2Address $ private
      got `shouldBe` want

  describe "Istanbul extra data" $ do
    let trim :: Bool -> B.ByteString -> B.ByteString
        trim exact bs = B.take 32 bs <> if exact
                                          then B.replicate (32 - B.length bs) 0
                                          else B.empty
    it "preserves data in round trips" $ property $ \ist bs' ->
      let bs = trim (isJust ist) bs'
          iex = ExtraData bs ist
      in do
        bs `shouldSatisfy` (== 32) . B.length
        cookRawExtra (uncookRawExtra iex) `shouldBe` iex

    it "by default only populates vanity" $ do
      cookRawExtra "h" `shouldBe` ExtraData "h" Nothing
      cookRawExtra "abc" `shouldBe` ExtraData "abc" Nothing
      let maxBs = B.replicate 32 0xff
      cookRawExtra maxBs `shouldBe` ExtraData maxBs Nothing

    it "can remove all seals" $ property $ \ist bs ->
      let iex = ExtraData (trim (isJust ist) bs) ist
          payload = uncookRawExtra iex
          wantIst = fmap (\i -> i{_proposedSig=Nothing, _commitment = []}) ist
          got = cookRawExtra . scrubAllSeals $ payload
      in got `shouldBe` iex{_istanbul=wantIst}
    it "can remove commitment seals" $ property $ \ist bs ->
      let iex = ExtraData (trim (isJust ist) bs) ist
          payload = uncookRawExtra iex
          wantIst = fmap (\i -> i{_commitment=[]}) ist
          got = cookRawExtra . scrubCommitmentSeals $ payload
      in got `shouldBe` iex{_istanbul=wantIst}

  describe "Historic Block" $ do
    it "Rejects a non-PBFT block" $
      let got = replayHistoricBlock S.empty 20 testBlock
      in got `shouldBe` Left "no istanbul metadata"

    it "Rejects a block with the wrong block number" $ do
      let vals = S.singleton 0xdeadbeef
          blk = addValidators vals testBlock
          got = replayHistoricBlock S.empty 300 blk
      got `shouldBe` Left "unexpected block number: have 40, wanted 301"

    it "Rejects a block with the wrong validator list" $ do
      let vals = S.map prvKey2Address . S.singleton $ private
          blk = addValidators vals testBlock
          got = replayHistoricBlock (S.singleton 0xdeadbeef) 39 blk
      got `shouldBe` Left "mismatched validators"

    it "Rejects a block without a proposer's signature" $ do
      let vals = S.singleton 0xdeadbeef
          blk = addValidators vals testBlock
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Left "invalid proposer seal"

    it "Rejects a block with a bad proposer's signature" $ do
      let vals = S.singleton 0xdeadbeef
          blk' = addValidators vals testBlock
      seal <- proposerSeal blk' private
      let blk = addProposerSeal seal blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Left "proposer 80976e7d04c8ae9b3a1c08278a5c385e5b0ff446 not a validator"

    it "Rejects a block without commit seals" $ do
      let vals = S.fromList $ map prvKey2Address [private]
          blk' = addValidators vals testBlock
      seal <- proposerSeal blk' private
      let blk = addProposerSeal seal blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Left "not enough commit seals (have 0 out of 1)"

    it "Rejects a block with an unknown seal" $ do
      let vals = S.fromList $ map prvKey2Address [private]
          blk'' = addValidators vals testBlock
      pSeal <- proposerSeal blk'' private
      let blk' = addProposerSeal pSeal blk''
      cSeal <- commitmentSeal (blockHash blk') (head keys)
      let blk = addCommitmentSeals [cSeal] blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Left "unknown signers: 807da1d7f5286530d0a71a2e87df146b8fefec96"

    it "Accepts a block with 1 validator" $ do
      let vals = S.fromList $ map prvKey2Address [private]
          blk'' = addValidators vals testBlock
      pSeal <- proposerSeal blk'' private
      let blk' = addProposerSeal pSeal blk''
      cSeal <- commitmentSeal (blockHash blk') private
      let blk = addCommitmentSeals [cSeal] blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Right (40, S.elemAt 0 vals)
