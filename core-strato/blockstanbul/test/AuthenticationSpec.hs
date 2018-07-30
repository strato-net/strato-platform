{-# LANGUAGE OverloadedStrings #-}
module AuthenticationSpec where

import Control.Lens
import Data.Maybe (fromMaybe, isJust)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Monoid ((<>))
import Data.Time.Clock.POSIX
import Test.Hspec
import Test.QuickCheck

import Blockchain.Blockstanbul.Authentication
import Blockchain.Data.Address
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Database.MerklePatricia.StateRoot
import Blockchain.SHA
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

testValidators :: [Address]
testValidators = [Address 0x101, Address 0xaaa]

private :: HK.PrvKey
private = (fromMaybe (error "working key now fails") $ HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5)

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
