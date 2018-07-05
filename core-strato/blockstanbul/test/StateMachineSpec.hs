{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TupleSections #-}
module StateMachineSpec where

import Test.Hspec (Spec, describe, it, parallel, pendingWith)
import Test.Hspec.Expectations.Lifted
import Test.QuickCheck

import Conduit
import Control.Lens hiding (view)
import Control.Monad hiding (sequence)
import Control.Monad.Trans.State
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import Prelude hiding (round, sequence)

import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages
import Blockchain.SHA
import qualified Network.Haskoin.Crypto as HK

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
  Nothing
  M.empty
  (fromMaybe (error "working key now fails") $ HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5)

runTest :: StateT BlockstanbulContext IO () -> IO ()
runTest = flip evalStateT testContext

sendMessages :: (StateMachineM m) => [InEvent] -> m [OutEvent]
sendMessages wms = runConduit (yieldMany wms .| eventLoop .| sinkList)

setupRound :: (StateMachineM m) => Block -> [Address] -> m (View, SHA)
setupRound blk as = do
  proposal .= Just blk
  validators .= as
  v <- use view
  let di = blockHash blk
  return (v, di)


spec :: Spec
spec = parallel $ do
  describe "The blockstanbul event loop" $ do
    it "requests a round changes round in response to a timeout or insertion failure" $
      runTest $ do
        got <- sendMessages [Timeout, CommitFailure "invalid hash"]
        map (_round . roundchangeView . unOMsg) got `shouldBe` [21, 21]

    it "can handle several rounds in succession" $ property $ \blk blk2 as seal ->
      not (null as) ==> runTest $ do
        lift $ pendingWith "TODO(tim): calculate seal"
        (v, hsh) <- setupRound blk . map sender $ as
        let ppr = as !! ((fromIntegral . _round $ v) `mod` length as)
            wantBroadcaster = as !! (length as `div` 3)
            wantDecider = as !! (2 * length as `div` 3)
        proposer .= sender ppr
        sendMessages [IMsg $ Preprepare ppr v blk] `shouldReturn` [OMsg $ Prepare ppr v hsh]
        let preps = map (\a -> IMsg $ Prepare a v hsh) as
        sendMessages preps `shouldReturn` [OMsg $ Commit wantDecider v hsh seal]
        let coms = map (\a -> IMsg $ Commit a v hsh seal) as
        sendMessages coms `shouldReturn` []
        -- The proposer *shouldn't* change, because the round number is the same
        let nextPpr = as !! ((1 + fromIntegral (_round v)) `mod` length as)
        use proposer `shouldReturn` sender ppr
        v2 <- use view
        v2 `shouldBe` over sequence (+1) v
        -- TODO(tim): blk2 should probably have blk as a parent
        let hsh2 = blockHash blk2
        sendMessages [IMsg $ Preprepare nextPpr v2 blk2, IMsg $ Preprepare ppr v2 blk2]
          `shouldReturn`
            if ppr == nextPpr
              then [OMsg $ Prepare nextPpr v2 hsh2, OMsg $ Prepare ppr v2 hsh2]
              else [OMsg $ Prepare ppr v2 hsh2]
        -- Old prepares are now ignored
        sendMessages preps `shouldReturn` []
        let preps2 = map (\a -> IMsg $ Prepare a v2 hsh2) as
        sendMessages preps2 `shouldReturn` [OMsg $ Commit wantDecider v2 hsh2 seal]
        -- Old commits are now ignored
        sendMessages coms `shouldReturn` []
        use view `shouldReturn` v2
        -- Lets abort this round
        next <- uses view (over round (+1))
        let aborts = map (\a -> IMsg $ RoundChange a next) as
        sendMessages aborts `shouldReturn` [OMsg $ RoundChange wantBroadcaster next]
        use view `shouldReturn` over round (+1) v2
        use proposer `shouldReturn` sender nextPpr

  describe "A preprepare message" $ do
    it "sets the current proposal in response a preprepare message" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        curView <- use view
        let hsh = blockHash blk
        -- TODO(tim): change the auth to be that of the eventloop
        sendMessages [IMsg $ Preprepare auth curView blk] `shouldReturn` [OMsg $ Prepare auth curView hsh]
        use proposal `shouldReturn` Just blk

    it "rejects an unauthenticated preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        authenticator .= const False
        curView <- use view
        sendMessages [IMsg $ Preprepare auth curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-proposer" $ property $ \auth blk addr ->
      runTest $ do
        proposer .= addr
        validators .= [sender auth, addr]
        curView <- use view
        sendMessages [IMsg $ Preprepare auth curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-validator" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= []
        curView <- use view
        sendMessages [IMsg $ Preprepare auth curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "round-changes an old preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        curView <- use view
        got <- sendMessages [IMsg $ Preprepare auth curView{_round = 3} blk]
        map (_round . roundchangeView . unOMsg) got `shouldBe` [21]

  describe "A prepare message" $ do
    it "sets the prepared state of a validator" $ property $ \auth blk seal ->
      runTest $ do
        lift $ pendingWith "TODO(tim): calculate the seal"
        (curView, di) <- setupRound blk [sender auth]
        -- Only one validator, so that should be a majority
        sendMessages [IMsg $ Prepare auth curView di] `shouldReturn`
          [OMsg $ Commit auth curView di seal]
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= [sender auth]
        curView <- use view
        sendMessages [IMsg $ Prepare auth curView di] `shouldReturn` []
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "waits until there is more than 2/3s prepares to commit" $ property $ \sig a1 a2 a3 blk seal ->
      runTest $ do
        lift $ pendingWith "TODO(tim): seal the commit"
        (curView, di) <- setupRound blk [a1, a2, a3]
        let input = map (\a -> IMsg $ Prepare (MsgAuth a sig) curView di) [a1, a2, a3]
        -- TODO(tim): rewrite the seal on `got` to be the generated one
        sendMessages input `shouldReturn` [OMsg $ Commit (MsgAuth a3 sig) curView di seal]
        use prepared `shouldReturn` M.fromList [(a1, di), (a2, di), (a3, di)]

    it "only sends one commit message" $ property $ \sig as blk ->
      runTest $ do
        (curView, di) <- setupRound blk as
        let input = map (\a -> IMsg $ Prepare (MsgAuth a sig) curView di) as
        got <- sendMessages input
        got `shouldSatisfy` (== min (length as) 1) . length

  describe "A commit message" $ do
    it "sets the committed state" $ property $ \auth blk seal ->
      runTest $ do
        (curView@(View r s), di) <- setupRound blk [sender auth]
        sendMessages [IMsg $ Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use view `shouldReturn` View r (s+1)
    it "won't trigger a commit with a hash mismatch" $ property $ \auth di blk seal ->
      runTest $ do
        (curView, _) <- setupRound blk [sender auth]
        sendMessages [IMsg $ Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use view `shouldReturn` curView
    it "won't trigger a commit without a block" $ property $ \auth di seal ->
      runTest $ do
        validators .= [sender auth]
        curView <- use view
        sendMessages [IMsg $ Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use view `shouldReturn` curView
    it "rejects a message from a non-validator" $ property $ \auth blk seal ->
      runTest $ do
        (curView, di) <- setupRound blk []
        sendMessages [IMsg $ Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use view `shouldReturn` curView
    it "rejects a message from an unauthenticated peer" $ property $ \auth blk seal ->
      runTest $ do
        (curView, di) <- setupRound blk [sender auth]
        authenticator .= const False
        sendMessages [IMsg $ Commit auth curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use view `shouldReturn` curView

    it "waits for 2/3s of commits" $ property $ \sig blk as seal ->
      runTest $ do
        (curView@(View r s), di) <- setupRound blk as
        let count =  2 * length as `div` 3
            (front, back) = splitAt count as
            toCommit a = IMsg $ Commit (MsgAuth a sig) curView di seal
            earlyCommits = map toCommit front
            tippingPoint = map toCommit . take 1 $ back
        sendMessages earlyCommits `shouldReturn` []
        use committed `shouldReturn` M.fromList (map (, (di, seal)) front)
        use view `shouldReturn` curView
        sendMessages tippingPoint `shouldReturn` []
        -- The state resets and increments after a commit
        use committed `shouldReturn` M.empty
        when (length as > 0) $
          use view `shouldReturn` View r (s+1)

    it "only commits once" $ pendingWith "Requires a signal counting number of commits"

  describe "A round change message" $ do
    it "stores the maximum round seen from round-changes" $ property $ \blk a1 a2 a3-> do
      runTest $ do
        (curView, _) <- setupRound blk . map sender $ [a1, a2, a3]
        next <- uses view (over round (+4))
        let roundNext = _round next
        sendMessages [IMsg $ RoundChange a1 next] `shouldReturn` []
        -- 1 vote is not enough
        use pendingRound `shouldReturn` Nothing
        use roundChanged `shouldReturn` M.singleton (sender a1) roundNext
        use view `shouldReturn` curView
        -- 2 votes will be broadcast, but not taken up.
        sendMessages [IMsg $ RoundChange a2 next] `shouldReturn` [OMsg $ RoundChange a2 next]
        use pendingRound `shouldReturn` Just roundNext
        use roundChanged `shouldReturn` M.fromList [(sender a1, roundNext), (sender a2, roundNext)]
        use view `shouldReturn` curView
        -- 3 votes will do it
        sendMessages [IMsg $ RoundChange a3 next] `shouldReturn` []
        use pendingRound `shouldReturn` Nothing
        use roundChanged `shouldReturn` M.empty
        use view `shouldReturn` next
