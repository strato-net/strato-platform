{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- | What a consensus message signature covers. Every test here runs with real
-- signature checks; the keys below stand in for four validators.
module MessageSigningSpec (spec) where

import BlockApps.Logging (LoggingT, runNoLoggingT)
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.Model.Authentication (commitmentMessage, proposalMessage)
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.Verification (transactionsVerificationValue)
import Control.Monad.Composable.Vault
import Control.Monad.State.Strict
import qualified Data.ByteString.Char8 as C8
import Data.List (nub)
import Data.Maybe
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import qualified LabeledError
import Test.Hspec
import Prelude hiding (round, sequence)

key :: Char -> PrivateKey
key = fromMaybe (error "bad key") . importPrivateKey . LabeledError.b16Decode "key" . C8.pack . replicate 64

k1, k2, k3, k4 :: PrivateKey
k1 = key '1'
k2 = key '2'
k3 = key '3'
k4 = key '4'

keys :: [PrivateKey]
keys = [k1, k2, k3, k4]

instance Monad m => HasBlockstanbulContext (StateT BlockstanbulContext m) where
  putBlockstanbulContext = put
  getBlockstanbulContext = get

instance {-# OVERLAPPING #-} Monad m => HasVault (StateT BlockstanbulContext m) where
  sign bs = return $ signMsg k1 bs
  getPub = error "getPub is not used by these tests"
  postKey = error "postKey is not used by these tests"
  getShared _ = error "getShared is not used by these tests"

run :: BlockstanbulContext -> StateT BlockstanbulContext (LoggingT IO) a -> IO a
run c = runNoLoggingT . flip evalStateT c

testChain, heliumChain :: Integer
testChain = 1
heliumChain = 114784819836269

-- | Four equal validators at round 20 of sequence 18, checking signatures.
ctxOn :: Integer -> View -> BlockstanbulContext
ctxOn chain v = newContext "test" chain ckpt (Just $ fromPrivateKey k1) True (Just 1000000)
  where ckpt = Checkpoint v (map (Validator . fromPrivateKey) keys) (Just zeroHash) [] 0

ctx :: BlockstanbulContext
ctx = ctxOn testChain (View 20 18)

-- | A message as the holder of the key would send it.
signed :: Integer -> PrivateKey -> TrustedMessage -> InEvent
signed chain k tm = IMsg (MsgAuth (fromPrivateKey k) (signMsg k (getHash chain tm))) tm

-- | The same signature attached to something else.
reuse :: InEvent -> TrustedMessage -> InEvent
reuse (IMsg auth _) tm = IMsg auth tm
reuse ev _ = ev

accepted :: BlockstanbulContext -> InEvent -> IO Bool
accepted c ev = (== AuthSuccess) <$> run c (isAuthorized ev)

-- | Proposed and sealed by the second validator.
block :: Block
block = addProposerSeal (signMsg k2 (proposalMessage unsealed)) unsealed
  where
    unsealed = Block hdr [] []
    hdr =
      BlockHeaderV2
        { parentHash = zeroHash,
          stateRoot = "",
          transactionsRoot = transactionsVerificationValue [],
          receiptsRoot = "",
          logsBloom = "",
          number = 19,
          timestamp = posixSecondsToUTCTime 0,
          extraData = "",
          currentValidators = map (Validator . fromPrivateKey) keys,
          newValidators = [],
          removedValidators = [],
          proposalSignature = Nothing,
          signatures = []
        }

spec :: Spec
spec = describe "consensus message signatures" $ do
  let here = View 20 18
      di = blockHash block
      seal k = signMsg k (commitmentMessage di)

  it "signs a different digest for every type, view, payload and network" $ do
    let digests =
          [ getHash testChain (Preprepare here block),
            getHash testChain (Prepare here di),
            getHash testChain (Commit here di (seal k2)),
            getHash testChain (Prepare (View 21 18) di),
            getHash testChain (Prepare (View 20 19) di),
            getHash testChain (Prepare here zeroHash),
            getHash testChain (RoundChange here 7),
            getHash testChain (RoundChange (View 21 18) 7),
            getHash testChain (RoundChange here 8),
            getHash 2 (Prepare here di),
            getHash 2 (RoundChange here 7)
          ]
    length (nub digests) `shouldBe` length digests

  it "accepts each message from the validator that signed it" $ do
    oks <-
      mapM
        (accepted ctx . signed testChain k2)
        [Preprepare here block, Prepare here di, Commit here di (seal k2), RoundChange (View 21 18) 7]
    oks `shouldBe` [True, True, True, True]

  it "rejects a ROUNDCHANGE signature attached to another round, sequence or nonce" $ do
    let seen = signed testChain k2 (RoundChange (View 21 18) 7)
    oks <- mapM (accepted ctx . reuse seen) [RoundChange (View 5000 18) 7, RoundChange (View 21 19) 7, RoundChange (View 21 18) 8]
    oks `shouldBe` [False, False, False]

  it "does not move the round on votes carrying signatures made for another round" $ do
    let honest = [signed testChain k (RoundChange (View 21 18) 7) | k <- [k2, k3, k4]]
        forged = [reuse ev (RoundChange (View 5000 18) 0x66) | ev <- honest]
    stuck <- run ctx $ sendAllMessages forged >> currentView
    _round stuck `shouldBe` 20
    moved <- run ctx $ sendAllMessages honest >> currentView
    _round moved `shouldBe` 21

  it "rejects a PREPARE signature attached to a COMMIT, a PREPREPARE or another view's PREPARE" $ do
    let seen = signed testChain k2 (Prepare here di)
    oks <- mapM (accepted ctx . reuse seen) [Commit here di (seal k2), Preprepare here block, Prepare (View 21 18) di]
    oks `shouldBe` [False, False, False]

  it "rejects a PREPREPARE whose transactions or uncles are not the header's" $ do
    let genuine = signed testChain k2 (Preprepare here block)
        junk = TD.MessageTX 0 0 0xabc "f" [] "" Nothing 0 0 0 0 ""
        swapped = [block {blockReceiptTransactions = [junk]}, block {blockBlockUncles = [blockBlockData block]}]
    -- the block hash, and with it the signature, is the same for all three
    map blockHash swapped `shouldBe` [di, di]
    oks <- mapM (accepted ctx . reuse genuine . Preprepare here) swapped
    oks `shouldBe` [False, False]
    accepted ctx genuine `shouldReturn` True

  it "can still take the genuine PREPREPARE after an altered copy arrived first" $ do
    let leader = _proposer ctx
        k = fromMaybe (error "leader key") $ lookup leader [(Validator (fromPrivateKey x), x) | x <- keys]
        genuine = signed testChain k (Preprepare here block)
        altered = reuse genuine (Preprepare here block {blockBlockUncles = [blockBlockData block]})
    out <- run ctx $ sendMessages [altered, genuine]
    [b | RunPreprepare b <- out] `shouldBe` [block]
    [() | OMsg _ RoundChange {} <- out] `shouldBe` []

  it "rejects a signature made for another network" $
    accepted ctx (signed 2 k2 (Prepare here di)) `shouldReturn` False

  it "keeps the legacy digest below a network's upgrade height and drops it from there on" $ do
    let below = View 20 999998 -- block 999999
        from = View 20 999999 -- block 1000000
        legacy v = IMsg (MsgAuth (fromPrivateKey k2) (signMsg k2 (legacyHash (Prepare v di)))) (Prepare v di)
    getHash heliumChain (Prepare below di) `shouldBe` keccak256ToByteString di
    getHash heliumChain (Prepare from di) `shouldNotBe` keccak256ToByteString di
    accepted (ctxOn heliumChain below) (legacy below) `shouldReturn` True
    accepted (ctxOn heliumChain from) (legacy from) `shouldReturn` False
    accepted (ctxOn heliumChain from) (signed heliumChain k2 (Prepare from di)) `shouldReturn` True
    -- a network without an entry never signs the legacy digest
    getHash testChain (Prepare (View 0 0) di) `shouldNotBe` keccak256ToByteString di

  it "signs its own messages with the digest it checks" $ do
    OMsg auth tm <- run ctx $ signMessage (RoundChange (View 21 18) 7)
    accepted ctx (IMsg auth tm) `shouldReturn` True
