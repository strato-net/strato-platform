{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TupleSections #-}
module Main where

import Test.Hspec (Spec, hspec, describe, it, parallel, pending)
import Test.Hspec.Expectations.Lifted
import Test.QuickCheck

import Conduit
import Control.Lens
import Control.Monad.Trans.State

import qualified Data.Map as M

import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages
import Blockchain.SHA

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

setupRound :: (StateMachineM m) => Block -> [Address] -> m (RoundId, SHA)
setupRound blk as = do
  proposal .= Just blk
  validators .= as
  rid <- use roundId
  let di = blockHash blk
  return (rid, di)


spec :: Spec
spec = parallel $ do
  describe "The blockstanbul event loop" $ do
    it "requests a round changes round in response to a timeout or insertion failure" $ do
      runTest $ do
        got <- sendMessages [Timeout, CommitFailure "invalid hash"]
        map roundchangeRound got `shouldBe` [21, 21]
  describe "A preprepare message" $ do
    it "sets the current proposal in response a preprepare message" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        curRound <- use roundId
        let hsh = blockHash blk
        -- TODO(tim): change the auth to be that of the eventloop
        sendMessages [Preprepare auth curRound blk] `shouldReturn` [Prepare auth curRound hsh]
        use proposal `shouldReturn` Just blk

    it "rejects an unauthenticated preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        authenticator .= const False
        curRound <- use roundId
        sendMessages [Preprepare auth curRound blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-proposer" $ property $ \auth blk addr ->
      runTest $ do
        proposer .= Just addr
        validators .= [sender auth, addr]
        curRound <- use roundId
        sendMessages [Preprepare auth curRound blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-validator" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= []
        curRound <- use roundId
        sendMessages [Preprepare auth curRound blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "round-changes an old preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= Just (sender auth)
        validators .= [sender auth]
        curRound <- use roundId
        got <- sendMessages [Preprepare auth curRound{roundidRound = 3} blk]
        map roundchangeRound got `shouldBe` [21]

  describe "A prepare message" $ do
    it "sets the prepared state of a validator" $ property $ \auth blk ->
      runTest $ do
        (curRound, di) <- setupRound blk [sender auth]
        -- Only one validator, so that should be a majority
        sendMessages [Prepare auth curRound di] `shouldReturn` [Commit auth curRound di ()]
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= [sender auth]
        curRound <- use roundId
        sendMessages [Prepare auth curRound di] `shouldReturn` []
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "waits until there is more than 2/3s prepares to commit" $ property $ \sig a1 a2 a3 blk ->
      runTest $ do
        (curRound, di) <- setupRound blk [a1, a2, a3]
        let input = map (\a -> Prepare (MsgAuth a sig) curRound di) [a1, a2, a3]
        sendMessages input `shouldReturn` [Commit (MsgAuth a3 sig) curRound di ()]
        use prepared `shouldReturn` M.fromList [(a1, di), (a2, di), (a3, di)]

    it "only sends one commit message" $ property $ \sig as blk ->
      runTest $ do
        (curRound, di) <- setupRound blk as
        let input = map (\a -> Prepare (MsgAuth a sig) curRound di) as
        got <- sendMessages input
        got `shouldSatisfy` (== min (length as) 1) . length

  describe "A commit message" $ do
    it "sets the committed state" $ property $ \auth blk ->
      runTest $ do
        (curRound, di) <- setupRound blk [sender auth]
        sendMessages [Commit auth curRound di ()] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, ())
        use hasCommitted `shouldReturn` True
    it "won't trigger a commit with a hash mismatch" $ property $ \auth di blk ->
      runTest $ do
        let seal = ()
        (curRound, _) <- setupRound blk [sender auth]
        sendMessages [Commit auth curRound di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use hasCommitted `shouldReturn` False
    it "won't trigger a commit without a block" $ property $ \auth di ->
      runTest $ do
        let seal = ()
        validators .= [sender auth]
        curRound <- use roundId
        sendMessages [Commit auth curRound di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use hasCommitted `shouldReturn` False
    it "rejects a message from a non-validator" $ property $ \auth blk ->
      runTest $ do
        let seal = ()
        (curRound, di) <- setupRound blk []
        sendMessages [Commit auth curRound di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use hasCommitted `shouldReturn` False
    it "waits for 2/3s of commits" $ property $ \sig blk as ->
      runTest $ do
        let seal = ()
        (curRound, di) <- setupRound blk as
        let count =  2 * length as `div` 3
            (front, back) = splitAt count as
            toCommit a = Commit (MsgAuth a sig) curRound di seal
            earlyCommits = map toCommit front
            tippingPoint = map toCommit . take 1 $ back
        sendMessages earlyCommits `shouldReturn` []
        use committed `shouldReturn` M.fromList (map (, (di, seal)) front)
        use hasCommitted `shouldReturn` False
        sendMessages tippingPoint `shouldReturn` []
        use committed `shouldReturn` M.fromList (map (, (di, seal)) (take (count+1) as))
        -- If as == [], then both early and tipping are []
        use hasCommitted `shouldReturn` length as > 0

    it "only commits once" $ pending
