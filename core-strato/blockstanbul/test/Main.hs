{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TupleSections #-}
module Main where

import Test.Hspec (Spec, hspec, describe, it, parallel, pendingWith)
import Test.Hspec.Expectations.Lifted
import Test.QuickCheck

import Conduit
import Control.Lens hiding (view)
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
  (View 20 18)
  (const True)
  Nothing
  (Address 0x0)
  []
  M.empty
  M.empty
  False
  False
  Nothing
  M.empty
  False

runTest :: StateT BlockstanbulContext IO () -> IO ()
runTest = flip evalStateT testContext

sendMessages :: (StateMachineM m) => [BlockstanbulEvent] -> m [BlockstanbulEvent]
sendMessages wms = runConduit (yieldMany wms .| eventLoop .| sinkList)

setupRound :: (StateMachineM m) => Block -> [Address] -> m (View, SHA)
setupRound blk as = do
  proposal .= Just blk
  validators .= as
  rid <- use view
  let di = blockHash blk
  return (rid, di)


spec :: Spec
spec = parallel $ do
  describe "The blockstanbul event loop" $ do
    it "requests a round changes round in response to a timeout or insertion failure" $ do
      runTest $ do
        got <- sendMessages [Timeout, CommitFailure "invalid hash"]
        map roundchangeView got `shouldBe` [View 21 18, View 21 18]
  describe "A preprepare message" $ do
    it "sets the current proposal in response a preprepare message" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        curView <- use view
        let hsh = blockHash blk
        -- TODO(tim): change the auth to be that of the eventloop
        sendMessages [Preprepare auth curView blk] `shouldReturn` [Prepare auth curView hsh]
        use proposal `shouldReturn` Just blk

    it "rejects an unauthenticated preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        authenticator .= const False
        curView <- use view
        sendMessages [Preprepare auth curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-proposer" $ property $ \auth blk addr ->
      runTest $ do
        proposer .= addr
        validators .= [sender auth, addr]
        curView <- use view
        sendMessages [Preprepare auth curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-validator" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= []
        curView <- use view
        sendMessages [Preprepare auth curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "round-changes an old preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        curView <- use view
        got <- sendMessages [Preprepare auth curView{viewRound = 3} blk]
        map roundchangeView got `shouldBe` [View 21 18]

  describe "A prepare message" $ do
    it "sets the prepared state of a validator" $ property $ \auth blk ->
      runTest $ do
        (curView, di) <- setupRound blk [sender auth]
        -- Only one validator, so that should be a majority
        sendMessages [Prepare auth curView di] `shouldReturn` [Commit auth curView di ()]
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= [sender auth]
        curView <- use view
        sendMessages [Prepare auth curView di] `shouldReturn` []
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "waits until there is more than 2/3s prepares to commit" $ property $ \sig a1 a2 a3 blk ->
      runTest $ do
        (curView, di) <- setupRound blk [a1, a2, a3]
        let input = map (\a -> Prepare (MsgAuth a sig) curView di) [a1, a2, a3]
        sendMessages input `shouldReturn` [Commit (MsgAuth a3 sig) curView di ()]
        use prepared `shouldReturn` M.fromList [(a1, di), (a2, di), (a3, di)]

    it "only sends one commit message" $ property $ \sig as blk ->
      runTest $ do
        (curView, di) <- setupRound blk as
        let input = map (\a -> Prepare (MsgAuth a sig) curView di) as
        got <- sendMessages input
        got `shouldSatisfy` (== min (length as) 1) . length

  describe "A commit message" $ do
    it "sets the committed state" $ property $ \auth blk ->
      runTest $ do
        (curView, di) <- setupRound blk [sender auth]
        sendMessages [Commit auth curView di ()] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, ())
        use hasCommitted `shouldReturn` True
    it "won't trigger a commit with a hash mismatch" $ property $ \auth di blk ->
      runTest $ do
        let seal = ()
        (curView, _) <- setupRound blk [sender auth]
        sendMessages [Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use hasCommitted `shouldReturn` False
    it "won't trigger a commit without a block" $ property $ \auth di ->
      runTest $ do
        let seal = ()
        validators .= [sender auth]
        curView <- use view
        sendMessages [Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use hasCommitted `shouldReturn` False
    it "rejects a message from a non-validator" $ property $ \auth blk ->
      runTest $ do
        let seal = ()
        (curView, di) <- setupRound blk []
        sendMessages [Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use hasCommitted `shouldReturn` False
    it "rejects a message from an unauthenticated peer" $ property $ \auth blk ->
      runTest $ do
        let seal = ()
        (curView, di) <- setupRound blk [sender auth]
        authenticator .= const False
        sendMessages [Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use hasCommitted `shouldReturn` False

    it "waits for 2/3s of commits" $ property $ \sig blk as ->
      runTest $ do
        let seal = ()
        (curView, di) <- setupRound blk as
        let count =  2 * length as `div` 3
            (front, back) = splitAt count as
            toCommit a = Commit (MsgAuth a sig) curView di seal
            earlyCommits = map toCommit front
            tippingPoint = map toCommit . take 1 $ back
        sendMessages earlyCommits `shouldReturn` []
        use committed `shouldReturn` M.fromList (map (, (di, seal)) front)
        use hasCommitted `shouldReturn` False
        sendMessages tippingPoint `shouldReturn` []
        use committed `shouldReturn` M.fromList (map (, (di, seal)) (take (count+1) as))
        -- If as == [], then both early and tipping are []
        use hasCommitted `shouldReturn` length as > 0

    it "only commits once" $ pendingWith "Requires a signal counting number of commits"

  describe "A round change message" $ do
    it "stores the maximum view seen from round changes" $ pendingWith "todo"
    it "waits for 1/3s before sending own message" $ pendingWith "todo"
    it "waits for 2/3s of messages before transitioning rounds" $ pendingWith "todo"
