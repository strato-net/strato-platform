{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeOperators       #-}

module Blockchain.Event (
  module Blockchain.EventModel,
  handleEvents,
  handleGetChainDetails,
  getBestKafkaBlockNumber,
  checkPeerIsMember' -- For testing
  ) where

import           Control.Arrow                         ((&&&), second)
import           Control.Lens                          (use)
import           Control.Monad
import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify           hiding (get, put, yield, awaitForever)
import qualified Control.Monad.Change.Modify           as Mod (get, put)
import           Control.Monad.IO.Class
import           Blockchain.Output
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Data.Conduit
import           Data.Default                          (def)
import           Data.Foldable                         (for_)
import qualified Data.DList                            as DL
import           Data.List                             hiding (lookup)
import           Data.Map.Internal                     (WhenMissing(..), WhenMatched(..))
import           Data.Map.Merge.Strict
import qualified Data.Map.Strict                       as M
import           Data.Maybe
import qualified Data.ByteString.Base16                as BC16
import qualified Data.ByteString.Char8                 as BS8
import qualified Data.Set                              as S
import qualified Data.Text                             as T
import           Data.These
import           Data.Time.Clock
import           MonadUtils
import qualified Network.Kafka                         as K
import           Prelude                               hiding (lookup)
import           System.Random
import           Text.Printf
import           UnliftIO.Exception

import           Blockchain.Blockstanbul               (blockstanbulSender)
import           Blockchain.Context
import           Blockchain.Data.Block
import           Blockchain.Data.BlockDB
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Control               (P2PCNC(..))
import           Blockchain.Data.Enode
import           Blockchain.Data.PubKey
import           Blockchain.Data.Transaction
import           Blockchain.Data.TransactionDef        (formatChainId)
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.Data.Wire
import           Blockchain.EventModel
import           Blockchain.EventException
import           Blockchain.ExtWord
import           Blockchain.Options
import           Blockchain.SHA
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Stream.VMEvent
import           Blockchain.Verification

import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka            as SK

import           Blockchain.Strato.Model.Class

import           Blockapps.Crossmon                    (recordMaxBlockNumber)
import           Blockchain.Metrics

import           Text.Format
import           Text.Tools

import           Debug.Trace                           (trace)

setTitleAndProduceBlocks :: ( MonadLogger m
                            , MonadIO m
                            , HasVMEventsSink m
                            ) => [Block] -> m Int
setTitleAndProduceBlocks blocks = do
    lastVMEvents <- liftIO $ fetchLastVMEvents 200
    let lastBlockHashes = [blockHash b | ChainBlock b <- lastVMEvents]
    let newBlocks = filter (not . (`elem` lastBlockHashes) . blockHash) blocks
    sink <- getVMEventsSink
    unless (null newBlocks) $ do
        liftIO . setTitle $ "Block #" ++ show (maximum $ map (blockDataNumber . blockBlockData) newBlocks)
        sink . map ChainBlock $ newBlocks
    return $ length newBlocks

-- drop every n-th element from the list
-- e.g. skipEntries 0 [1..20] => [1..20]
--      skipEntries 1 [1..20] => [13,5,7,9,11,13,15,17,19]
--      skipEntries 2 [1..20] => [14,7,10,13,16,19]
--      skipEntries 3 [1..20] => [15,9,13,17]
skipEntries :: Int -> [a] -> [a]
skipEntries n xs = if null xs then [] else head xs : helper (tail xs)
    where helper xs' = case drop n xs' of
                           (y:ys) -> y : helper ys
                           []     -> []

peerString :: PPeer -> String
peerString peer = key ++ "@" ++ T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer)
    where
        key = p2s (pPeerPubkey peer)
        p2s (Just p) = BS8.unpack . BC16.encode $ pointToBytes p
        p2s _        = ""

yieldR :: Monad m => a -> ConduitT i (Either e a) m ()
yieldR = yield . Right

yieldL :: Monad m => e -> ConduitT i (Either e a) m ()
yieldL = yield . Left

handleEvents :: ( MonadIO m
                , MonadResource m
                , Accessible (SK.UnseqSink m) m
                , MonadState Context m
                , MonadLogger m
                , Modifiable K.KafkaState m
                , Modifiable BestBlock m
                , Modifiable WorldBestBlock m
                , (Integer `Selectable` Canonical BlockData) m
                , (SHA `Alters` BlockData) m
                , (IPAddress `Selectable` IPChains) m
                , (OrgId `Selectable` OrgIdChains) m
                , (SHA `Selectable` ChainTxsInBlock) m
                , (Word256 `Selectable` ChainMembers) m
                , (Word256 `Selectable` ChainInfo) m
                , (SHA `Selectable` Private (Word256, OutputTx)) m
                , (SHA `Alters` OutputBlock) m
                ) => PPeer -> ConduitM Event (Either P2PCNC Message) m ()
handleEvents peer = awaitForever $ \case
    MsgEvt Hello{}  -> error "A hello message appeared after the handshake"
    MsgEvt Status{} -> error "A status message appeared after the handshake"
    MsgEvt Ping     -> yieldR Pong

    MsgEvt (Transactions txs) -> do
        stampActionTimestamp
        let txo = Origin.PeerString (peerString peer)
        lift $ SK.emitKafkaTransactions txo txs

    MsgEvt (NewBlock block' tdiff) -> do
        stampActionTimestamp
        $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock with tdiff " ++ show tdiff
        let sha         = blockHash block'
        let header      = blockHeader block'
        let num         = blockHeaderBlockNumber header
        let parentHash' = blockHeaderParentHash header
        lift . Mod.put (Proxy @WorldBestBlock) . WorldBestBlock $
          BestBlock sha num tdiff
        parentHeader <- lift $ lookup (Proxy @BlockData) parentHash'
        case parentHeader of
          Nothing -> do
            bestBlock <- lift $ Mod.get (Proxy @BestBlock)
            let bestBlockNum = numberFromBestBlock bestBlock
                fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
            $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock :: fetchNumber is " ++ show fetchNumber
            $logInfoS "handleEvents/NewBlock" $ T.pack $ "#### New block is missing its parent, I am resyncing"
            syncFetch Forward fetchNumber
          Just _ -> do
            lift . void $ setTitleAndProduceBlocks [block']
            void . lift $ SK.emitKafkaBlock (Origin.PeerString $ peerString peer) block'

    MsgEvt (NewBlockHashes _) -> do
        stampActionTimestamp
        bestBlock <- lift $ Mod.get (Proxy @BestBlock)
        let bestBlockNum = numberFromBestBlock bestBlock
        let fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
        $logInfoS "handleEvents/NewBlockHashes" $ T.pack $ "newBlockHashes :: fetchNumber is " ++ show fetchNumber
        syncFetch Forward fetchNumber

    MsgEvt (GetBlockHeaders (BlockNumber start) max' skip' dir) -> do
      stampActionTimestamp
      start' <- case dir of
        Reverse -> return $ if start > fromIntegral max' then start - (fromIntegral max') else 1
        Forward -> return start
      mrh <- gets maxReturnedHeaders
      -- When the skip is 0, none of the blocks are skipped but when the skip is 3,
      -- 3/4s of the blocks will be dropped when creating the blockheaders
      -- so we overcompensate here.
      let count = (1 + skip') * max mrh max'
      chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockData)) $ take count [start'..]
      when (null chain) $
        $logInfoS "handleEvents/GetBlockHeaders" $ T.concat $
            ["Warning: A peer requested blocks starting at #"
            , T.pack $ show start
            , ", but we don't have these in our canonical chain...."
            , " I don't know what to do, so I am returning a blank response."
            , " This may indicate something unhealthy in the network."]
      yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain

    MsgEvt (GetBlockHeaders (BlockHash start) max' skip' dir) -> do
      stampActionTimestamp
      maybeHeader <- lift $ lookup (Proxy @BlockData) start
      case maybeHeader of
        Nothing    -> yieldR (BlockBodies [])
        Just head' -> do
          let num = blockHeaderBlockNumber head'
              start' = case dir of
                Forward -> num
                Reverse -> if num > fromIntegral max'
                             then num - fromIntegral max'
                             else 1
          mrh <- gets maxReturnedHeaders
          let count = (1 + skip') * min mrh (fromIntegral num)
          chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockData)) $ take count [start'..]
          yieldR . BlockHeaders . skipEntries skip' $ morphBlockHeader . unCanonical . snd <$> chain

    MsgEvt (BlockHeaders bHeaders) -> do
        let headers = morphBlockHeader <$> bHeaders
        stampActionTimestamp
        alreadyRequestedHeaders <- lift getBlockHeaders -- get already requested headers
        when (null alreadyRequestedHeaders) $ do        -- proceed if we are not already requesting headers
            -- let headerHashes = S.fromList $ map headerHash headers
            --     parentHashes = S.fromList $ map parentHash headers
            --     allNeeded = headerHashes `S.union` parentHashes

            -- check if blockheaders we recieved have parents.
            let parents = map blockDataParentHash headers
            existingParents <- lift $ lookupMany (Proxy @BlockData) parents
            let missingParents  = S.fromList parents S.\\ M.keysSet existingParents
            unless (S.null missingParents) $ do
                 bestBlock <- lift $ Mod.get (Proxy @BestBlock)
                 let fetchNumber = numberFromBestBlock bestBlock + 1
                 $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "blockHeaders :: fetchNumber is " ++ show fetchNumber
                 let lastParent = if M.null existingParents
                                    then fetchNumber
                                    else head . sort $ blockHeaderBlockNumber <$> M.elems existingParents
                 $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "missing blocks: " ++ (unlines $ format <$> S.toList missingParents)
                 syncFetch Reverse lastParent

            let headerHashes = M.fromList $ map (blockHeaderHash &&& id) headers
            headersInDB <- lift . lookupMany (Proxy @BlockData) $ M.keys headerHashes
            let neededHeaders = M.elems $ headerHashes M.\\ headersInDB
                (neededHeaders', remainingHeaders) = splitNeededHeaders neededHeaders
            -- blockOffsets <- lift $ fmap (map blockOffsetHash) $ getBlockOffsetsForHashes $ S.toList allNeeded
            -- let neededHeaders = filter (not . (`elem` blockOffsets) . headerHash) headers
            --     neededHashes = map headerHash neededHeaders
            --     neededParents = filter (not . (`elem` blockOffsets)) $ map parentHash neededHeaders
            --     unfoundParents = S.toList $ S.fromList neededParents S.\\ S.fromList neededHashes
            -- unless (null unfoundParents) $ do
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "neededHashes: " ++ unlines (map format neededHashes)
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "incoming blocks don't seem to have existing parents: " ++ unlines (map format unfoundParents)
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "### calling syncFetch again" >> syncFetch

            lift $ putBlockHeaders neededHeaders'
            lift $ putRemainingBHeaders remainingHeaders
            $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putBlockHeaders called with length " ++ show (length neededHeaders')
            yieldR . GetBlockBodies $ blockHeaderHash <$> neededHeaders'
            stampActionTimestamp

    -- todo: seems like geth and parity will send bodies on a best-effort, skipping shas they doesnt have
    -- todo: e.g. if they have bodies for SHAs [1, 2, 4, 7, 8, 9] and you request [1..10] you'll get
    -- todo: bodies [1, 2, 4, 7, 8, 9] and have to correlate the bodies to the headers yourself
    -- todo: it doesn't seem like we support that behavior very well yet, so we'll just stop sending
    -- todo: blocks once we can't find one. this way we can always correlate header to body in
    -- todo: `(MsgEvt (BlockBodies bodies))` with something akin to `zipWith getHeader shas bodies`
    -- todo: our ideal scenario behavior would be returning something like [1, 2, [], 4, [], [], 7, 8, 9, []]
    -- todo: but alas, the devs hate us.
    -- todo: instead, we'd just return [1, 2] in this case, and hope the peer re-requests the missing blocks from
    -- todo: someone else or us at a later time
    MsgEvt (GetBlockBodies [])   -> do
      stampActionTimestamp
      yieldR (BlockBodies []) -- todo parity bans peers when they do this. should we?
    MsgEvt (GetBlockBodies shas') -> do
      stampActionTimestamp
      mrh <- gets maxReturnedHeaders
      let shas = take mrh shas'
      lift (getUntilMissing shas DL.empty DL.empty) >>= \(bodies, pshas) -> do
          yieldR . BlockBodies $ map (second (map morphBlockHeader) . toBody) bodies
          ptxs <- fmap M.elems . lift $ selectMany (Proxy @(Private (Word256, OutputTx))) pshas
          unless (null ptxs) . yieldR . Transactions $ morphTx  . snd . unPrivate <$> ptxs
        where getUntilMissing :: ( (SHA `Selectable` ChainTxsInBlock) m
                                 , (Word256 `Selectable` ChainMembers) m
                                 , (SHA `Alters` OutputBlock) m
                                 )
                              => [SHA] -> DL.DList OutputBlock -> DL.DList SHA -> m ([OutputBlock],[SHA])
              getUntilMissing []     bodies pshas = return (DL.toList bodies, DL.toList pshas)
              getUntilMissing (h:hs) bodies pshas = lookup (Proxy @OutputBlock) h >>= \case
                  Nothing   -> return (DL.toList bodies, DL.toList pshas)
                  Just body -> do
                    ChainTxsInBlock cIdTxsMap <- selectWithDefault (Proxy @ChainTxsInBlock) h
                    mems <- selectMany (Proxy @ChainMembers) $ M.keys cIdTxsMap
                    let whenMissing f = WhenMissing (pure . M.map f) (\_ x -> (pure . Just $ f x))
                        trMems = merge (whenMissing This)
                                       (whenMissing That)
                                       (WhenMatched $ \_ x y -> pure . Just $ These x y)
                                       cIdTxsMap
                                       mems
                        filtered = flip M.filter trMems $
                          mergeTheseWith (const False) (checkPeerIsMember peer) (||)
                        pshas' = M.foldr (DL.append . DL.fromList . these id (const []) const) DL.empty filtered
                    getUntilMissing hs (bodies `DL.snoc` body) (pshas `DL.append` pshas')

              toBody :: OutputBlock -> ([Transaction], [BlockData])
              toBody = ((map otBaseTx . obReceiptTransactions) &&& obBlockUncles)

    -- todo: support the "best effort" behavior that everyone uses for bodies they dont have (mentioned above
    -- todo:
    MsgEvt (BlockBodies []) -> return () --clearActionTimestamp
    MsgEvt (BlockBodies bodies) -> do
        stampActionTimestamp
        headers <- lift getBlockHeaders
        let verified = and $ zipWith (\h b -> blockDataTransactionsRoot h == transactionsVerificationValue (fst b)) headers bodies
        unless verified $ error "headers don't match bodies"
        $logInfoS "handleEvents/BlockBodies" $ T.pack $ "len headers is " ++ show (length headers) ++ ", len bodies is " ++ show (length bodies)
        recordMaxBlockNumber "p2p_block_bodies" . maximum $ map blockDataNumber headers
        let blocks' = zipWith createBlockFromHeaderAndBody (morphBlockHeader <$> headers) bodies
        newCount <- lift $ setTitleAndProduceBlocks blocks'
        lift . forM_ blocks' $ SK.emitKafkaBlock (Origin.PeerString $ peerString peer)
        rHeaders <- lift getRemainingBHeaders
        let (neededHeaders, remainingHeaders) = splitNeededHeaders rHeaders
        lift $ putBlockHeaders neededHeaders
        lift $ putRemainingBHeaders remainingHeaders
        if null neededHeaders
            then when (newCount > 0) $ do
                mrh <- gets maxReturnedHeaders
                yieldR $ GetBlockHeaders (BlockHash $ blockHeaderHash $ last headers) mrh 0 Forward
                stampActionTimestamp
            else do
                yieldR $ GetBlockBodies (map blockHeaderHash neededHeaders)
                stampActionTimestamp
    MsgEvt (Blockstanbul wm) -> do
      stampActionTimestamp
      setPeerAddrIfUnset $ blockstanbulSender wm
      peerAddr <- use blockstanbulPeerAddr
      $logInfoS "handleEvents/Blockstanbul" . T.pack $ "blockstanbulPeerAddr: " ++ show peerAddr
      lift $ SK.emitBlockstanbulMsg wm

    -- private chains
    MsgEvt (GetChainDetails cids') -> handleGetChainDetails peer $ S.fromList cids'

    MsgEvt (ChainDetails chpairs) -> do
      stampActionTimestamp
      lift $ mapM_ (uncurry (SK.emitKafkaChainDetails (Origin.PeerString $ peerString peer))) chpairs

    -- TODO: Optimize/do security checking (a peer can spam you with random hashes and keep you busy forever)
    MsgEvt (GetTransactions trHashes) -> do
      stampActionTimestamp
      $logInfoS "handleEvents/GetTransactions" $ T.pack $ "requesting info for txHashes: "
        ++ (intercalate "\n" (format <$> trHashes))
      ptrs <- fmap (map unPrivate . M.elems) . lift $ selectMany (Proxy @(Private (Word256, OutputTx))) trHashes
      mems <- lift . selectMany (Proxy @ChainMembers) $ map fst ptrs
      let isMember cId = maybe False (checkPeerIsMember peer)
                       $ M.lookup cId mems
      yieldR . Transactions . map (morphTx . snd) $ filter (isMember . fst) ptrs

    MsgEvt (Disconnect _) -> do
            $logInfoS "handleEvents/Disconnect" $ T.pack $ "Disconnect event received in Event handler"
            throwIO PeerDisconnected

    NewSeqEvent oe -> case oe of
      P2pBlock b  -> do
        when (shouldSend peer $ obOrigin b) $ do
          WorldBestBlock (BestBlock _ _ worldTDiff) <- lift $ Mod.get (Proxy @WorldBestBlock)
          $logInfoS "handleEvents/P2pBlock" . T.pack $ "World TDiff: " ++ show worldTDiff
          when (obTotalDifficulty b >= worldTDiff) $ do
            $logInfoS "handleEvents/P2pBlock" . T.pack $ "yielding new block: " ++ show (blockDataNumber . blockBlockData . outputBlockToBlock $ b)
            yieldR $ NewBlock (outputBlockToBlock b) (obTotalDifficulty b)
      P2pTx tx -> do
        whenM (shouldSendGossip peer $ otOrigin tx) $ do
          let cId = txChainId tx
          match <- case cId of
            Nothing -> return True
            Just cid' -> fmap (maybe False (checkPeerIsMember peer)) . lift $
              select (Proxy @ChainMembers) cid'

          if not match
            then $logInfoS "handleEvents/P2pTx" $ T.pack $
                    printf "peer %s is not authorized for chainID %s" (maybe "<nokey>" showEnode $ pPeerEnode peer) (formatChainId cId)
            else do
              $logInfoS "handleEvents/P2pTx" $ T.pack $ "sending Transaction " ++ format (otHash tx) ++ " for chainID " ++ formatChainId cId
              $logDebugS "handleEvents/P2pTx" . T.pack $ "the transaction was: " ++ format tx
              yieldR $ Transactions [otBaseTx tx]
      P2pGenesis (OutputGenesis og (cId, cInfo@(ChainInfo uci _))) -> do
        when (shouldSend peer og) $ do
          $logInfoS "handleEvents/P2pGenesis" . T.pack $ "received new chain: " ++ formatChainId (Just cId) ++ " with " ++ show uci
          if checkPeerIsMember peer . ChainMembers $ members uci
            then do
              $logInfoS "handleEvents/P2pGenesis" $ T.pack $ "sending ChainDetails for chainID " ++ (formatChainId $ Just cId)
              yieldR $ ChainDetails [(cId, cInfo)]
            else do
              $logInfoS "handleEvents/P2pGenesis" $ T.pack $
                printf "peer %s is not authorized for received chainID %s" (maybe "<nokey>" showEnode $ pPeerEnode peer) (formatChainId $ Just cId)
              $logDebugLS "handleEvents/P2pGenesis/members" $ members uci
      P2pGetChain chainIds -> yieldR $ GetChainDetails chainIds
      P2pGetTx shas -> yieldR $ GetTransactions shas
      P2pNewChainMember cId _ _ -> do
        let formatted = format $ SHA cId
        $logInfoS "handleEvents/P2pNewChainMember" $ T.pack $ "New member added to chain " ++ formatted
        mems <- lift $ selectWithDefault (Proxy @ChainMembers) cId
        when (checkPeerIsMember peer mems) $ do
          $logInfoS "handleEvents/P2pNewChainMember" $ T.pack $ "Emitting chain details for chain " ++ formatted
          mcInfo <- fmap (fmap ((,) cId)) . lift $ select (Proxy @ChainInfo) cId
          for_ mcInfo $ yieldR . ChainDetails . (:[])
      P2pBlockstanbul msg -> do
        let outbound = Blockstanbul msg
        $logDebugS "handleEvents/P2pBlockstanbul" . T.pack $ "Outgoing mesage: " ++ show outbound
        yieldR outbound
      P2pAskForBlocks start _ p -> do
        ss <- shouldSendToPeer p
        when ss $ do
          $logDebugS "handleEvents/P2pAskForBlocks" . T.pack $ "syncFetch: " ++ show start
          syncFetch Forward start
      P2pPushBlocks start end p -> do
        ss <- shouldSendToPeer p
        when ss $ do
          mrh <- gets maxReturnedHeaders
          let count = min mrh . fromIntegral $ end - start + 1
          chain <- fmap M.toList . lift . selectMany (Proxy @(Canonical BlockData)) $ take count [start..]
          when (null chain) $
            $logErrorS "handleEvents/P2pPushBlocks" . T.pack $ printf
              "Blockstanbul believes we have blocks for [%d..%d], they are not found in redis" start end
          let outbound = BlockHeaders $ morphBlockHeader . unCanonical . snd <$> chain
          $logDebugS "handleEvents/P2pPushBlocks" . T.pack $ "Outgoing message: " ++ show outbound
          yieldR outbound

    TimerEvt -> do
        maybeOldTS <- getActionTimestamp
        case maybeOldTS of
            Just oldTS -> do
                ts <- liftIO getCurrentTime
                let diffTime = ts `diffUTCTime` oldTS
                maxTime <- gets (fromIntegral . connectionTimeout)
                liftIO $ setTitle $ "timer: " ++ show (maxTime - diffTime)
                when (diffTime > maxTime) $ do
                    yieldR $ Disconnect UselessPeer
                    liftIO $ setTitle "timer timed out!"
                    error "Peer did not respond"
            Nothing -> do
              $logInfoS "TimerEvt" $ T.pack "Timestamp is not set"
              return ()
        yieldL TXQueueTimeout

    AbortEvt reason -> do
      $logInfoS "handleEvents/AbortEvt" . T.pack $ "Received AbortEvt: " ++ reason
      yieldR $ Disconnect AlreadyConnected
    event -> liftIO . error $ "unrecognized event: " ++ show event

handleGetChainDetails :: ( MonadIO m
                         , MonadResource m
                         , MonadState Context m
                         , MonadLogger m
                         , (IPAddress `Selectable` IPChains) m
                         , (OrgId `Selectable` OrgIdChains) m
                         , (Word256 `Selectable` ChainMembers) m
                         , (Word256 `Selectable` ChainInfo) m
                         )
                      => PPeer
                      -> S.Set Word256
                      -> ConduitM Event (Either P2PCNC Message) m ()
handleGetChainDetails peer cids' = do
  cids <- S.toList <$> if S.null cids'
            then lift $ do
              ipChains <- selectWithDefault (Proxy @IPChains) (peerIPAddress peer)
              orgIdChains <- fmap (fromMaybe def)
                           . traverse (selectWithDefault (Proxy @OrgIdChains) . OrgId . pointToBytes)
                           $ pPeerPubkey peer
              return $ S.union (unIPChains ipChains) (unOrgIdChains orgIdChains)
            else return cids'
  stampActionTimestamp
  $logInfoS "handleGetChainDetails" $ T.pack $ "details requested for chainIDs " ++ (intercalate "\n" $ formatChainId . Just <$> cids)
  mems <- lift $ selectMany (Proxy @ChainMembers) cids
  let filteredPairs = M.keys $ M.filter (checkPeerIsMember peer) mems

  unless (null filteredPairs) $ do
    cInfos <- fmap M.toList . lift $ selectMany (Proxy @ChainInfo) cids
    yieldR $ ChainDetails cInfos
    stampActionTimestamp
    $logInfoS "handleGetChainDetails" $ T.pack $ "the following ChainIds were returned " ++
      (intercalate "\n" $ formatChainId . Just . fst <$> cInfos)

numberFromBestBlock :: BestBlock -> Integer
numberFromBestBlock (BestBlock _ n _) = n

-- todo: we should take blockNumber as argument here instead of just looking for
-- bestBlock to prevent us from getting stuck
syncFetch :: (MonadIO m, MonadState Context m)
          => Direction -> Integer -> ConduitM Event (Either P2PCNC Message) m ()
syncFetch d num = do
    blockHeaders' <- lift getBlockHeaders -- get blockHeaders from Context
    when (null blockHeaders') $ do
        mrh <- gets maxReturnedHeaders
        yieldR $ GetBlockHeaders (BlockNumber num) mrh 0 d
        stampActionTimestamp

shouldSend :: PPeer -> Origin.TXOrigin -> Bool
shouldSend peer txo = case txo of
    Origin.PeerString ps -> ps /= peerString peer
    Origin.API           -> True
    Origin.BlockHash _   -> False
    Origin.Direct        -> True
    Origin.Quarry        -> True -- this should never reach this far anyway
    Origin.Morphism      -> -- probably means it was converted, see if this is a problem
        trace "NewTx of type Morphism came in. Should this even happen?" True
    Origin.Blockstanbul -> False

shouldSendGossip :: MonadIO m => PPeer -> Origin.TXOrigin -> m Bool
shouldSendGossip peer txo = recordGossipFinal
                          . (shouldSend peer txo &&)
                          . (flags_txGossipFanout == -1 ||) =<<
  case txo of
    Origin.PeerString{} -> do
      rangeEnd <- getNumPeersMem
      rng <- liftIO $ randomRIO (1, rangeEnd)
      recordGossipRNG $! rangeEnd <= flags_txGossipFanout || rng <= flags_txGossipFanout
    _ -> return True


checkPeerIsMember :: PPeer -> ChainMembers -> Bool
checkPeerIsMember = checkPeerIsMember' flags_privateChainAuthorizationMode

checkPeerIsMember' :: AuthorizationMode -> PPeer -> ChainMembers -> Bool
checkPeerIsMember' mode peer mems =
  let elems = M.elems $ unChainMembers mems
      ips = map ipAddress elems
      keys = map (Just . pubKey) elems
      ipkeys = map (ipAddress &&& (Just . pubKey)) elems
      thisIP = peerIPAddress peer
      thisKey = OrgId . pointToBytes <$> pPeerPubkey peer
  in case mode of
        IPOnly -> thisIP `elem` ips
        PubkeyOnly -> thisKey `elem` keys
        StrongAuth -> (thisIP, thisKey) `elem` ipkeys
        FlexibleAuth -> or [thisIP `elem` ips, thisKey `elem` keys]

peerIPAddress :: PPeer -> IPAddress
peerIPAddress = readIP . T.unpack . pPeerIp

{- to reduce redundant computations on dividing block chunks under txsLimit
splitNeededHeaders :: [BlockHeader] -> [[BlockHeader]]
splitNeededHeaders x =
  let txsLens = extraData2TxsLen <$> extraData <$> neededHeaders
      txsLensInLimit =  scanl (\x y -> if ((x+y)>flags_maxHeadersTxsLens) then y else x+y) 0 txsLens
      indexToSplit :: Int -> [Int] -> [Int] -> [Int] -> [Int]
      indexToSplit index li (x:xs) (y:ys) =  indexToSplit (index++) li' xs ys
        where li = case (x==y) of
          True -> li:index
          False -> li
      indexToSplit _ li [] [] = li
  in splitAt -}

splitNeededHeaders :: [BlockData] -> ([BlockData], [BlockData])
splitNeededHeaders neededHeaders =
  let txsLens = extraData2TxsLen <$> blockDataExtraData <$> neededHeaders
      txsLensInSums =  scanl (+) (0) $ fromMaybe flags_averageTxsPerBlock <$> txsLens
      txsLensInLimit = takeWhile (< flags_maxHeadersTxsLens) $ tail txsLensInSums
  in splitAt (length txsLensInLimit) neededHeaders
