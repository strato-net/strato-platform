{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module AuthenticationSpec where

-- import           Control.Lens               hiding (children)
-- import qualified Control.Monad.Change.Alter as A
-- import           Control.Monad.Reader
-- import qualified Data.ByteString            as B
-- import qualified Data.ByteString.Char8      as C8
-- import           Data.Maybe
-- import           Data.Map.Strict            (Map)
-- import qualified Data.Map.Strict            as M
-- import qualified Data.Set                   as S
-- import           Data.Time.Clock.POSIX
import Test.Hspec hiding (shouldBe, shouldSatisfy)

-- import           Test.Hspec.Expectations.Lifted
-- import           Test.QuickCheck

-- import           BlockApps.X509.Certificate
-- import           Blockchain.Blockstanbul.Authentication
-- import           Blockchain.Data.Block
-- import           Blockchain.Data.DataDefs
-- import           Blockchain.Strato.Model.Address
-- import           Blockchain.Strato.Model.ChainMember
-- import           Blockchain.Strato.Model.Class
-- import           Blockchain.Strato.Model.Keccak256
-- import           Blockchain.Strato.Model.Secp256k1
-- import           Blockchain.Strato.Model.StateRoot

-- import qualified LabeledError

-- testBlock :: Block
-- testBlock =
--   let bData = BlockData {
--       blockDataParentHash = unsafeCreateKeccak256FromWord256 0x0,
--       blockDataUnclesHash = unsafeCreateKeccak256FromWord256 0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347,
--       blockDataCoinbase = emptyChainMember,
--       blockDataStateRoot = StateRoot . LabeledError.b16Decode "testBlock" $ "0000000000000000000000000000000000000000000000000000000000000000",
--       blockDataTransactionsRoot = StateRoot . LabeledError.b16Decode "testBlock" $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
--       blockDataReceiptsRoot = StateRoot . LabeledError.b16Decode "testBlock" $ "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
--       blockDataLogBloom = B.replicate 256 0,
--       blockDataDifficulty = 0,
--       blockDataNumber = 40,
--       blockDataGasLimit = 0,
--       blockDataGasUsed = 0,
--       blockDataTimestamp = posixSecondsToUTCTime 0,
--       blockDataExtraData = "",
--       blockDataNonce = 0,
--       blockDataMixHash = blockstanbulMixHash
--       }
--    in Block bData [] []

-- testValidators :: ChainMembers
-- testValidators = ChainMembers $ S.fromList [CommonName "BlockApps" "Engineering" "Admin" True, CommonName "Microsoft" "Sales" "Steve Ballmer" True]

-- private :: PrivateKey
-- private = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "private" $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

-- valX509Info :: X509CertInfoState
-- valX509Info = X509CertInfoState
--   (fromPrivateKey private)
--   (error "test reading certificate")
--   True
--   []
--   "BlockApps"
--    (Just "Engineering")
--   "Admin"

-- runTest :: ReaderT (Map Address X509CertInfoState) IO a -> IO a
-- runTest f =
--   let r = M.singleton (fromPrivateKey private) valX509Info
--    in runReaderT f r

-- instance HasVault IO where
--   sign bs = return $ signMsg private bs
--   getPub = error "called getPub, but this should never happen"
--   getShared _ = error "called getShared, but this should never happen"

-- instance (HasVault(ReaderT (Map Address X509CertInfoState) IO))

-- -- instance (ReaderT (Map Address X509CertInfoState) IO) where

-- -- instance (A.Selectable Address X509CertInfoState m)

-- -- instance  (A.Selectable Address X509CertInfoState (ReaderT (Map Address X509CertInfoState) IO))

spec :: Spec
spec = return ()

--   describe "Commitment seals" $ do
--     it "verifies the signatures" $ runTest $ do
--       let digest = unsafeCreateKeccak256FromWord256 0x1234
--           want = Just . fromPrivateKey $ private
--       sig <- commitmentSeal digest
--       let got = verifyCommitmentSeal digest sig
--       got `shouldBe` want

--   describe "Proposal seals" $ do
--     it "verifies the signatures, without including the seals" $ runTest $ do
--       let istExtra = IstanbulExtra testValidators Nothing []
--           initialExtra = uncookRawExtra $ ExtraData (B.replicate 32 0) (Just istExtra)
--       sig <- proposerSeal (set extraLens initialExtra testBlock)
--       let sealedExtra = uncookRawExtra $ ExtraData (B.replicate 32 0) (Just istExtra)
--           sealedBlock = set extraLens sealedExtra testBlock
--           got = verifyProposerSeal sealedBlock sig
--           want = Just . fromPrivateKey $ private
--       got `shouldBe` want

--   describe "Istanbul extra data" $ do
--     let trim :: Bool -> B.ByteString -> B.ByteString
--         trim exact bs = B.take 32 bs <> if exact
--                                           then B.replicate (32 - B.length bs) 0
--                                           else B.empty
--     it "preserves data in round trips" $ property $ \ist bs' ->
--       let bs = trim (isJust ist) bs'
--           iex = ExtraData bs ist
--       in do
--         bs `shouldSatisfy` (<= 32) . B.length
--         cookRawExtra (uncookRawExtra iex) `shouldBe` iex

--     it "by default only populates vanity" $ runTest $ do
--       cookRawExtra "h" `shouldBe` ExtraData "h" Nothing
--       cookRawExtra "abc" `shouldBe` ExtraData "abc" Nothing
--       let maxBs = B.replicate 32 0xff
--       cookRawExtra maxBs `shouldBe` ExtraData maxBs Nothing

--     it "can remove all seals" $ property $ \ist bs ->
--       let iex = ExtraData (trim (isJust ist) bs) ist
--           payload = uncookRawExtra iex
--           wantIst = fmap (\i -> i{_proposedSig=Nothing, _commitment = []}) ist
--           got = cookRawExtra . scrubAllSeals $ payload
--       in got `shouldBe` iex{_istanbul=wantIst}
--     it "can remove commitment seals" $ property $ \ist bs ->
--       let iex = ExtraData (trim (isJust ist) bs) ist
--           payload = uncookRawExtra iex
--           wantIst = fmap (\i -> i{_commitment=[]}) ist
--           got = cookRawExtra . scrubCommitmentSeals $ payload
--       in got `shouldBe` iex{_istanbul=wantIst}

--   describe "Historic Block" $ do
--     it "Rejects a non-PBFT block" $ runTest $ do
--       got <- replayHistoricBlock (ChainMembers S.empty) 20 testBlock
--       got `shouldBe` Left "no istanbul metadata"

--     it "Rejects a block with the wrong block number" $ runTest $ do
--       let vals = ChainMembers . S.fromList $ [CommonName "BlockApps" "Engineering" "Admin" True]
--           blk = addValidators vals testBlock
--       got <- replayHistoricBlock (ChainMembers S.empty) 300 blk
--       got `shouldBe` Left "unexpected block number: have 40, wanted 301"

--     it "Rejects a block with the wrong validator list" $ runTest $ do
--       let vals = ChainMembers . S.fromList $ [CommonName "BlockApps" "Engineering" "Admin" True]
--           wrongVal = ChainMembers . S.fromList $ [CommonName "Microsoft" "Engineering" "Admin" True]
--           blk = addValidators vals testBlock
--       got <- replayHistoricBlock wrongVal 39 blk
--       got `shouldBe` Left "mismatched validators"

--     it "Rejects a block without a proposer's signature" $ runTest $ do
--       let vals = ChainMembers . S.fromList $ [CommonName "BlockApps" "Engineering" "Admin" True]
--           blk = addValidators vals testBlock
--       got <- replayHistoricBlock vals 39 blk
--       got `shouldBe` Left "invalid proposer seal"

--     it "Rejects a block with a bad proposer's signature" $ runTest $ do
--       let vals = ChainMembers . S.fromList $ [CommonName "BlockApps" "Engineering" "Admin" True]
--           blk' = addValidators vals testBlock
--       seal <- proposerSeal blk'
--       let blk = addProposerSeal seal blk'
--       got <- replayHistoricBlock vals 39 blk
--       got `shouldBe` Left "proposer 00b54e93ee2eba3086a55f4249873e291d1ab06c not a validator"

--     it "Rejects a block without commit seals" $ runTest $ do
--       let vals = ChainMembers . S.fromList $ [CommonName "BlockApps" "Engineering" "Admin" True]
--           blk' = addValidators vals testBlock
--       seal <- proposerSeal blk'
--       let blk = addProposerSeal seal blk'
--       got <- replayHistoricBlock vals 39 blk
--       got `shouldBe` Left "not enough commit seals (have 0 out of 1)"

--     it "Rejects a block with an unknown seal" $ runTest $ do
--       let mFakeKey = importPrivateKey (LabeledError.b16Decode "blockstanbul/AuthenticationSpec.hs" $ C8.pack $ "2d5daffcc515a23155bc5b5d21f852ab2554e6cae0351c5561b44fad6931f62d")
--           fakeKey = fromMaybe (error "could not import fake key") mFakeKey
--           vals = ChainMembers . S.fromList $ [CommonName "BlockApps" "Engineering" "Admin" True]
--           blk'' = addValidators vals testBlock
--       pSeal <- proposerSeal blk''
--       let blk' = addProposerSeal pSeal blk''
--           cSeal = signMsg (fakeKey) (keccak256ToByteString $ blockHash blk')
--           blk = addCommitmentSeals [cSeal] blk'
--       got <- replayHistoricBlock vals 39 blk
--       got `shouldBe` Left "unknown signers: 9a4a1b2b0e0d2b5d378ecc392d337a6557602559"

--     it "Accepts a block with 1 validator" $ runTest $ do
--       let vals = ChainMembers . S.fromList $ [CommonName "BlockApps" "Engineering" "Admin" True]
--           blk'' = addValidators vals testBlock
--       pSeal <- proposerSeal blk''
--       let blk' = addProposerSeal pSeal blk''
--       cSeal <- commitmentSeal (blockHash blk')
--       let blk = addCommitmentSeals [cSeal] blk'
--       got <- replayHistoricBlock vals 39 blk
--       got `shouldBe` Right (40, S.elemAt 0 $ unChainMembers vals)
