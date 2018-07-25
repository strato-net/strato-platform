{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module StateMachineSpec where

import Test.Hspec (Spec, describe, it, parallel)
import Test.Hspec.Expectations.Lifted
import Test.QuickCheck

import Control.Lens hiding (view)
import qualified Control.Lens as L
import Control.Monad hiding (sequence)
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.Trans.State
import qualified Data.ByteString as BS
import Data.List
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import Prelude hiding (round, sequence)

import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.Data.DataDefs
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages
import Blockchain.SHA
import qualified Network.Haskoin.Crypto as HK

testContext :: BlockstanbulContext
testContext = newContext (View 20 18) [] (fromMaybe (error "working key now fails") $ HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5)

runTest :: StateT BlockstanbulContext (NoLoggingT IO) () -> IO ()
runTest = runNoLoggingT . flip evalStateT testContext

instance (Monad m) => HasBlockstanbulContext (StateT BlockstanbulContext m) where
  putBlockstanbulContext = put
  getBlockstanbulContext = Just <$> get

setupRound :: (StateMachineM m) => Block -> [Address] -> m (View, SHA)
setupRound blk' as = do
  let blk = truncateExtra blk'
  proposal .= Just blk
  validators .= as
  v <- use view
  let di = blockHash blk
  return (v, di)

compareNoExtra :: (MonadIO m) => Block -> Block -> m ()
compareNoExtra b1 b2 = set extraLens "" b1 `shouldBe` set extraLens "" b2

spec :: Spec
spec = parallel $ do
  describe "The blockstanbul event loop" $ do
    it "requests a round changes round in response to a timeout or insertion failure" $
      runTest $ do
        got <- sendMessages [Timeout, CommitResult (Left  "invalid hash")]
        map (_round . roundchangeView . oMessage) got `shouldBe` [21, 21]

    it "can handle several rounds in succession" $ property $ \blk' blk2' as seal ->
      not (null as) ==> runTest $ do
        let (blk, blk2) = over both (addProposerSeal seal . truncateExtra) (blk', blk2')
        (v, hsh) <- setupRound blk . map sender $ as
        let ppr = as !! ((fromIntegral . _round $ v) `mod` length as)
        proposer .= sender ppr
        omsgs1 <- sendMessages [IMsg ppr $ Preprepare v blk]
        map oMessage omsgs1 `shouldBe` [Prepare v hsh]
        let preps = map (\a -> IMsg a $ Prepare v hsh) as
        omsgs2 <- sendMessages preps
        let [Commit v' hsh' seal'] = map oMessage omsgs2
        (v', hsh') `shouldBe` (v, hsh)
        me <- selfAddr
        seal' `shouldSatisfy` (== Just me) . verifyCommitmentSeal hsh
        let coms = map (\a -> IMsg a $ Commit v hsh seal) as
        xsp <- sendMessages coms
        length xsp `shouldBe` 1
        xsp `shouldBe` [ToCommit blk]
        -- Pretend that in this interval, the block was committed
        sendMessages [CommitResult (Right ())] `shouldReturn` []
        -- The proposer *shouldn't* change, because the round number is the same
        let nextPpr = as !! ((1 + fromIntegral (_round v)) `mod` length as)
        use proposer `shouldReturn` sender ppr
        v2 <- use view
        v2 `shouldBe` over sequence (+1) v
        -- TODO(tim): blk2 should probably have blk as a parent
        let hsh2 = blockHash blk2
        omsgs3 <- sendMessages [IMsg nextPpr $ Preprepare v2 blk2, IMsg ppr $ Preprepare v2 blk2]
        map oMessage omsgs3 `shouldMatchList`
            if ppr == nextPpr
              then [Prepare v2 hsh2, Prepare v2 hsh2]
              else [Prepare v2 hsh2]
        -- Old prepares are now ignored
        sendMessages preps `shouldReturn` []
        let preps2 = map (\a -> IMsg a $ Prepare v2 hsh2) as
        omsgs4 <- sendMessages preps2
        let [Commit v2' hsh2' seal2'] = map oMessage omsgs4
        (v2', hsh2') `shouldBe` (v2, hsh2)
        seal2' `shouldSatisfy` (== Just me) . verifyCommitmentSeal hsh2
        -- Old commits are now ignored
        sendMessages coms `shouldReturn` []
        use view `shouldReturn` v2
        -- Lets abort this round
        next <- uses view (over round (+1))
        let aborts = map (\a -> IMsg a $ RoundChange next) as
        omsgs5 <- sendMessages aborts
        map oMessage omsgs5 `shouldBe` [RoundChange next]
        use view `shouldReturn` over round (+1) v2
        use proposer `shouldReturn` sender nextPpr

    it "increments sequence number" $ property $ \blk as seal ->
      not (null as) ==> runTest $ do
        (v, hsh) <- setupRound blk . map sender $ as
        let ppr = as !! ((fromIntegral . _round $ v) `mod` length as)
        void $ sendMessages $ [IMsg ppr $ Preprepare v blk]
                           ++ [IMsg a $ Prepare v hsh | a <- as]
                           ++ [IMsg a $ Commit v hsh seal | a <- as]
                           ++ [CommitResult (Right ())]
        use view `shouldReturn` over sequence (+1) v
        use proposal `shouldReturn` Nothing

  describe "A preprepare message" $ do
    it "sets the current proposal in response a preprepare message" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        curView <- use view
        let hsh = blockHash blk
        omsgs <- sendMessages [IMsg auth $ Preprepare curView blk]
        map oMessage omsgs `shouldBe` [Prepare curView hsh]
        use proposal `shouldReturn` Just blk

    it "rejects an unauthenticated preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        authenticator .= const False
        curView <- use view
        sendMessages [IMsg auth $ Preprepare curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-proposer" $ property $ \auth blk addr ->
      runTest $ do
        proposer .= addr
        validators .= [sender auth, addr]
        curView <- use view
        sendMessages [IMsg auth $ Preprepare curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-validator" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= []
        curView <- use view
        sendMessages [IMsg auth $ Preprepare curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "round-changes an old preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= [sender auth]
        curView <- use view
        got <- sendMessages [IMsg auth $ Preprepare curView{_round = 3} blk]
        map (_round . roundchangeView . oMessage) got `shouldBe` [21]

  describe "A prepare message" $ do
    it "sets the prepared state of a validator" $ property $ \auth blk ->
      runTest $ do
        me <- selfAddr
        (curView, di) <- setupRound blk [sender auth]
        -- Only one validator, so that should be a majority
        omsgs <- sendMessages [IMsg auth $ Prepare curView di]
        let [Commit v di' seal] = map oMessage omsgs
        (v, di') `shouldBe` (curView, di)
        seal `shouldSatisfy` (== Just me) . verifyCommitmentSeal di

        use prepared `shouldReturn` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= [sender auth]
        curView <- use view
        sendMessages [IMsg auth $ Prepare curView di] `shouldReturn` []
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "waits until there is more than 2/3s prepares to commit" $ property $ \sig a1 a2 a3 blk ->
      runTest $ do
        (curView, di) <- setupRound blk [a1, a2, a3]
        let upgrade a = IMsg (MsgAuth a sig) $ Prepare curView di
        sendMessages (map upgrade [a1, a2]) `shouldReturn` []
        sendMessages [upgrade a2] `shouldReturn` []
        omsgs <- sendMessages [upgrade a3]
        let [Commit v d s] = map oMessage omsgs
        (v, d) `shouldBe` (curView, di)
        me <- selfAddr
        s `shouldSatisfy` (== Just me) . verifyCommitmentSeal di
        use prepared `shouldReturn` M.fromList [(a1, di), (a2, di), (a3, di)]

    it "only sends one commit message" $ property $ \sig as blk ->
      runTest $ do
        (curView, di) <- setupRound blk as
        let input = map (\a -> IMsg (MsgAuth a sig) $ Prepare  curView di) as
        got <- sendMessages input
        got `shouldSatisfy` (== min (length as) 1) . length

  describe "A commit message" $ do
    it "returns a ready block" $ property $ \auth blk' seal ->
      runTest $ do
        let blk = addProposerSeal seal . addValidators [sender auth] $ blk'
        validators .= [sender auth]
        proposal .= Just blk
        curView <- use view
        let di = blockHash blk
        omsgs <- sendMessages [IMsg auth $ Commit curView di seal]
        let [ToCommit b] = omsgs
        b `compareNoExtra` blk
        let got = cookRawExtra . L.view extraLens $ b
            want = ExtraData
                      (BS.take 32 . L.view extraLens $ blk)
                      (Just $ IstanbulExtra [sender auth] (Just seal) [seal])
        got `shouldBe` want
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use view `shouldReturn` curView
    it "won't trigger a commit with a hash mismatch" $ property $ \auth di blk seal ->
      runTest $ do
        (curView, _) <- setupRound blk [sender auth]
        sendMessages [IMsg auth $ Commit curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use view `shouldReturn` curView
    it "won't trigger a commit without a block" $ property $ \auth di seal ->
      runTest $ do
        validators .= [sender auth]
        curView <- use view
        sendMessages [IMsg auth $ Commit curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use view `shouldReturn` curView
    it "rejects a message from a non-validator" $ property $ \auth blk seal ->
      runTest $ do
        (curView, di) <- setupRound blk []
        sendMessages [IMsg auth $ Commit curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use view `shouldReturn` curView
    it "rejects a message from an unauthenticated peer" $ property $ \auth blk seal ->
      runTest $ do
        (curView, di) <- setupRound blk [sender auth]
        authenticator .= const False
        sendMessages [IMsg auth $ Commit curView di seal] `shouldReturn` []
        use committed `shouldReturn` M.empty
        use view `shouldReturn` curView

    it "waits for 2/3s of commits" $ property $ \sig blk' as seal ->
      runTest $ do
        let blk = addProposerSeal seal . addValidators as $ blk'
        validators .= as
        proposal .= Just blk
        curView <- use view
        let di = blockHash blk
        let count =  2 * length as `div` 3
            (front, back) = splitAt count as
            toCommit a = IMsg (MsgAuth a sig) $ Commit curView di seal
            earlyCommits = map toCommit front
            tippingPoint = map toCommit . take 1 $ back
        sendMessages earlyCommits `shouldReturn` []
        use committed `shouldReturn` M.fromList (map (, (di, seal)) front)
        use view `shouldReturn` curView
        unless (null as) $ do
          omsgs <- sendMessages tippingPoint
          let [ToCommit b] = omsgs
          b `compareNoExtra` blk
          let got = cookRawExtra . L.view extraLens $ b
          _vanity got `shouldBe` (BS.take 32 . L.view extraLens $ blk)
          let Just ist = _istanbul got
          _validatorList ist `shouldBe` sort as
          _proposedSig ist `shouldBe` Just seal
          _commitment ist `shouldSatisfy` (== count+1) . length
          finalHash b `shouldBe` di

  describe "A round change message" $ do
    it "stores the maximum round seen from round-changes" $ property $ \blk a1 a2 a3 ->
      runTest $ do
        (curView, _) <- setupRound blk . map sender $ [a1, a2, a3]
        next <- uses view (over round (+4))
        let roundNext = _round next
        sendMessages [IMsg a1 $ RoundChange next] `shouldReturn` []
        -- 1 vote is not enough
        use pendingRound `shouldReturn` Nothing
        use roundChanged `shouldReturn` M.singleton (sender a1) roundNext
        use view `shouldReturn` curView
        -- 2 votes will be broadcast, but not taken up.
        omsgs <- sendMessages [IMsg a2 $ RoundChange next]
        map oMessage omsgs `shouldBe` [RoundChange next]
        use pendingRound `shouldReturn` Just roundNext
        use roundChanged `shouldReturn` M.fromList [(sender a1, roundNext), (sender a2, roundNext)]
        use view `shouldReturn` curView
        -- 3 votes will do it
        sendMessages [IMsg a3 $ RoundChange next] `shouldReturn` []
        use pendingRound `shouldReturn` Nothing
        use roundChanged `shouldReturn` M.empty
        use view `shouldReturn` next
    it "Round changes are idempotent" $ property $ \blk a ->
      runTest $ do
        _ <- setupRound blk [sender a]
        next <- uses view (over round (+1))
        _ <- sendMessages [IMsg a $ RoundChange next]
        use view `shouldReturn` next
        sendMessages [IMsg a $ RoundChange next] `shouldReturn` []
        use view `shouldReturn` next

  describe "A new block message" $ do
    it "seals the block" $ property $ \blk'' ->
      runTest $ do
        let blk = over extraLens (BS.take 32) blk''
        me <- selfAddr
        validators .= [me]
        proposer .= me
        v <- use view
        omsgs <- sendMessages [NewBlock blk]
        let [Preprepare v' blk'] = map oMessage omsgs
        v' `shouldBe` v
        let initData = L.view extraLens blk
        set extraLens initData blk' `shouldBe` blk
        blk' `shouldNotBe` blk
        let parsedExtra = cookRawExtra . L.view extraLens $ blk'
        L.view vanity parsedExtra `shouldBe` initData
        let Just ist = _istanbul parsedExtra
        L.view validatorList ist `shouldBe` [me]
        L.view commitment ist `shouldBe` []
        L.view proposedSig ist `shouldSatisfy`
          (== Just me) . (>>= verifyProposerSeal blk')
