{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
module Main where

import Test.Hspec (Spec, hspec, describe, it, parallel)
import Test.Hspec.Expectations.Lifted
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

testContext :: BlockstanbulContext
testContext = BlockstanbulContext
  (RoundId 20 18)
  (const True)
  Nothing
  Nothing
  []
  M.empty
  M.empty
  False
  False

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
        m2 `shouldBe` [Prepare auth curRound hash]
        m3 <- sendMessages m2
        m3 `shouldBe` [Commit auth curRound hash ()]
        m4 <- sendMessages m3
        m4 `shouldBe` [RoundChange auth 21]
        m5 <- sendMessages m4
        m5 `shouldBe` [] :: StateT BlockstanbulContext IO ()

    it "changes rounds in response to a timeout or insertion failure" $ do
      runTest $ do
        let input = [Timeout, CommitFailure "invalid hash"]
        got <- sendMessages input
        map roundchangeRound got `shouldBe` [21, 21]
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
        got `shouldBe` [Prepare auth curRound hash]
        gotProp <- use proposal
        gotProp `shouldBe` Just blk

    it "rejects an unauthenticated preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        authenticator .= const False
        curRound <- use roundId
        let input = [Preprepare auth curRound blk]
        got <- sendMessages input
        got `shouldBe` []
        gotProp <- use proposal
        gotProp `shouldBe` Nothing

    it "rejects a preprepare from a non-proposer" $ property $ \auth blk addr ->
      runTest $ do
        proposer .= Just addr
        validators .= [sender auth, addr]
        curRound <- use roundId
        let input = [Preprepare auth curRound blk]
        got <- sendMessages input
        got `shouldBe` []
        gotProp <- use proposal
        gotProp `shouldBe` Nothing

    it "rejects a preprepare from a non-validator" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= []
        curRound <- use roundId
        let input = [Preprepare auth curRound blk]
        got <- sendMessages input
        got `shouldBe` []
        gotProp <- use proposal
        gotProp `shouldBe` Nothing

    it "round-changes an old preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        curRound <- use roundId
        let input = [Preprepare auth curRound{roundidRound = 3} blk]
        got <- sendMessages input
        map roundchangeRound got `shouldBe` [21]

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
        got `shouldBe` [Commit auth curRound di ()]
        gotVotes <- use prepared
        gotVotes `shouldBe` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= [sender auth]
        curRound <- use roundId
        got <- sendMessages [Prepare auth curRound di]
        got `shouldBe` []
        gotVotes <- use prepared
        gotVotes `shouldBe` M.singleton (sender auth) di
    it "waits until there is more than 2/3s prepares to commit" $ property $ \sig a1 a2 a3 blk ->
      runTest $ do
        proposal .= Just blk
        let di = blockHash blk
        validators .= [a1, a2, a3]
        curRound <- use roundId
        let input = map (\a -> Prepare (MsgAuth a sig) curRound di) [a1, a2, a3]
        got <- sendMessages input
        got `shouldBe` [Commit (MsgAuth a3 sig) curRound di ()]
        votes <- use prepared
        votes `shouldBe` M.fromList [(a1, di), (a2, di), (a3, di)]

    it "only sends one commit message" $ property $ \sig as blk ->
      runTest $ do
        proposal .= Just blk
        validators .= as
        curRound <- use roundId
        let di = blockHash blk
        let input = map (\a -> Prepare (MsgAuth a sig) curRound di) as
        got <- sendMessages input
        got `shouldSatisfy` (== min (length as) 1) . length
