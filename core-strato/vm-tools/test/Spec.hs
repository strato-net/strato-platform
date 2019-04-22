{-# LANGUAGE TemplateHaskell #-}
import Control.Monad
import Control.Monad.IO.Class
import Data.Maybe
import Data.Word
import HFlags
import Test.Hspec (hspec, describe, Spec)
import qualified Test.Hspec as HS
import Test.Hspec.Expectations.Lifted

import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.BenchmarkLib
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Output
import Blockchain.Strato.Model.Address
import Blockchain.VMContext
import Executable.EVMFlags ()
import Blockchain.VMOptions ()
import qualified Network.Haskoin.Crypto as HK

it :: String -> ContextM () -> HS.SpecWith ()
it qual act = HS.it qual . void . runNoLoggingT . runTestContextM $ act

main :: IO ()
main = do
  void $ $initHFlags "VMContext testing"
  hspec spec

blk :: Block
blk = makeBlock 1 1

prvKey :: HK.PrvKey
prvKey = fromMaybe (error "invalid private key number")
       $ HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5

sender :: Address
sender = prvKey2Address prvKey

recipient :: Address
recipient = 0xdeadbeef

recipient2 :: Address
recipient2 = 0x0ddba11

addVote :: MonadIO m => Address -> Word64 -> m Block
addVote addr nonc = do
  let blk' = blk{blockBlockData = (blockBlockData blk)
    { blockDataCoinbase = addr
    , blockDataNonce = nonc}}
  pSeal <- proposerSeal blk' prvKey
  return $ addProposerSeal pSeal blk'


spec :: Spec
spec = describe "VMContext" $ do
  it "has pending 0s without a queue" $ do
    peekPendingVote `shouldReturn` (0, 0)

  it "has a pending vote after an enqueue" $ do
    queuePendingVote recipient True sender
    peekPendingVote `shouldReturn` (recipient, maxBound)

  it "keeps a pending vote after peeking" $ do
    queuePendingVote recipient False sender
    peekPendingVote `shouldReturn` (recipient, 0)
    peekPendingVote `shouldReturn` (recipient, 0)

  it "will safely clear a vote that doesn't exist" $ do
    clearPendingVote blk

  it "removes pending votes from committed blocks" $ do
    queuePendingVote recipient True sender
    (cb, nonc) <- peekPendingVote
    blk' <- addVote cb nonc
    peekPendingVote `shouldReturn` (cb, nonc)
    clearPendingVote blk'
    peekPendingVote `shouldReturn` (0, 0)

  it "only clears one vote at a time" $ do
    queuePendingVote recipient True sender
    queuePendingVote recipient2 True sender
    (cb, nonc) <- peekPendingVote
    blk' <- addVote cb nonc
    clearPendingVote blk'
    -- The next pending vote should be the opposite of
    -- the previous pending vote
    peekPendingVote `shouldReturn`
      (if cb == recipient
         then (recipient2, maxBound)
         else (recipient, maxBound))

    (cb2, nonc2) <- peekPendingVote
    blk'' <- addVote cb2 nonc2
    clearPendingVote blk''
    peekPendingVote `shouldReturn` (0, 0)

  it "ignores blks from a different sender, even if they have the same vote" $ do
    queuePendingVote recipient True 0x4444
    (cb, nonc) <- peekPendingVote
    -- Note: `addVote` always comes from `sender`
    blk' <- addVote cb nonc
    clearPendingVote blk'
    peekPendingVote `shouldReturn` (cb, nonc)
