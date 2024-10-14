{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module StateMachineSpec where

import Test.Hspec

spec :: Spec
spec = pure ()

{- TODO: fix
import Test.Hspec (Spec, describe, it, parallel)
import Test.Hspec.Expectations.Lifted
import Test.QuickCheck

import           Control.Lens               hiding (view)
import qualified Control.Lens               as L
import           Control.Monad              hiding (sequence)
import           Control.Monad.IO.Class
import           Control.Monad.Trans.State
import qualified Data.ByteString            as BS
import qualified Data.ByteString.Char8      as C8
import           Data.List
import qualified Data.Map                   as M
import           Data.Maybe
import qualified Data.Set                   as S
import           Data.Word
import           Prelude                    hiding (round, sequence)

import BlockApps.Logging
import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Blockstanbul.Authentication
import Blockchain.Blockstanbul.BenchmarkLib
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages
import Blockchain.Blockstanbul.StateMachine
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1

import qualified LabeledError

myPriv :: PrivateKey
myPriv = fromMaybe (error "could not import private key") (importPrivateKey (LabeledError.b16Decode "myPriv" $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"))

testContext :: BlockstanbulContext
testContext = newContext (Checkpoint (View 20 18) M.empty [] []) Nothing True (Just $ fromPrivateKey myPriv)

runTest :: StateT BlockstanbulContext (LoggingT IO) () -> IO ()
runTest = runAuthTest . (disableAuth >>)

runAuthTest :: StateT BlockstanbulContext (LoggingT IO) () -> IO ()
runAuthTest = runNoLoggingT . flip evalStateT testContext

instance (Monad m) => HasBlockstanbulContext (StateT BlockstanbulContext m) where
  putBlockstanbulContext = put
  getBlockstanbulContext = Just <$> get

instance (Monad m) => HasVault (StateT BlockstanbulContext m) where
  sign bs = return $ signMsg myPriv bs
  getPub = error "called getPub, but this should never happen"
  getShared _ = error "called getShared, but this should never happen"

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

io :: InEvent -> OutEvent
io (IMsg a msg) = OMsg a msg
io x = error $ "io: " ++ show x

mkRoundChange :: View -> TrustedMessage
mkRoundChange vn = RoundChange vn 0xdeadbeef

spec :: Spec
spec = parallel $ do
  describe "The blockstanbul event loop" $ do
    it "requests a round changes round in response to a timeout or insertion failure" $
      runTest $ do
        got <- sendMessages [Timeout 20]
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
        let (blk', blk2') = over both ( addProposerSeal seal
                                      . addValidators (S.fromList $ map sender as)
                                      . truncateExtra)
                           (blk'', blk2'')
            blk = setBlockNo 19 blk'
        validators .= S.fromList (map sender as)
        v <- use view
        let hsh = blockHash blk
        -- (v, hsh) <- setupRound blk . map sender $ as
        let ppr = as !! ((fromIntegral . _round $ v) `mod` length as)
        proposer .= sender ppr
        omsgs1 <- sendMessages [IMsg ppr $ Preprepare v blk]
        map oMessage omsgs1 `shouldBe` [Preprepare v blk, Prepare v hsh]
        let preps = map (\a -> IMsg a $ Prepare v hsh) as
        omsgs2 <- sendMessages preps
        let [(v', hsh', seal')] = [(k, l, m) | Commit k l m <- map oMessage omsgs2]
        ( v', hsh') `shouldBe` (v, hsh)
        me <- use selfCert
        seal' `shouldSatisfy` (== Just me) . verifyCommitmentSeal hsh
        let coms = map (\a -> IMsg a $ Commit v hsh seal) as
        xsp <- sendMessages coms
        let [comBlock] = [cb | ToCommit cb <- xsp]
            n = length as
            sealCount = n - floor (fromIntegral (n - 1) / 3 :: Double)
        truncateExtra comBlock `shouldBe` truncateExtra blk
        (comBlock ^. extraLens ^. to cookRawExtra ^. istanbul) `shouldBe`
          Just IstanbulExtra { _validatorList = sort (map sender as)
                             , _proposedSig = Just seal
                             , _commitment = replicate sealCount seal
                             }

        -- Pretend that in this interval, the block was committed
        -- [ NewCheckpoint (Checkpoint (over sequence (+1) v) M.empty (map sender as) []) ]
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
        let pps = [(k, l) | Prepare k l <- map oMessage omsgs3]
        pps `shouldMatchList`
           if sender ppr == sender nextPpr
             then [(v2, hsh2), (v2, hsh2)]
             else [(v2, hsh2)]
        -- Old prepares are now ignored
        sendMessages preps `shouldReturn` []
        let preps2 = map (\a -> IMsg a $ Prepare v2 hsh2) as
        omsgs4 <- sendMessages preps2
        let [(v2', hsh2', seal2')] = [(k, l, m) | Commit k l m <- map oMessage omsgs4]
        (v2', hsh2') `shouldBe` (v2, hsh2)
        seal2' `shouldSatisfy` (== Just me) . verifyCommitmentSeal hsh2
        -- Old commits are now ignored
        sendMessages coms `shouldReturn` []
        use view `shouldReturn` v2
        -- Lets abort this round
        next <- uses view (over round (+1))
        let aborts = map (\a -> IMsg a $ mkRoundChange next) as
        omsgs5' <- sendMessages aborts
        let omsgs5 = [o | o@(OMsg _ _) <- omsgs5']
            rest5 = omsgs5' \\ omsgs5
        roundchangeView (oMessage (head omsgs5)) `shouldBe` next
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
        let ps = [(k, l) | Prepare k l <- map oMessage omsgs]
        ps `shouldBe` [(curView, hsh)]
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
        me <- use selfCert
        (curView, di) <- setupRound blk [sender auth]
        -- Only one validator, so that should be a majority
        omsgs <- sendMessages [IMsg auth $ Prepare curView di]
        let [(v, di', seal)] = [(k, l, m) | Commit k l m <- map oMessage omsgs]
        (v, di') `shouldBe` (curView, di)
        seal `shouldSatisfy` (== Just me) . verifyCommitmentSeal di

        use prepared `shouldReturn` M.singleton (sender auth) di
    it "does not send a commit without a proposal" $ property $ \auth di ->
      runTest $ do
        validators .= S.fromList [sender auth]
        curView <- use view
        let i = [IMsg auth $ Prepare curView di]
            o = map io i
        sendMessages i `shouldReturn` o
        use prepared `shouldReturn` M.singleton (sender auth) di
    it "waits until there is more than 2/3s prepares to commit" $ property $ \sig a1 a2 a3 blk ->
      (S.size (S.fromList [a1, a2, a3]) == 3) ==> runTest $ do
        (curView, di) <- setupRound blk [a1, a2, a3]
        let upgrade a = IMsg (MsgAuth a sig) $ Prepare curView di
            ias = map upgrade [a1, a2]
            oas = map io ias
        sendMessages ias `shouldReturn` oas
        sendMessages [upgrade a2] `shouldReturn` []
        omsgs <- sendMessages [upgrade a3]
        let [oa, Commit v d s] = map oMessage omsgs
        oa `shouldBe` oMessage (io $ upgrade a3)
        (v, d) `shouldBe` (curView, di)
        me <- use selfCert
        s `shouldSatisfy` (== Just me) . verifyCommitmentSeal di
        use prepared `shouldReturn` M.fromList [(a1, di), (a2, di), (a3, di)]

    it "only sends one commit message" $ property $ \sig as blk ->
      (S.size (S.fromList as) == length as) ==> runTest $ do
        (curView, di) <- setupRound blk as
        let input = map (\a -> IMsg (MsgAuth a sig) $ Prepare  curView di) as
        got <- sendMessages input
        let expectedLength = if null as
                               then 0
                               else 1 + length as
        got `shouldSatisfy` (== expectedLength) . length

  describe "A commit message" $ do
    it "returns a ready block" $ property $ \auth blk' seal ->
      runTest $ do
        let blk = addProposerSeal seal . addValidators (S.fromList [sender auth]) $ blk'
        validators .= S.fromList [sender auth]
        proposal .= Just blk
        curView <- use view
        let di = blockHash blk
        omsgs <- sendMessages [IMsg auth $ Commit curView di seal]
        let [b] = [k | ToCommit k <- omsgs]
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
        let i = IMsg auth $ Commit curView di seal
        sendMessages [i] `shouldReturn` [io i]
        use committed `shouldReturn` M.singleton (sender auth) (di, seal)
        use view `shouldReturn` curView
    it "won't trigger a commit without a block" $ property $ \auth di seal ->
      runTest $ do
        validators .= S.fromList [sender auth]
        curView <- use view
        let i = IMsg auth $ Commit curView di seal
        sendMessages [i] `shouldReturn` [io i]
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
        sendMessages earlyCommits `shouldReturn` map io earlyCommits
        use committed `shouldReturn` M.fromList (map (, (di, seal)) front)
        use view `shouldReturn` curView
        unless (null as) $ do
          omsgs <- sendMessages tippingPoint
          let [b] = [k | ToCommit k <- omsgs]
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
        [OMsg a1' rc] <- sendMessages [IMsg a1 $ mkRoundChange next]
        a1' `shouldBe` a1
        roundchangeView rc `shouldBe` next
        -- 1 vote is not enough
        use pendingRound `shouldReturn` Nothing
        use roundChanged `shouldReturn` M.singleton roundNext (S.singleton (sender a1))
        use view `shouldReturn` curView
        -- 2 votes will be broadcast, but not taken up.
        omsgs <- sendMessages [IMsg a2 $ mkRoundChange next]
        map (roundchangeView . oMessage) omsgs `shouldBe` [next, next]
        use pendingRound `shouldReturn` Just roundNext
        use roundChanged `shouldReturn` M.singleton roundNext (S.fromList [sender a1, sender a2])
        use view `shouldReturn` curView
        -- 3 votes will do it
        omsgs' <- sendMessages [IMsg a3 $ mkRoundChange next]
        omsgs' !! 0 `shouldBe` ResetTimer 24
        omsgs' !! 1 `shouldBe` NewCheckpoint (Checkpoint next M.empty (sort $ map sender [a1, a2, a3]) [])
        let OMsg a3' rc' = omsgs' !! 2
        a3' `shouldBe` a3
        roundchangeView rc' `shouldBe` next
        use pendingRound `shouldReturn` Nothing
        use roundChanged `shouldReturn` M.empty
        use view `shouldReturn` next
    it "Round changes are idempotent" $ property $ \blk a ->
      runTest $ do
        _ <- setupRound blk [sender a]
        next <- uses view (over round (+1))
        _ <- sendMessages [IMsg a $ mkRoundChange next]
        use view `shouldReturn` next
        sendMessages [IMsg a $ mkRoundChange next] `shouldReturn` []
        use view `shouldReturn` next

    it "Remembers round changes from the future" $ property $ \blk s1 s2 s3 ->
      let [a1, a2, a3] = zipWith MsgAuth [1..] [s1, s2, s3]
      in runTest $ do
        _ <- setupRound blk [sender a1, sender a2, sender a3]
        now <- use view
        next <- uses view (over round (+1))
        nextnext <- uses view (over round (+2))
        _ <- sendMessages [IMsg a2 $ mkRoundChange nextnext, IMsg a2 $ mkRoundChange next]
        use view `shouldReturn` now
        _ <- sendMessages [IMsg a1 $ mkRoundChange next, IMsg a3 $ mkRoundChange next]
        use view `shouldReturn` next
        _ <- sendMessages [IMsg a1 $ mkRoundChange nextnext, IMsg a3 $ mkRoundChange nextnext]
        use view `shouldReturn` nextnext

  describe "An UnannouncedBlock message" $ do
    let selfElected = do
          me <- use selfCert
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
        me <- use selfCert
        L.view validatorList ist `shouldBe` [me]
        L.view commitment ist `shouldBe` []
        L.view proposedSig ist `shouldSatisfy`
          (== Just me) . (>>= verifyProposerSeal blk')

  describe "Block locks" $ do
    it "takes priority over UnannouncedBlocks" $ property $ \lock' blk ->
      runTest $ do
        let lock = setBlockNo 19 lock'
        me <- use selfCert
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
        map (roundchangeView . oMessage) omsgs `shouldBe` [next]

    it "Sets a lock after prepare consensus is reached" $ property $ \auth blk ->
      runTest $ do
        (curView, di) <- setupRound blk [sender auth]
        _ <- sendMessages [IMsg auth $ Prepare curView di]
        use blockLock `shouldReturn` Just blk

    let setBlock blk = do
          me <- use selfCert
          validators .= S.singleton me
          proposal .= Just blk
          blockLock .= Just blk

    it "re-issues the lock after round change" $ property $ \blk sig ->
      runTest $ do
        setBlock blk
        me <- use selfCert
        roundPlus1 <- uses view (over round (+1))
        let roundAndSequencePlus1 = over sequence (+1) roundPlus1
        resp <- sendMessages [IMsg (MsgAuth me sig) $ mkRoundChange roundAndSequencePlus1]
        let omsgs = [o | o@(OMsg _ _) <- resp]
            other = resp \\ omsgs
        roundchangeView (oMessage (omsgs !! 0)) `shouldBe` roundAndSequencePlus1
        oMessage (omsgs !! 1) `shouldBe` Preprepare roundPlus1 blk
        roundchangeView (oMessage (omsgs !! 2)) `shouldBe` roundAndSequencePlus1
        other `shouldBe`
          [ResetTimer $ _round roundPlus1
          , NewCheckpoint (Checkpoint roundPlus1 M.empty [me] [])]

  describe "Authentication" $ do
    let resendLock :: Block -> PrivateKey
                   -> StateT BlockstanbulContext (LoggingT IO) (Block, [OutEvent])
        resendLock blk theirPK = do
          v <- use view
          me <- use selfCert
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
        let ps = [(k, l) | Prepare k l <- map oMessage omsgs]
        ps `shouldBe` [(v, blockHash lockBlk)]

    it "accepts a block if the signer is not the original sender" $ property $ \blk ->
      runAuthTest $ do
        theirPK <- liftIO newPrivateKey
        v <- use view
        (lockBlk, omsgs) <- resendLock blk theirPK
        let ps = [(k, l) | Prepare k l <- map oMessage omsgs]
        ps `shouldBe` [(v, blockHash lockBlk)]

  describe "PreviousBlock" $ do
    let selfSignBlock :: Integer -> PrivateKey -> [PrivateKey]
                      -> StateT BlockstanbulContext (LoggingT IO) Block
        selfSignBlock num proper committers = do
          let blk0 = votingBlock
              blk1 = blk0{blockBlockData = (blockBlockData blk0)
                            { blockDataNumber = num
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

    it "will accept a previous block with the current sequence number" $ runTest $ do
      me <- use selfCert
      validators .= S.singleton me
      checkedSend =<< selfSignBlock 19 myPriv [myPriv]
      use validators `shouldReturn` S.singleton me

    it "will reject a previous block in the future" $ runTest $ do
      me <- use selfCert
      validators .= S.singleton me
      blk <- selfSignBlock 20 myPriv [myPriv]
      sendMessages [PreviousBlock blk] `shouldReturn` []
      use validators `shouldReturn` S.singleton me
-}
