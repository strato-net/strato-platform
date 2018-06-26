{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
module Main where

import Test.Hspec
import Test.QuickCheck

import Conduit
import Control.Lens
import Control.Monad.Trans.State

import qualified Data.Map as M

import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages

main :: IO ()
main = hspec spec

expectAs :: (MonadIO m, Eq a, Show a) => a -> a -> m ()
expectAs x y = liftIO $ x `shouldBe` y

testContext :: BlockstanbulContext
testContext = BlockstanbulContext
  (RoundId 20 18)
  (const True)
  Nothing
  Nothing
  []
  M.empty
  M.empty

runTest :: StateT BlockstanbulContext IO () -> IO ()
runTest = flip evalStateT testContext

sendMessages :: (StateMachineM m) => [BlockstanbulEvent] -> m [BlockstanbulEvent]
sendMessages wms = runConduit (yieldMany wms .| eventLoop .| sinkList)

spec :: Spec
spec = parallel $ do
  describe "The blockstanbul event loop" $ do
    it "does nothing to the messages" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        curRound <- use roundId
        let m1 = Preprepare auth curRound blk
        let hash = blockHash blk
        m2 <- sendMessages [m1]
        m2 `expectAs` [Prepare auth curRound hash]
        m3 <- sendMessages m2
        m3 `expectAs` [Commit auth curRound hash ()]
        m4 <- sendMessages m3
        m4 `expectAs` [RoundChange auth 21]
        m5 <- sendMessages m4
        m5 `expectAs` [] :: StateT BlockstanbulContext IO ()

    it "changes rounds in response to a timeout or insertion failure" $ do
      runTest $ do
        let input = [Timeout, CommitFailure "invalid hash"]
        got <- sendMessages input
        map roundchangeRound got `expectAs` [21, 21]
  describe "A preprepare message" $ do
    it "sets the current proposal in response a preprepare message" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        curRound <- use roundId
        let input = [Preprepare auth curRound blk]
        let hash = blockHash blk
        got <- sendMessages input
        -- TODO(tim): change the auth to be that of the eventloop
        got `expectAs` [Prepare auth curRound hash]
        gotProp <- use proposal
        gotProp `expectAs` Just blk

    it "rejects an unauthenticated preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        authenticator .= const False
        curRound <- use roundId
        let input = [Preprepare auth curRound blk]
        got <- sendMessages input
        got `expectAs` []
        gotProp <- use proposal
        gotProp `expectAs` Nothing

    it "rejects a preprepare from a non-proposer" $ property $ \auth blk addr ->
      runTest $ do
        proposer .= Just addr
        validators .= [sender auth, addr]
        curRound <- use roundId
        let input = [Preprepare auth curRound blk]
        got <- sendMessages input
        got `expectAs` []
        gotProp <- use proposal
        gotProp `expectAs` Nothing

    it "rejects a preprepare from a non-validator" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= []
        curRound <- use roundId
        let input = [Preprepare auth curRound blk]
        got <- sendMessages input
        got `expectAs` []
        gotProp <- use proposal
        gotProp `expectAs` Nothing

    it "round-changes an old preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        curRound <- use roundId
        let input = [Preprepare auth curRound{roundidRound = 3} blk]
        got <- sendMessages input
        map roundchangeRound got `expectAs` [21]

  describe "A prepare message" $ do
    it "sets the prepared state of a validator" $ property $ \auth blk ->
      runTest $ do
        validators .= [sender auth]
        curRound <- use roundId
        proposal .= Just blk
        let di = blockHash blk
        let input = [Prepare auth curRound di]
        got <- sendMessages input
        -- Only one validator, so that should be a majority
        got `expectAs` [Commit auth curRound di ()]
        gotVotes <- use prepared
        gotVotes `expectAs` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= [sender auth]
        curRound <- use roundId
        got <- sendMessages [Prepare auth curRound di]
        got `expectAs` []
        gotVotes <- use prepared
        gotVotes `expectAs` M.singleton (sender auth) di
