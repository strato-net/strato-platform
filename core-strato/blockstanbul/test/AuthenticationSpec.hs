{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module AuthenticationSpec where




import           Control.Lens
import qualified Data.ByteString            as B
import qualified Data.ByteString.Base16     as B16
import qualified Data.ByteString.Char8      as C8
import           Data.Maybe
import qualified Data.Set                   as S
import           Data.Time.Clock.POSIX
import           Test.Hspec
import           Test.QuickCheck

import           Blockchain.Blockstanbul.Authentication
import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Model.StateRoot


testBlock :: Block
testBlock =
  let bData = BlockData {
      blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0,
      blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347,
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
      }
   in Block bData [] []

testValidators :: [Address]
testValidators = [Address 0x101, Address 0xaaa]

private :: PrivateKey
private = fromMaybe (error "could not import private key") (importPrivateKey (fst $ B16.decode $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866")) 



instance HasVault IO where
  sign bs = return $ signMsg private bs 
  getPub = error "called getPub, but this should never happen"
  getShared _ = error "called getShared, but this should never happen"

spec :: Spec
spec = do
  describe "Commitment seals" $ do
    it "verifies the signatures" $ do
      let digest = unsafeCreateKeccak256FromWord256 0x1234
          want = Just . fromPrivateKey $ private
      sig <- commitmentSeal digest
      let got = verifyCommitmentSeal digest sig
      got `shouldBe` want

  describe "Proposal seals" $ do
    it "verifies the signatures, without including the seals" $ do
      let istExtra = IstanbulExtra testValidators Nothing []
          initialExtra = uncookRawExtra $ ExtraData (B.replicate 32 0) (Just istExtra)
      sig <- proposerSeal (set extraLens initialExtra testBlock)
      let sealedExtra = uncookRawExtra $ ExtraData (B.replicate 32 0) (Just istExtra)
          sealedBlock = set extraLens sealedExtra testBlock
          got = verifyProposerSeal sealedBlock sig
          want = Just . fromPrivateKey $ private
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
        bs `shouldSatisfy` (<= 32) . B.length
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
      let vals = S.map fromPrivateKey . S.singleton $ private
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
      seal <- proposerSeal blk'
      let blk = addProposerSeal seal blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Left "proposer 00b54e93ee2eba3086a55f4249873e291d1ab06c not a validator"

    it "Rejects a block without commit seals" $ do
      let vals = S.fromList $ map fromPrivateKey [private]
          blk' = addValidators vals testBlock
      seal <- proposerSeal blk'
      let blk = addProposerSeal seal blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Left "not enough commit seals (have 0 out of 1)"

    it "Rejects a block with an unknown seal" $ do
      let mFakeKey = importPrivateKey (fst $ B16.decode $ C8.pack $ "2d5daffcc515a23155bc5b5d21f852ab2554e6cae0351c5561b44fad6931f62d")
          fakeKey = fromMaybe (error "could not import fake key") mFakeKey
          vals = S.fromList $ map fromPrivateKey [private]
          blk'' = addValidators vals testBlock
      pSeal <- proposerSeal blk'' 
      let blk' = addProposerSeal pSeal blk''
          cSeal = signMsg (fakeKey) (keccak256ToByteString $ blockHash blk')
          blk = addCommitmentSeals [cSeal] blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Left "unknown signers: 9a4a1b2b0e0d2b5d378ecc392d337a6557602559" 

    it "Accepts a block with 1 validator" $ do
      let vals = S.fromList $ map fromPrivateKey [private]
          blk'' = addValidators vals testBlock
      pSeal <- proposerSeal blk''
      let blk' = addProposerSeal pSeal blk''
      cSeal <- commitmentSeal (blockHash blk')
      let blk = addCommitmentSeals [cSeal] blk'
          got = replayHistoricBlock vals 39 blk
      got `shouldBe` Right (40, S.elemAt 0 vals)
