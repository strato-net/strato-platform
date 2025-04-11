{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE ConstraintKinds     #-}
{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE PolyKinds           #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeFamilies        #-}
{-# LANGUAGE TypeOperators       #-}

module Blockchain.Event
  ( module Blockchain.EventModel,
    handleEvents,
  )
where

import           BlockApps.Logging
import           BlockApps.X509.Certificate            as XC
import           Blockchain.Blockstanbul               (WireMessage,
                                                        blockstanbulSender)
import           Blockchain.Context
import           Blockchain.Data.Block
import           Blockchain.Data.BlockHeader           (BlockHeader)
import qualified Blockchain.Data.BlockHeader           as BlockHeader
import           Blockchain.Data.Control               (P2PCNC (..))
import           Blockchain.Data.PubKey
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.Data.Wire
import           Blockchain.EventException
import           Blockchain.EventModel
import           Blockchain.HeaderCache
import           Blockchain.Model.SyncState
import           Blockchain.Model.SyncTask
import           Blockchain.Model.WrappedBlock
import           Blockchain.Options
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Address       (Address)
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.MicroTime
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.SyncDB
import           Control.Arrow                         (second, (&&&))
import           Control.Monad
import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify           hiding (awaitForever,
                                                        get, put, yield)
import qualified Control.Monad.Change.Modify           as Mod (get, put)
import           Control.Monad.IO.Class
import           Control.Monad.State
import qualified Data.ByteString.Base16                as BC16
import qualified Data.ByteString.Char8                 as BS8
import           Data.Conduit
import           Data.List                             hiding (insert, lookup)
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import qualified Data.Text                             as T
import           Data.Time.Clock
import           Debug.Trace                           (trace)
import           Prelude                               hiding (lookup)
import           Text.Format
import           Text.Printf
--import           Text.ShortDescription
import           Text.Tools
import           UnliftIO.Exception

-- drop every n-th element from the list
-- e.g. skipEntries 0 [1..20] => [1..20]
--      skipEntries 1 [1..20] => [13,5,7,9,11,13,15,17,19]
--      skipEntries 2 [1..20] => [14,7,10,13,16,19]
--      skipEntries 3 [1..20] => [15,9,13,17]
skipEntries :: Int -> [a] -> [a]
skipEntries n xs = if null xs then [] else head xs : helper (tail xs)
  where
    helper xs' = case drop n xs' of
      (y : ys) -> y : helper ys
      []       -> []

peerString :: PPeer -> String
peerString peer = key ++ "@" ++ format (pPeerHost peer) ++ ":" ++ show (pPeerTcpPort peer)
  where
    key = p2s (pPeerPubkey peer)
    p2s (Just p) = BS8.unpack . BC16.encode $ pointToBytes p
    p2s _        = ""

yieldR :: Monad m => a -> ConduitT i (Either e a) m ()
yieldR = yield . Right

yieldL :: Monad m => e -> ConduitT i (Either e a) m ()
yieldL = yield . Left

handleEvents :: MonadP2P m => PPeer -> ConduitM Event (Either P2PCNC Message) m ()
handleEvents peer = awaitForever $ \case
  MsgEvt Hello {} -> error "A hello message appeared after the handshake"
  MsgEvt Status {} -> error "A status message appeared after the handshake"
  MsgEvt Ping -> yieldR Pong
  MsgEvt (Transactions txs) -> do
    $logInfoS "handleEvents/Transactions" . T.pack $ "Got " ++ show (length txs) ++ " transaction(s) from" ++ peerString peer ++ ", they are " ++ intercalate "\n" (format <$> txs)
    lift stampActionTimestamp
    let txo = Origin.PeerString (peerString peer)
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = IETx ts . IngestTx txo <$> txs
    yieldL $ ToUnseq ingestTxs
  MsgEvt (NewBlock block' _) -> do
    lift stampActionTimestamp
    $logInfoS "handleEvents/NewBlock" "newBlock"
    let sha = blockHash block'
    let header = blockHeader block'
    let num = blockHeaderBlockNumber header
    let parentHash' = blockHeaderParentHash header
    lift . Mod.put (Proxy @WorldBestBlock) . WorldBestBlock $
      BestBlock sha num
    parentHeader <- lift $ lookup (Proxy @BlockHeader) parentHash'
    case parentHeader of
      Nothing -> do
        BestSequencedBlock _ bestBlockNum _ <- lift $ Mod.get (Proxy @BestSequencedBlock)
        let fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
        $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock :: fetchNumber is " ++ show fetchNumber
        $logInfoS "handleEvents/NewBlock" "#### New block is missing its parent, I am resyncing"
        syncFetch Forward fetchNumber
      Just _ -> do
        let ingestBlock = IEBlock $ blockToIngestBlock (Origin.PeerString $ peerString peer) block'
        yieldL $ ToUnseq [ingestBlock]
  MsgEvt (NewBlockHashes _) -> do
    lift stampActionTimestamp
    BestSequencedBlock _ bestBlockNum _ <- lift $ Mod.get (Proxy @BestSequencedBlock)
    let fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
    $logInfoS "handleEvents/NewBlockHashes" $ T.pack $ "newBlockHashes :: fetchNumber is " ++ show fetchNumber
    syncFetch Forward fetchNumber
  MsgEvt (GetBlockHeaders (BlockNumber start) max' skip' dir) -> do
    lift stampActionTimestamp
    start' <- case dir of
      Reverse -> return $ if start > fromIntegral max' then start - fromIntegral max' else 1
      Forward -> return start
    -- When the skip is 0, none of the blocks are skipped but when the skip is 3,
    -- 3/4s of the blocks will be dropped when creating the blockheaders
    -- so we overcompensate here.
    let count = (1 + skip') * min flags_maxReturnedHeaders max'
    chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockHeader)) $ take count [start' ..]
    when (null chain) $
      $logInfoS "handleEvents/GetBlockHeaders" $
        T.concat
          [ "Warning: A peer requested blocks starting at #",
            T.pack $ show start,
            ", but we don't have these in our canonical chain....",
            " I don't know what to do, so I am returning a blank response.",
            " This may indicate something unhealthy in the network."
          ]
    yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain
  MsgEvt (GetBlockHeaders (BlockHash start) max' skip' dir) -> do
    lift stampActionTimestamp
    maybeHeader <- lift $ lookup (Proxy @BlockHeader) start
    case maybeHeader of
      Nothing -> yieldR (BlockBodies [])
      Just head' -> do
        let num = blockHeaderBlockNumber head'
            start' = case dir of
              Forward -> num
              Reverse ->
                if num > fromIntegral max'
                  then num - fromIntegral max'
                  else 1
        let count = (1 + skip') * min flags_maxReturnedHeaders (fromIntegral max')
        chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockHeader)) $ take count [start' ..]
        yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain
  MsgEvt (BlockHeaders bHeaders) -> do
    lift stampActionTimestamp

    let headers = morphBlockHeader <$> bHeaders

    bodyRequestAlreadyActive <- lift isBodyRequestActive

    lift $ addToHeaderCache headers

    unless bodyRequestAlreadyActive $ do
      bodyHashes' <- lift getBodiesToFetch
      yieldR $ GetBlockBodies bodyHashes'




  -- todo: seems like geth and parity will send bodies on a best-effort, skipping shas they doesnt have
  -- todo: e.g. if they have bodies for Keccak256s [1, 2, 4, 7, 8, 9] and you request [1..10] you'll get
  -- todo: bodies [1, 2, 4, 7, 8, 9] and have to correlate the bodies to the headers yourself
  -- todo: it doesn't seem like we support that behavior very well yet, so we'll just stop sending
  -- todo: blocks once we can't find one. this way we can always correlate header to body in
  -- todo: `(MsgEvt (BlockBodies bodies))` with something akin to `zipWith getHeader shas bodies`
  -- todo: our ideal scenario behavior would be returning something like [1, 2, [], 4, [], [], 7, 8, 9, []]
  -- todo: but alas, the devs hate us.
  -- todo: instead, we'd just return [1, 2] in this case, and hope the peer re-requests the missing blocks from
  -- todo: someone else or us at a later time
  MsgEvt (GetBlockBodies []) -> do
    lift stampActionTimestamp
    yieldR (BlockBodies []) -- todo parity bans peers when they do this. should we?
  MsgEvt (GetBlockBodies shas') -> do
    lift stampActionTimestamp
    let shas = take flags_maxReturnedHeaders shas'
    lift (getUntilMissing shas) >>= \bodies -> do
      yieldR . BlockBodies $ map (second (map morphBlockHeader) . toBody) bodies
    where
      getUntilMissing ::
        ( (Keccak256 `Alters` OutputBlock) m,
          (Address `Selectable` X509CertInfoState) m,
          Accessible PublicKey m
        ) =>
        [Keccak256] ->
        m [OutputBlock]
      getUntilMissing [] = return []
      getUntilMissing (h : hs) =
        lookup (Proxy @OutputBlock) h >>= \case
          Nothing -> return []
          Just body -> do
            rest <- getUntilMissing hs
            return $ body:rest

      toBody :: OutputBlock -> ([Transaction], [BlockHeader])
      toBody = ((map otBaseTx . obReceiptTransactions) &&& obBlockUncles)

  -- todo: support the "best effort" behavior that everyone uses for bodies they dont have (mentioned above
  -- todo:
  MsgEvt (BlockBodies bodies) -> do
    lift stampActionTimestamp

    blocks' <- lift $ recombineBlocksFromCache bodies

    yieldL . ToUnseq $ IEBlock . blockToIngestBlock (Origin.PeerString $ peerString peer) <$> blocks'

    currentSyncTask <- fmap (fromMaybe $ error "no current sync task") $ lift $ getCurrentSyncTask (pPeerHost peer)
    let maxBlockNumber :: Integer
        maxBlockNumber = maximum $ map (BlockHeader.number . blockBlockData) blocks'

    WorldBestBlock (BestBlock _ worldNumber) <- lift $ Mod.get (Proxy @WorldBestBlock)

    maybeFetchNumber <-
        if maxBlockNumber >= 1000 * fromIntegral (syncTaskChiliad currentSyncTask) + 999
          then do
            $logInfoS "handleEvents/BlockBodies" $ T.pack $ "downloaded up to block header " ++ show maxBlockNumber ++ ", we have finished loading chiliad #" ++ show (syncTaskChiliad currentSyncTask)
            lift $ setSyncTaskFinished (pPeerHost peer)

            $logInfoS "serverHandshake" $ T.pack $ "Attempting to get a new sync task, highest block number is " ++ show worldNumber

            syncTask <- lift $ getNewSyncTask (pPeerHost peer) worldNumber
            $logInfoS "handleEvents/BlockBodies" $ T.pack $ "new SyncTask: " ++ show syncTask
            return $ fmap (\v -> fromIntegral $ 1000 * syncTaskChiliad v) syncTask
          else do
            $logInfoS "handleEvents/BlockBodies" $ T.pack $ "downloaded up to block " ++ show maxBlockNumber ++ ", we are still working on  chiliad #" ++ show (syncTaskChiliad currentSyncTask)
            return $ Just $ maxBlockNumber + 1

    $logInfoS "handleEvents/BlockBodies" $ T.pack $ "blockHeaders :: maybeFetchNumber is " ++ show maybeFetchNumber

    bodyHashes' <- lift getBodiesToFetch

    if null bodyHashes'
      then do -- all the block bodies have been sent, let's try to download more headers
      case maybeFetchNumber of
        Nothing ->
          $logInfoS "handleEvents/BlockBodies" $ T.pack $ "No new sync tasks available, done downloading"
        Just fetchNumber | fetchNumber <= worldNumber -> syncFetch Forward fetchNumber
        _ -> do
          currentSyncTask' <- fmap (fromMaybe $ error "no current sync task") $ lift $ getCurrentSyncTask (pPeerHost peer)
          $logInfoS "handleEvents/BlockBodies" $ T.pack $ "remaining blocks in chiliad #" ++ show (syncTaskChiliad currentSyncTask') ++ " are higher than the world best block, marking that chiliad as 'NotReady'"
          lift $ setSyncTaskNotReady (pPeerHost peer)
      else do
        yieldR $ GetBlockBodies bodyHashes'

  MsgEvt (Blockstanbul wm) -> do
    lift $ do
      stampActionTimestamp
      setPeerAddrIfUnset $ blockstanbulSender wm
      peerAddr <- unPeerAddress <$> access (Proxy @PeerAddress)
      $logInfoS "handleEvents/Blockstanbul" . T.pack $ "blockstanbulPeerAddr: " ++ show peerAddr
    let msgHash = rlpHash wm
    lift $ insert (Proxy @(Proxy (Outbound WireMessage))) (pPeerHost peer, msgHash) Proxy
    msgExists <- lift $ exists (Proxy @(Proxy (Inbound WireMessage))) msgHash
    if msgExists
      then
        $logInfoS "handleEvents/Blockstanbul" . T.pack $
          concat
            [ "Already seen inbound wire message ",
              format msgHash,
              ". Not forwarding to Sequencer."
            ]
      else do
        $logInfoS "handleEvents/Blockstanbul" . T.pack $
          concat
            [ "First time seeing inbound wire message ",
              format msgHash,
              ". Forwarding to Sequencer."
            ]
        lift $ insert (Proxy @(Proxy (Inbound WireMessage))) msgHash Proxy
        yieldL $ ToUnseq [IEBlockstanbul wm]

  -- private chains
  MsgEvt (GetChainDetails _) -> return ()
  MsgEvt (ChainDetails _) -> return ()

  -- TODO: Optimize/do security checking (a peer can spam you with random hashes and keep you busy forever)
  MsgEvt (GetMPNodes srs) -> do
    let txo = Origin.PeerString (peerString peer)
    yieldL $ ToUnseq [IEGetMPNodesRequest txo srs]
  MsgEvt (MPNodes nds) -> do
    yieldL $ ToUnseq [IEMPNodesReceived nds]
  MsgEvt (Disconnect _) -> do
    $logInfoS "handleEvents/Disconnect" "Disconnect event received in Event handler"
    throwIO PeerDisconnected
  NewSeqEvent oe -> case oe of
    P2pBlock b -> do
      when (shouldSend peer $ obOrigin b) $ do
        WorldBestBlock (BestBlock _ worldNumber) <- lift $ Mod.get (Proxy @WorldBestBlock)
        $logInfoS "handleEvents/P2pBlock" . T.pack $ "World Number: " ++ show worldNumber
        when (BlockHeader.number (obBlockData b) >= worldNumber) $ do
          $logInfoS "handleEvents/P2pBlock" . T.pack $ "yielding new block: " ++ show (BlockHeader.number . blockBlockData . outputBlockToBlock $ b)
          yieldR $ NewBlock (outputBlockToBlock b) 0
    P2pTx tx -> do
      when (shouldSend peer $ otOrigin tx) $ do
        $logInfoS "handleEvents/P2pTx" $ T.pack $ "sending Transaction " ++ format (otHash tx)
        $logDebugS "handleEvents/P2pTx" . T.pack $ "the transaction was: " ++ format tx
        yieldR $ Transactions [otBaseTx tx]

    P2pBlockstanbul msg -> do
      {-
      lift (fmap getChainMemberFromX509 <$> getPeerX509 peer) >>= \case
        Nothing ->
          $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $
            concat
              [ "Peer ",
                show (pPeerIp peer),
                " does not have a registered certificate"
              ]
        Just cm ->
          maybe False unIsValidator <$> lift (select (Proxy @IsValidator) cm) >>= \case
            False ->
              $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $
                concat
                  [ "Peer ",
                    show (pPeerIp peer),
                    " is not a validator"
                  ]
            True -> do
-}
              let outbound = Blockstanbul msg
              $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $ "Outgoing mesage: " ++ show outbound
              let !msgHash = rlpHash msg
              lift $ insert (Proxy @(Proxy (Inbound WireMessage))) msgHash Proxy
              msgExists <- lift $ exists (Proxy @(Proxy (Outbound WireMessage))) (pPeerHost peer, msgHash)
              if msgExists
                then
                  $logInfoS "handleEvents/P2pBlockstanbul" $
                    T.concat
                      [ "Already seen outbound wire message ",
                        T.pack (format msgHash),
                        ". Not forwarding to peer ",
                        T.pack $ format $ pPeerHost peer
                      ]
                else do
                  $logInfoS "handleEvents/P2pBlockstanbul" $
                    T.concat
                      [ "First time seeing outbound wire message ",
                        T.pack (format msgHash),
                        ". Forwarding to peer ",
                        T.pack $ format $ pPeerHost peer
                      ]
                  let !ip = pPeerHost peer
                  lift $ insert (Proxy @(Proxy (Outbound WireMessage))) (ip, msgHash) Proxy
                  yieldR outbound
    P2pAskForBlocks start _ _ -> do
      $logDebugS "handleEvents/P2pAskForBlocks" . T.pack $ "syncFetch: " ++ show start
      syncFetch Forward start
    P2pPushBlocks start end p -> do
      ss <- lift $ shouldSendToPeer p
      when ss $ do
        let count = min flags_maxReturnedHeaders . fromIntegral $ end - start + 1
        chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockHeader)) $ take count [start ..]
        when (null chain) $
          $logErrorS "handleEvents/P2pPushBlocks" . T.pack $
            printf
              "Blockstanbul believes we have blocks for [%d..%d], they are not found in redis"
              start
              end
        let outbound = BlockHeaders $ morphBlockHeader . unCanonical . snd <$> chain
        $logDebugS "handleEvents/P2pPushBlocks" . T.pack $ "Outgoing message: " ++ show outbound
        yieldR outbound
    P2pGetMPNodes srs -> yieldR $ GetMPNodes srs
    P2pMPNodesResponse o nds -> when (shouldRespond peer o) . yieldR $ MPNodes nds
  TimerEvt -> do
    WorldBestBlock (BestBlock _ worldNumber) <- lift $ Mod.get (Proxy @WorldBestBlock)
    syncDone <- return $ Just False -- RBDB.withRedisBlockDB $ getSyncStatus
    unless (syncDone == Just True) $ do
      maybeSyncTask <- lift $ getCurrentSyncTask $ pPeerHost peer
      case maybeSyncTask of
        Just _ -> return () -- Already have a task, do nothing
        Nothing -> do
          $logInfoS "serverHandshake" $ T.pack $ "Attempting to get a new sync task, highest block number is " ++ show worldNumber
          maybeNewSyncTask <- lift $ getNewSyncTask (pPeerHost peer) worldNumber
          $logInfoS "TimerEvt" $ T.pack $ "I've grabbed a new syncTask: " ++ show maybeNewSyncTask
          case maybeNewSyncTask of
            Nothing -> return ()
            Just syncTask -> syncFetch Forward $ fromIntegral $ 1000 * syncTaskChiliad syncTask

    maybeOldTS <- unActionTimestamp <$> lift getActionTimestamp
    case maybeOldTS of
      Just oldTS -> do
        ts <- liftIO getCurrentTime
        let diffTime = ts `diffUTCTime` oldTS
        liftIO $ setTitle $ "timer: " ++ show (fromIntegral flags_connectionTimeout - diffTime)
        when (diffTime > fromIntegral flags_connectionTimeout) $ do
          yieldR $ Disconnect UselessPeer
          liftIO $ setTitle "timer timed out!"
          throwIO PeerNonResponsive
      Nothing -> do
        $logInfoS "TimerEvt" $ T.pack "Timestamp is not set"
        return ()
    yieldL TXQueueTimeout
  AbortEvt reason -> do
    $logInfoS "handleEvents/AbortEvt" . T.pack $ "Received AbortEvt: " ++ reason
    yieldR $ Disconnect AlreadyConnected
  event -> liftIO . error $ "unrecognized event: " ++ show event

syncFetch ::
  ( MonadIO m,
    Modifiable ActionTimestamp m
  ) =>
  Direction ->
  Integer ->
  ConduitM Event (Either P2PCNC Message) m ()
syncFetch d num = do
  yieldR $ GetBlockHeaders (BlockNumber num) flags_maxReturnedHeaders 0 d
  lift stampActionTimestamp

shouldRespond :: PPeer -> Origin.TXOrigin -> Bool
shouldRespond peer txo = case txo of
  Origin.PeerString ps -> ps == peerString peer
  _                    -> False

shouldSend :: PPeer -> Origin.TXOrigin -> Bool
shouldSend peer txo = case txo of
  Origin.PeerString ps -> ps /= peerString peer
  Origin.API -> True
  Origin.BlockHash _ -> False
  Origin.Direct -> True
  Origin.Quarry -> True -- this should never reach this far anyway
  Origin.Morphism ->
    -- probably means it was converted, see if this is a problem
    trace "NewTx of type Morphism came in. Should this even happen?" True
  Origin.Blockstanbul -> True
