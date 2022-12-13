{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString.Char8              as C8
import           Data.Maybe
import qualified Data.Set                           as S
import           Data.Word
import           HFlags
import           Test.Hspec (hspec, describe, Spec)
import qualified Test.Hspec                         as HS
import           Test.Hspec.Expectations.Lifted

import BlockApps.Logging
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.BenchmarkLib
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Secp256k1
import Blockchain.VMContext
import Executable.EVMFlags ()
import Blockchain.VMOptions ()
import qualified LabeledError

it :: String -> ContextM () -> HS.SpecWith ()
it qual act = HS.it qual . void . runNoLoggingT . runTestContextM $ act

main :: IO ()
main = do
  void $ $initHFlags "VMContext testing"
  hspec spec

blk :: Block
blk = makeBlock 1 1


private :: PrivateKey
private = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "private" $ C8.pack "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))


instance HasVault ContextM where
  sign bs = return $ signMsg private bs
  getPub = error "called getPub, but this should never happen"
  getShared _ = error "called getShared, but this should never happen"

senderAddress :: Address
senderAddress = fromPrivateKey private

sender :: ChainMemberParsedSet
sender = CommonName "BlockApps" "Engineering" "Admin" True

recipient :: ChainMemberParsedSet
recipient = CommonName "BlockApps" "Engineering" "James Hormuzdiar" True

--recipient2 :: ChainMemberParsedSet
--recipient2 = CommonName "BlockApps" "Engineering" "Nikita Mendelbaum" True

addVote :: (MonadIO m, HasVault m) => ChainMemberParsedSet -> Word64 -> m Block
addVote addr nonc = do
  let blk' = blk{blockBlockData = (blockBlockData blk)
    { blockDataCoinbase = addr
    , blockDataNonce = nonc}}
  let blk'' = addValidators (ChainMembers . S.singleton $ CommonName "I'm" "Not" "Sure" True) blk'
  pSeal <- proposerSeal blk''
  return $ addProposerSeal pSeal blk''


spec :: Spec
spec = describe "VMContext" $ do
  it "has pending 0s without a queue" $ do
    peekPendingVote `shouldReturn` (emptyChainMember, 0)

  it "has a pending vote after an enqueue" $ do
    queuePendingVote recipient True sender
    peekPendingVote `shouldReturn` (recipient, maxBound)

  it "keeps a pending vote after peeking" $ do
    queuePendingVote recipient False sender
    peekPendingVote `shouldReturn` (recipient, 0)
    peekPendingVote `shouldReturn` (recipient, 0)

  it "will safely clear a vote that doesn't exist" $ do
    clearPendingVote blk

  -- TODO: bootstrap tests with cert info for signer
  --it "removes pending votes from committed blocks" $ do
  --  queuePendingVote recipient True sender
  --  (cb, nonc) <- peekPendingVote
  --  blk' <- addVote cb nonc
  --  peekPendingVote `shouldReturn` (cb, nonc)
  --  clearPendingVote blk'
  --  peekPendingVote `shouldReturn` (emptyChainMember, 0)

  --it "only clears one vote at a time" $ do
  --  queuePendingVote recipient True sender
  --  queuePendingVote recipient2 True sender
  --  (cb, nonc) <- peekPendingVote
  --  blk' <- addVote cb nonc
  --  clearPendingVote blk'
  --  -- The next pending vote should be the opposite of
  --  -- the previous pending vote
  --  peekPendingVote `shouldReturn`
  --    (if cb == recipient
  --       then (recipient2, maxBound)
  --       else (recipient, maxBound))

  --  (cb2, nonc2) <- peekPendingVote
  --  blk'' <- addVote cb2 nonc2
  --  clearPendingVote blk''
  --  peekPendingVote `shouldReturn` (emptyChainMember, 0)

  it "ignores blks from a different sender, even if they have the same vote" $ do
    queuePendingVote recipient True sender
    (cb, nonc) <- peekPendingVote
    -- Note: `addVote` always comes from `sender`
    blk' <- addVote cb nonc
    let readSender = fromMaybe 0x0 $ verifyProposerSeal blk' =<< getProposerSeal blk'
    readSender `shouldBe` senderAddress
    senderAddress `shouldNotBe` 0x0
    clearPendingVote blk'
    peekPendingVote `shouldReturn` (cb, nonc)
