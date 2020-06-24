{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module StateMachineSpec where

import Test.Hspec (Spec, describe, it, parallel)
import Test.Hspec.Expectations.Lifted
import Test.QuickCheck

import           Control.Lens               hiding (view)
import qualified Control.Lens               as L
import           Control.Monad              hiding (sequence)
import           Control.Monad.IO.Class
import           Blockchain.Output
import           Control.Monad.Trans.State
import qualified Data.ByteString            as BS
import qualified Data.ByteString.Base16     as B16
import qualified Data.ByteString.Char8      as C8
import           Data.List
import qualified Data.Map                   as M
import           Data.Maybe
import qualified Data.Set                   as S
import           Data.Word
import           Prelude                    hiding (round, sequence)

import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.Block
import Blockchain.Data.BlockDB
import Blockchain.ECDSA
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.BenchmarkLib
import Blockchain.Blockstanbul.EventLoop
import qualified Blockchain.Blockstanbul.HTTPAdmin as HA
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256



myPriv :: PrivateKey
myPriv = fromMaybe (error "could not import private key") (importPrivateKey (fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))


testContext :: BlockstanbulContext
testContext = newContext (Checkpoint (View 20 18) M.empty [] []) (fromPrivateKey myPriv)


runTest :: StateT BlockstanbulContext (LoggingT IO) () -> IO ()
runTest = runAuthTest . (disableAuth >>)

runAuthTest :: StateT BlockstanbulContext (LoggingT IO) () -> IO ()
runAuthTest = runNoLoggingT . flip evalStateT testContext

instance (Monad m) => HasBlockstanbulContext (StateT BlockstanbulContext m) where
  putBlockstanbulContext = put
  getBlockstanbulContext = Just <$> get

instance (Monad m) => Signs (StateT BlockstanbulContext m) where
  sign bs = return $ signMsg myPriv bs 

disableAuth :: StateMachineM m => m ()
disableAuth = productionAuth .= False

setupRound :: (StateMachineM m) => Block -> [Address] -> m (View, Keccak256)
setupRound blk' as = do
  let blk = truncateExtra blk'
  proposal .= Just blk
  validators .= S.fromList as
  v <- use view
  let di = blockHash blk
  return (v, di)

compareNoExtra :: (MonadIO m) => Block -> Block -> m ()
compareNoExtra b1 b2 = set extraLens "" b1 `shouldBe` set extraLens "" b2

vanityCompare :: (MonadIO m) => BS.ByteString -> BS.ByteString -> m ()
vanityCompare lhs rhs =
  let clean = BS.takeWhile (/=0) . BS.take 32
  in clean lhs `shouldBe` clean rhs

spec :: Spec
spec = parallel $ do
  describe "The blockstanbul event loop" $ do
    it "requests a round changes round in response to a timeout or insertion failure" $
      runTest $ do
        got <- sendMessages [Timeout 20, CommitResult (Left  "invalid hash")]
        map (_round . roundchangeView . oMessage) got `shouldBe` [21, 21]

    it "ignores stale timeouts" .  runTest $
      sendMessages [Timeout 10] `shouldReturn` []
    it "sets the pending round after a timeout" $ property $ \a1 a2 ->
      runTest $ do
      validators .= S.fromList [a1, a2]
      _ <- sendMessages [Timeout 20]
      use pendingRound `shouldReturn` Just 21

    it "can handle several rounds in succession" $ withMaxSuccess 10 $ property $ \blk'' blk2'' as' seal ->
      not (null as') ==> runTest $ do
        let as = nubBy (\l r -> sender l == sender r) . sortOn sender $ as'
            -- The nonce is set to avoid voting out the sole validator
            setNonce :: Block -> Block
            setNonce blk = blk{blockBlockData = (blockBlockData blk){blockDataNonce = 0x24444}}
        let (blk', blk2') = over both ( addProposerSeal seal
                                      . addValidators (S.fromList $ map sender as)
                                      . truncateExtra
                                      . setNonce)
                           (blk'', blk2'')
            blk = setBlockNo 19 blk'
        validators .= S.fromList (map sender as)
        v <- use view
        let hsh = blockHash blk
        -- (v, hsh) <- setupRound blk . map sender $ as
        let ppr = as !! ((fromIntegral . _round $ v) `mod` length as)
        proposer .= sender ppr
        omsgs1 <- sendMessages [IMsg ppr $ Preprepare v blk]
        map oMessage omsgs1 `shouldBe` [Prepare v hsh]
        let preps = map (\a -> IMsg a $ Prepare v hsh) as
        omsgs2 <- sendMessages preps
        let [Commit v' hsh' seal'] = map oMessage omsgs2
        (v', hsh') `shouldBe` (v, hsh)
        me <- use selfAddr
        seal' `shouldSatisfy` (== Just me) . verifyCommitmentSeal hsh
        let coms = map (\a -> IMsg a $ Commit v hsh seal) as
        xsp <- sendMessages coms
        let [ToCommit comBlock] = xsp
            n = length as
            sealCount = n - floor (fromIntegral (n - 1) / 3 :: Double)
        truncateExtra comBlock `shouldBe` truncateExtra blk
        (comBlock ^. extraLens ^. to cookRawExtra ^. istanbul) `shouldBe`
          Just IstanbulExtra { _validatorList = sort (map sender as)
                             , _proposedSig = Just seal
                             , _commitment = replicate sealCount seal
                             }

        -- Pretend that in this interval, the block was committed
        sendMessages [CommitResult (Right (blockHash blk))] `shouldReturn`
          [ NewCheckpoint (Checkpoint (over sequence (+1) v) M.empty (map sender as) []) ]
        -- The proposer *shouldn't* change, because the round number is the same
        let nextPpr = as !! ((1 + fromIntegral (_round v)) `mod` length as)
        use proposer `shouldReturn` sender ppr
        v2 <- use view
        v2 `shouldBe` over sequence (+1) v
        let blk2 = blk2'{blockBlockData = (blockBlockData blk2'){
                          blockDataNumber = 20,
                          blockDataParentHash = hsh}}
        let hsh2 = blockHash blk2
        omsgs3 <- sendMessages [IMsg nextPpr $ Preprepare v2 blk2, IMsg ppr $ Preprepare v2 blk2]
        map oMessage omsgs3 `shouldMatchList`
            if sender ppr == sender nextPpr
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
        omsgs5' <- sendMessages aborts
        let omsgs5 = [o | o@(OMsg _ _) <- omsgs5']
            rest5 = omsgs5' \\ omsgs5
        oMessage (head omsgs5) `shouldBe` RoundChange next
        rest5 `shouldBe` [ResetTimer 21, NewCheckpoint $ Checkpoint next M.empty (map sender as) []]
        use view `shouldReturn` over round (+1) v2
        use proposer `shouldReturn` sender nextPpr

    it "increments sequence number" $ property $ \blk as seal ->
      not (null as) ==> runTest $ do
        (v, hsh) <- setupRound blk . map sender $ as
        let ppr = as !! ((fromIntegral . _round $ v) `mod` length as)
        void $ sendMessages $ [IMsg ppr $ Preprepare v blk]
                           ++ [IMsg a $ Prepare v hsh | a <- as]
                           ++ [IMsg a $ Commit v hsh seal | a <- as]
                           ++ [CommitResult (Right (blockHash blk))]
        use view `shouldReturn` over sequence (+1) v
        use proposal `shouldReturn` Nothing

  describe "A preprepare message" $ do
    it "sets the current proposal in response a preprepare message" $ property $ \auth blk' ->
      runTest $ do
        let blk = truncateExtra . setBlockNo 19 $ blk'
        proposer .= sender auth
        validators .= S.fromList [sender auth]
        blockWithVs <- uses validators $ flip addValidators blk
        pseal <- proposerSeal blockWithVs
        let sealedBlk = addProposerSeal pseal blockWithVs
        curView <- use view
        let hsh = blockHash sealedBlk
        omsgs <- sendMessages [IMsg auth $ Preprepare curView sealedBlk]
        map oMessage omsgs `shouldBe` [Prepare curView hsh]
        use proposal `shouldReturn` Just sealedBlk

    it "rejects an unauthenticated preprepare" $ property $ \auth blk ->
      runTest $ do
        productionAuth .= True
        proposer .= sender auth
        validators .= S.fromList [sender auth]
        curView <- use view
        sendMessages [IMsg auth $ Preprepare curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-proposer" $ property $ \auth blk addr ->
      (sender auth /= addr) ==> runTest $ do
        proposer .= addr
        validators .= S.fromList [sender auth, addr]
        curView <- use view
        sendMessages [IMsg auth $ Preprepare curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "rejects a preprepare from a non-validator" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= S.empty
        curView <- use view
        sendMessages [IMsg auth $ Preprepare curView blk] `shouldReturn` []
        use proposal `shouldReturn` Nothing

    it "round-changes an old preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= S.fromList [sender auth]
        curView <- use view
        got <- sendMessages [IMsg auth $ Preprepare curView{_round = 3} blk]
        map (_round . roundchangeView . oMessage) got `shouldBe` [21]

    it "round-changes and finds a gap from a future preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= S.fromList [sender auth]
        got <- sendMessages [IMsg auth $ Preprepare (View 347 400000) blk]
        let omsgs = [o | o@(OMsg _ _) <- got]
            other = got \\ omsgs
        map (_round . roundchangeView . oMessage) omsgs `shouldBe` [21]
        other `shouldMatchList` [GapFound 18 400000 (sender auth)]

    it "round-changes and announces a lead from a past preprepare" $ property $ \auth blk ->
      runTest $ do
        proposer .= sender auth
        validators .= S.fromList [sender auth]
        got <- sendMessages [IMsg auth $ Preprepare (View 347 2) blk]
        let omsgs = [o | o@OMsg{} <- got]
            other = got \\ omsgs
        map (_round . roundchangeView . oMessage) omsgs `shouldBe` [21]
        other `shouldMatchList` [LeadFound 18 2 (sender auth)]


  describe "A prepare message" $ do
    it "sets the prepared state of a validator" $ property $ \auth blk ->
      runTest $ do
        me <- use selfAddr
        (curView, di) <- setupRound blk [sender auth]
        -- Only one validator, so that should be a majority
        omsgs <- sendMessages [IMsg auth $ Prepare curView di]
        let [Commit v di' seal] = map oMessage omsgs
        (v, di') `shouldBe` (curView, di)
        seal `shouldSatisfy` (== Just me) . verifyCommitmentSeal di

        use prepared `shouldReturn` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= S.fromList [sender auth]
        curView <- use view
        sendMessages [IMsg auth $ Prepare curView di] `shouldReturn` []
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "waits until there is more than 2/3s prepares to commit" $ property $ \sig a1 a2 a3 blk ->
      (S.size (S.fromList [a1, a2, a3]) == 3) ==> runTest $ do
        (curView, di) <- setupRound blk [a1, a2, a3]
        let upgrade a = IMsg (MsgAuth a sig) $ Prepare curView di
        sendMessages (map upgrade [a1, a2]) `shouldReturn` []
        sendMessages [upgrade a2] `shouldReturn` []
        omsgs <- sendMessages [upgrade a3]
        let [Commit v d s] = map oMessage omsgs
        (v, d) `shouldBe` (curView, di)
        me <- use selfAddr
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
        let blk = addProposerSeal seal . addValidators (S.fromList [sender auth]) $ blk'
        validators .= S.fromList [sender auth]
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
        validators .= S.fromList [sender auth]
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
        productionAuth .= True
        (curView, di) <- setupRound blk [sender auth]
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
            (front, back) = splitAt count . S.toList $ as
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
          _vanity got `vanityCompare` L.view extraLens (blk)
          let Just ist = _istanbul got
          _validatorList ist `shouldBe` S.toList as
          _proposedSig ist `shouldBe` Just seal
          _commitment ist `shouldSatisfy` (== count+1) . length
          finalHash b `shouldBe` di

  describe "A round change message" $ do
    it "stores the maximum round seen from round-changes" $ property $ \blk a1 a2 a3 ->
      (S.size (S.fromList $ map sender [a1, a2, a3]) == 3) ==> runTest $ do
        (curView, _) <- setupRound blk . map sender $ [a1, a2, a3]
        next <- uses view (over round (+4))
        let roundNext = _round next
        sendMessages [IMsg a1 $ RoundChange next] `shouldReturn` [OMsg a1 $ RoundChange next]
        -- 1 vote is not enough
        use pendingRound `shouldReturn` Nothing
        use roundChanged `shouldReturn` M.singleton roundNext (S.singleton (sender a1))
        use view `shouldReturn` curView
        -- 2 votes will be broadcast, but not taken up.
        omsgs <- sendMessages [IMsg a2 $ RoundChange next]
        map oMessage omsgs `shouldBe` [RoundChange next, RoundChange next]
        use pendingRound `shouldReturn` Just roundNext
        use roundChanged `shouldReturn` M.singleton roundNext (S.fromList [sender a1, sender a2])
        use view `shouldReturn` curView
        -- 3 votes will do it
        sendMessages [IMsg a3 $ RoundChange next] `shouldReturn`
          [ ResetTimer 24
          , NewCheckpoint (Checkpoint next M.empty (sort $ map sender [a1, a2, a3]) [])
          , OMsg a3 $ RoundChange next
          ]
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

    it "Remembers round changes from the future" $ property $ \blk s1 s2 s3 ->
      let [a1, a2, a3] = zipWith MsgAuth [1..] [s1, s2, s3]
      in runTest $ do
        _ <- setupRound blk [sender a1, sender a2, sender a3]
        now <- use view
        next <- uses view (over round (+1))
        nextnext <- uses view (over round (+2))
        _ <- sendMessages [IMsg a2 $ RoundChange nextnext, IMsg a2 $ RoundChange next]
        use view `shouldReturn` now
        _ <- sendMessages [IMsg a1 $ RoundChange next, IMsg a3 $ RoundChange next]
        use view `shouldReturn` next
        _ <- sendMessages [IMsg a1 $ RoundChange nextnext, IMsg a3 $ RoundChange nextnext]
        use view `shouldReturn` nextnext

  describe "An UnannouncedBlock message" $ do
    let selfElected = do
          me <- use selfAddr
          proposer .= me
          validators .= S.singleton me

    it "requires a matching block number" $ property $ \blk' ->
      runTest $ do
        let blk = over extraLens (BS.take 32) . setBlockNo 17 $ blk'
        selfElected
        sendMessages [UnannouncedBlock blk] `shouldReturn` [MakeBlockCommand]

    it "requires a matching hash if known" $ property $ \blk' ->
      runTest $ do
        let blk = over extraLens (BS.take 32) . setBlockNo 19 $ blk'
        selfElected
        lastParent .= Just (unsafeCreateKeccak256FromWord256 0x999992)
        sendMessages [UnannouncedBlock blk] `shouldReturn` [MakeBlockCommand]

    it "accepts a block if the parent hash matches" $ property $ \blk' ->
      runTest $ do
        let blk = over extraLens (BS.take 32)
                    blk'{blockBlockData = (blockBlockData blk'){
                      blockDataNumber = 19,
                      blockDataParentHash = unsafeCreateKeccak256FromWord256 0x999992}}
        selfElected
        lastParent .= Just (unsafeCreateKeccak256FromWord256 0x999992)
        sendMessages [UnannouncedBlock blk] `shouldNotReturn` [MakeBlockCommand]

    it "seals the block" $ property $ \blk'' ->
      runTest $ do
        let blk = over extraLens (const $ BS.pack [0, 0, 0]) . setBlockNo 19 $ blk''
        selfElected
        v <- use view
        omsgs <- sendMessages [UnannouncedBlock blk]
        let [Preprepare v' blk'] = map oMessage omsgs
        v' `shouldBe` v
        let initData = L.view extraLens blk
        set extraLens initData blk' `shouldBe` blk
        blk' `shouldNotBe` blk
        let parsedExtra = cookRawExtra . L.view extraLens $ blk'
        L.view vanity parsedExtra `vanityCompare` initData
        let Just ist = _istanbul parsedExtra
        me <- use selfAddr
        L.view validatorList ist `shouldBe` [me]
        L.view commitment ist `shouldBe` []
        L.view proposedSig ist `shouldSatisfy`
          (== Just me) . (>>= verifyProposerSeal blk')

  describe "Block locks" $ do
    it "takes priority over UnannouncedBlocks" $ property $ \lock' blk ->
      runTest $ do
        let lock = setBlockNo 19 lock'
        me <- use selfAddr
        validators .= S.singleton me
        proposer .= me
        blockLock .= Just lock
        omsgs <- sendMessages [UnannouncedBlock blk]
        let [Preprepare v' blk'] = map oMessage omsgs
        blk' `shouldBe` lock
        v <- use view
        v' `shouldBe` v

    it "round changes a preprepare that doesn't match the lock" $ property $ \lock blk a ->
      runTest $ do
        validators .= S.fromList [sender a]
        proposer .= sender a
        blockLock .= Just lock
        v <- use view
        omsgs <- sendMessages [IMsg a $ Preprepare v blk]
        next <- uses view (over round (+1))
        map oMessage omsgs `shouldBe` [RoundChange next]

    it "Resets the lock after a commit result -- positive or negative" $ property $ \blk as ->
      runTest $ do
        me <- use selfAddr
        validators .= S.fromList (me:as)
        blockLock .= Just blk
        _ <- sendMessages [CommitResult (Left "oops")]
        use blockLock `shouldReturn` Nothing

        blockLock .= Just blk
        _ <- sendMessages [CommitResult (Right (blockHash blk))]
        use blockLock `shouldReturn` Nothing
        use lastParent `shouldReturn` Just (blockHash blk)

    it "Sets a lock after prepare consensus is reached" $ property $ \auth blk ->
      runTest $ do
        (curView, di) <- setupRound blk [sender auth]
        _ <- sendMessages [IMsg auth $ Prepare curView di]
        use blockLock `shouldReturn` Just blk

    let setBlock blk = do
          me <- use selfAddr
          validators .= S.singleton me
          proposal .= Just blk
          blockLock .= Just blk

    it "requests a new block after success" $ property $ \blk ->
      runTest $ do
        setBlock blk
        me <- use selfAddr
        sendMessages [CommitResult (Right (blockHash blk))] `shouldReturn`
          [MakeBlockCommand
          , NewCheckpoint (Checkpoint (View 20 19) M.empty [me] [])]

    it "re-issues the lock after round change" $ property $ \blk sig ->
      runTest $ do
        setBlock blk
        me <- use selfAddr
        roundPlus1 <- uses view (over round (+1))
        let roundAndSequencePlus1 = over sequence (+1) roundPlus1
        resp <- sendMessages [IMsg (MsgAuth me sig) $ RoundChange roundAndSequencePlus1]
        let omsgs = [o | o@(OMsg _ _) <- resp]
            other = resp \\ omsgs
        map oMessage omsgs `shouldBe` [ RoundChange roundAndSequencePlus1
                                      , Preprepare roundPlus1 blk
                                      , RoundChange roundAndSequencePlus1
                                      ]
        other `shouldBe`
          [ResetTimer $ _round roundPlus1
          , NewCheckpoint (Checkpoint roundPlus1 M.empty [me] [])]

  describe "Authentication" $ do
    let resendLock :: Block -> PrivateKey
                   -> StateT BlockstanbulContext (LoggingT IO) (Block, [OutEvent])
        resendLock blk theirPK = do
          v <- use view
          me <- use selfAddr
          let them = fromPrivateKey theirPK
              vals = S.fromList [me, them]
              blk' = addValidators vals . truncateExtra . setBlockNo 19 $ blk
          validators .= vals
          proposer .= me
          pSeal <- proposerSeal blk'
          let lockBlk = addProposerSeal pSeal blk'
          (OMsg auth wm) <- signMessage $ Preprepare v lockBlk

          lockSender .= Just them
          blockLock .= Just lockBlk
          omsgs <- sendMessages [IMsg auth wm]

          return (lockBlk, omsgs)

    it "accepts a block if the signer is the original sender" $ property $ \blk ->
      runAuthTest $ do
        v <- use view
        (lockBlk, omsgs) <- resendLock blk myPriv
        map oMessage omsgs `shouldBe` [Prepare v (blockHash lockBlk)]

    it "accepts a block if the signer is not the original sender" $ property $ \blk ->
      runAuthTest $ do
        theirPK <- liftIO newPrivateKey
        v <- use view
        (lockBlk, omsgs) <- resendLock blk theirPK
        map oMessage omsgs `shouldBe` [Prepare v (blockHash lockBlk)]

  describe "A NewBeneficiary" $ do
    it "yields a vote" $ property $ \auth -> runTest $ do
      me <- use selfAddr
      sendMessages [NewBeneficiary auth (0xdeadbeef, True, 40)] `shouldReturn`
        [PendingVote 0xdeadbeef True me, VoteResponse HA.Enqueued]

    it "rejects a badly signed vote" $ property $ \auth -> runAuthTest $ do
      let vote = NewBeneficiary auth (0xdeadbeef, True, 30)
      resp <- sendMessages [vote]
      let [VoteResponse (HA.Rejected msg)] = resp
      msg `shouldStartWith` "Rejecting NewBeneficiary"

  describe "PreviousBlock" $ do
    let selfSignBlock :: Word64 -> Address -> Integer -> PrivateKey -> [PrivateKey]
                      -> StateT BlockstanbulContext (LoggingT IO) Block
        selfSignBlock nonc cb num proper committers = do
          let blk0 = votingBlock
              blk1 = blk0{blockBlockData = (blockBlockData blk0)
                            { blockDataCoinbase = cb
                            , blockDataNonce = nonc
                            , blockDataNumber = num
                            }}
          let commitAddresses = S.fromList $ map fromPrivateKey committers
          vals <- use validators
          S.toList vals `shouldContain` S.toList commitAddresses
          let blk2 = addValidators vals
                   . truncateExtra
                   $ blk1
              -- These pure versions of proposerSeal and commitmentSeal are so
              -- that we can sign with arbitrary keys, unlike in prod
              pureProposerSeal blk = signMsg proper $ proposalMessage blk
              pureCommitmentSeal hsh pk = signMsg pk $ commitmentMessage hsh
              pSeal = pureProposerSeal blk2
          let blk3 = addProposerSeal pSeal blk2
              cSeals = map (pureCommitmentSeal (blockHash blk3)) committers
          return $ addCommitmentSeals cSeals blk3

        votingBlock :: Block
        votingBlock = makeBlock 3 3

        genKeys :: MonadIO m => Int -> m [PrivateKey]
        genKeys n = liftIO $ replicateM n $ newPrivateKey

        checkedSend :: Block -> StateT BlockstanbulContext (LoggingT IO) ()
        checkedSend blk = do
          sendMessages [PreviousBlock blk] `shouldReturn` [ToCommit blk]
          void $ sendMessages [CommitResult . Right $ blockHash blk]

    it "will accept a previous block with the current sequence number" $ runTest $ do
      me <- use selfAddr
      validators .= S.singleton me
      checkedSend =<< selfSignBlock 6 0x0ddba11 19 myPriv [myPriv]
      use validators `shouldReturn` S.singleton me

    it "will reject a previous block in the future" $ runTest $ do
      me <- use selfAddr
      validators .= S.singleton me
      blk <- selfSignBlock 6 0xdeadbeef 20 myPriv [myPriv]
      sendMessages [PreviousBlock blk] `shouldReturn` []
      use validators `shouldReturn` S.singleton me

    it "updates validators from a historic block" $ runTest $ do
      me <- use selfAddr
      validators .= S.singleton me
      checkedSend =<< selfSignBlock maxBound 0xdeadbeef 19 myPriv [myPriv]
      use validators `shouldReturn` S.fromList [me, 0xdeadbeef]

    it "does not update validators from a rejected historic block" $ runTest $ do
      me <- use selfAddr
      validators .= S.singleton me
      blk <- selfSignBlock maxBound 0xdeadbeef 20 myPriv [myPriv]

      sendMessages [PreviousBlock blk] `shouldReturn` []
      use validators `shouldReturn` S.singleton me

    it "requires 3 votes with four validators" . runTest $ do
      prvKeys@[key1, key2, key3, key4] <- genKeys 4
      let valSet = S.fromList $ map fromPrivateKey prvKeys
      validators .= valSet
      let sgn n pk = selfSignBlock maxBound 0x6643 n pk prvKeys
      checkedSend =<< sgn 19 key1
      checkedSend =<< sgn 20 key2
      use validators `shouldReturn` valSet
      checkedSend =<< sgn 21 key3
      use validators `shouldReturn` S.insert 0x6643 valSet
      checkedSend =<< sgn 22 key4
      use validators `shouldReturn` S.insert 0x6643 valSet

    it "can interleave votes for two different candidates" . runTest $ do
      prvKeys@[key1, key2] <- genKeys 2
      let valSet = S.fromList $ map fromPrivateKey prvKeys
      validators .= valSet

      [key3, key4] <- genKeys 2
      let (cand3, cand4) = (fromPrivateKey key3, fromPrivateKey key4)

      -- Key1 Votes for Key3
      checkedSend =<< selfSignBlock maxBound cand3 19 key1 [key1, key2]
      use validators `shouldReturn` valSet

      -- Key1 votes for Key4
      checkedSend =<< selfSignBlock maxBound cand4 20 key1 [key1, key2]
      use validators `shouldReturn` valSet

      -- Key2 votes for Key3
      checkedSend =<< selfSignBlock maxBound cand3 21 key2 [key1, key2]
      use validators `shouldReturn` S.insert cand3 valSet

      -- Key2 votes for Key4
      checkedSend =<< selfSignBlock maxBound cand4 22 key2 [key1, key2, key3]
      -- Vote is no longer enough, 3 votes needed with 3 validators
      use validators `shouldReturn` S.insert cand3 valSet

      -- Key3 votes for Key4
      checkedSend =<< selfSignBlock maxBound cand4 23 key3 [key1, key2, key3]
      use validators `shouldReturn` S.fromList (map fromPrivateKey [key1, key2, key3, key4])
