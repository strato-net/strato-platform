{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module Blockchain.Event (
  module Blockchain.EventModel,
  handleEvents,
  getBestKafkaBlockNumber
  ) where

import           Control.Arrow                         ((&&&))
import           Control.Exception.Lifted
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.State
import           Data.Conduit
import           Data.List
import           Data.Map                              (toList)
import           Data.Maybe
import qualified Data.ByteString                       as BS
import qualified Data.ByteString.Base16                as BC16
import qualified Data.ByteString.Char8                 as BS8
import qualified Data.Text                             as T
import           Data.Time.Clock

import           Blockchain.Colors
import           Blockchain.Context
import           Blockchain.Data.BlockDB
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode
import           Blockchain.Data.PubKey
import           Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin              as Origin
import           Blockchain.Data.Wire
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.EventModel
import           Blockchain.EventException
import           Blockchain.Format
import           Blockchain.SHA
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Stream.VMEvent
import           Blockchain.Verification

import           Blockchain.Sequencer.Event
import qualified Blockchain.Sequencer.Kafka            as SK

import           Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models hiding (Transactions)

import           Debug.Trace                           (trace)

-- MonadBaseControl IO m, MonadIO m
setTitleAndProduceBlocks :: (MonadLogger m, HasSQLDB m, RBDB.HasRedisBlockDB m, MonadState Context m, HasVMEventsSink m) => [Block] -> m Int
setTitleAndProduceBlocks blocks = do
    lastVMEvents <- liftIO $ fetchLastVMEvents 200
    let lastBlockHashes = [blockHash b | ChainBlock b <- lastVMEvents]
    let newBlocks = filter (not . (`elem` lastBlockHashes) . blockHash) blocks
    sink <- getVMEventsSink
    unless (null newBlocks) $ do
        liftIO . setTitle $ "Block #" ++ show (maximum $ map (blockDataNumber . blockBlockData) newBlocks)
        runConduit $ yield (map ChainBlock newBlocks) .| sink
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
        p2s (Just p) = BS8.unpack . BC16.encode . BS.pack $ pointToBytes p
        p2s _        = ""

handleEvents :: (MonadIO m, HasSQLDB m, RBDB.HasRedisBlockDB m, SK.HasUnseqSink m, MonadState Context m, MonadLogger m)
             =>  DebugMode -> PPeer -> ConduitT Event Message m ()
handleEvents mode peer = awaitForever $ \case
    MsgEvt Hello{}  -> error "A hello message appeared after the handshake"
    MsgEvt Status{} -> error "A status message appeared after the handshake"
    MsgEvt Ping     -> yield Pong

    MsgEvt (Transactions txs) -> do
        stampActionTimestamp
        let txo = Origin.PeerString (peerString peer)
        _ <- lift $ insertTX mode txo Nothing txs
        SK.emitKafkaTransactions txo txs
        return ()

    MsgEvt (NewBlock block' tdiff) -> do
        stampActionTimestamp
        $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock with tdiff " ++ show tdiff
        let sha         = blockHash block'
        let header      = blockHeader block'
        let num         = blockHeaderBlockNumber header
        let parentHash' = blockHeaderParentHash header
        eResult <- RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo sha num tdiff)
        case eResult of
          Left  _     -> $logInfoS "handleEvents/NewBlock" $ T.pack "Failed to update WorldBestBlockInfo"
          Right False -> $logInfoS "handleEvents/NewBlock" $ T.pack "NewBlock is not better than existing WorldBestBlock"
          Right True  -> do
            (redisParentHeader :: Maybe BlockData) <- RBDB.withRedisBlockDB (RBDB.getHeader parentHash')
            case redisParentHeader of
                Nothing -> do
                    bestBlock <- RBDB.withRedisBlockDB RBDB.getBestBlockInfo
                    let bestBlockNum = numFromRedis bestBlock
                    let fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
                    $logInfoS "handleEvents/NewBlock" $ T.pack $ "newBlock :: fetchNumber is " ++ show fetchNumber
                    $logInfoS "handleEvents/NewBlock" $ T.pack $ "#### New block is missing its parent, I am resyncing"
                    syncFetch Forward fetchNumber
                Just _  -> do
                    lift . void $ setTitleAndProduceBlocks [block']
                    void $ SK.emitKafkaBlock (Origin.PeerString $ peerString peer) block'

    MsgEvt (NewBlockHashes _) -> do
        stampActionTimestamp
        bestBlock <- RBDB.withRedisBlockDB RBDB.getBestBlockInfo
        let bestBlockNum = numFromRedis bestBlock
        let fetchNumber = if bestBlockNum < 2 then 1 else bestBlockNum - 1
        $logInfoS "handleEvents/NewBlockHashes" $ T.pack $ "newBlockHashes :: fetchNumber is " ++ show fetchNumber
        syncFetch Forward fetchNumber

    MsgEvt (GetBlockHeaders (BlockNumber start) max' skip' dir) -> do
      stampActionTimestamp
      start' <- case dir of
        Reverse -> return $ if start > fromIntegral max' then start - (fromIntegral max') else 1
        Forward -> return start
      chain <- RBDB.withRedisBlockDB $ RBDB.getCanonicalHeaderChain start' max'
      when (null chain) $
        $logInfoS "handleEvents/GetBlockHeaders" $ T.pack $ "Warning: A peer requested blocks starting at #" ++ show start ++ ", but we don't have these in our canonical chain.... I don't know what to do, so I am returning a blank response. This may indicate something unhealthy in the network."

      yield . BlockHeaders . skipEntries skip' $ snd <$> chain

    MsgEvt (GetBlockHeaders (BlockHash start) max' skip' dir) -> do
      stampActionTimestamp
      maybeHeader :: Maybe BlockHeader <- RBDB.withRedisBlockDB $ RBDB.getHeader start
      case maybeHeader of
        Nothing    -> yield (BlockBodies [])
        Just head' -> do
          let num = blockHeaderBlockNumber head'
          start' <- case dir of
            Reverse -> return $ if num > fromIntegral max' then num - (fromIntegral max') else 1
            Forward -> return num
          chain <- RBDB.withRedisBlockDB $ RBDB.getCanonicalHeaderChain start' max'
          yield . BlockHeaders . skipEntries skip' $ snd <$> chain

    MsgEvt (BlockHeaders headers) -> do
        stampActionTimestamp
        alreadyRequestedHeaders <- lift getBlockHeaders -- get already requested headers
        when (null alreadyRequestedHeaders) $ do        -- proceed if we are not already requesting headers
            -- let headerHashes = S.fromList $ map headerHash headers
            --     parentHashes = S.fromList $ map parentHash headers
            --     allNeeded = headerHashes `S.union` parentHashes

            -- check if blockheaders we recieved have parents.
            parentsInDB :: [(SHA, Maybe BlockHeader)] <- RBDB.withRedisBlockDB . RBDB.getHeaders $ parentHash <$> headers
            let existingParents = [(sha, x) | (sha, Just x) <- parentsInDB]
            let missingParents  = [sha | (sha, Nothing) <- parentsInDB, sha /= SHA 0]
            unless (null missingParents) $ do
                 bestBlock <- RBDB.withRedisBlockDB RBDB.getBestBlockInfo
                 let fetchNumber = numFromRedis bestBlock + 1
                 $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "blockHeaders :: fetchNumber is " ++ show fetchNumber
                 let lastParent = case length existingParents of
                                      0 -> fetchNumber
                                      _ -> head . sort $ blockHeaderBlockNumber . snd <$> existingParents
                 $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "missing blocks: " ++ (unlines $ format <$> missingParents)
                 syncFetch Reverse lastParent

            -- todo: try with (&&&)
            headersInDB :: [(SHA, Maybe BlockHeader)] <- RBDB.withRedisBlockDB . RBDB.getHeaders $ headerHash <$> headers
            let neededHeaders = filter (\x -> (headerHash x) `elem` [sha | (sha, Nothing) <- headersInDB]) headers

            -- blockOffsets <- lift $ fmap (map blockOffsetHash) $ getBlockOffsetsForHashes $ S.toList allNeeded
            -- let neededHeaders = filter (not . (`elem` blockOffsets) . headerHash) headers
            --     neededHashes = map headerHash neededHeaders
            --     neededParents = filter (not . (`elem` blockOffsets)) $ map parentHash neededHeaders
            --     unfoundParents = S.toList $ S.fromList neededParents S.\\ S.fromList neededHashes
            -- unless (null unfoundParents) $ do
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "neededHashes: " ++ unlines (map format neededHashes)
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "incoming blocks don't seem to have existing parents: " ++ unlines (map format unfoundParents)
            --     $logInfoN "handleEvents/BlockHeaders" $ T.pack $ "### calling syncFetch again" >> syncFetch

            lift $ putBlockHeaders neededHeaders
            $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putBlockHeaders called with length " ++ show (length neededHeaders)
            yield . GetBlockBodies $ headerHash <$> neededHeaders
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
      yield (BlockBodies []) -- todo parity bans peers when they do this. should we?
    MsgEvt (GetBlockBodies shas) -> do
      stampActionTimestamp
      getUntilMissing shas [] >>=  yield . BlockBodies . Prelude.reverse . fmap toBody
        where getUntilMissing :: (RBDB.HasRedisBlockDB m, MonadIO m) => [SHA] -> [Block] -> m [Block]
              getUntilMissing []     bodies = return bodies
              getUntilMissing (h:hs) bodies = RBDB.withRedisBlockDB (RBDB.getBlock h) >>= \case
                  Nothing   -> return bodies
                  Just body -> getUntilMissing hs (body:bodies)

              toBody :: Block -> ([Transaction], [BlockHeader])
              toBody = (blockTransactions &&& fmap morphBlockHeader . blockUncleHeaders)

    -- todo: support the "best effort" behavior that everyone uses for bodies they dont have (mentioned above
    -- todo:
    MsgEvt (BlockBodies []) -> return () --clearActionTimestamp
    MsgEvt (BlockBodies bodies) -> do
        stampActionTimestamp
        headers <- lift getBlockHeaders
        let verified = and $ zipWith (\h b -> transactionsRoot h == transactionsVerificationValue (fst b)) headers bodies
        unless verified $ error "headers don't match bodies"
        $logInfoS "handleEvents/BlockBodies" $ T.pack $ "len headers is " ++ show (length headers) ++ ", len bodies is " ++ show (length bodies)
        let blocks' = zipWith createBlockFromHeaderAndBody headers bodies
        newCount <- lift $ setTitleAndProduceBlocks blocks'
        forM_ blocks' $ lift . SK.emitKafkaBlock (Origin.PeerString $ peerString peer)
        let remainingHeaders = drop (length bodies) headers
        lift $ putBlockHeaders remainingHeaders
        if null remainingHeaders
            then when (newCount > 0) $ do
                mrh <- gets maxReturnedHeaders
                yield $ GetBlockHeaders (BlockHash $ headerHash $ last headers) mrh 0 Forward
                stampActionTimestamp
            else do
                yield $ GetBlockBodies (map headerHash remainingHeaders)
                stampActionTimestamp
    MsgEvt (Blockstanbul wm) -> do
      stampActionTimestamp
      SK.emitBlockstanbulMsg wm

    -- private chains
    MsgEvt (GetChainDetails cids) -> do
      stampActionTimestamp
      $logInfoS "handleEvents/GetChainDetails" $ T.pack $ "details requested for chainIDs " ++ (intercalate "\n" $ show <$> cids)
      chDets <- lift . RBDB.withRedisBlockDB $ mapM RBDB.getChainInfo cids
      let unfilteredPairs =  makePairs cids chDets
      let chPairs = fmap fromJust <$> filter (isJust . snd) unfilteredPairs -- remove pairs where ChainInfo is Nothing
      let finalPairs = filter ((checkPeerIsMember peer) . snd) chPairs -- remove pairs where peer is not a member

      case finalPairs of
        [] -> return ()
        _ -> do
          yield $ ChainDetails finalPairs
          stampActionTimestamp
          $logInfoS "handleEvents/GetChainDetails" $ T.pack $ "the following (ChainId, ChainInfo) pairs were returned " ++
            (intercalate "\n" $ show <$> finalPairs)

    MsgEvt (ChainDetails chpairs) -> do
      stampActionTimestamp
      RBDB.withRedisBlockDB $ mapM_ (uncurry RBDB.putChainInfo) chpairs
      mapM_ (uncurry (SK.emitKafkaChainDetails (Origin.PeerString $ peerString peer))) chpairs

    -- TODO: Optimize/do security checking (a peer can spam you with random hashes and keep you busy forever)
    MsgEvt (GetTransactions trHashes) -> do
      stampActionTimestamp
      $logInfoS "handleEvents/GetTransactions" $ T.pack $ "requesting info for txHashes: "
        ++ (intercalate "\n" (show <$> trHashes))
      unfilteredTrs::[Maybe [Transaction]] <- lift . RBDB.withRedisBlockDB $ mapM RBDB.getTransactions trHashes
      let trs::[Transaction] = head <$> (fmap fromJust $ filter isJust unfilteredTrs) -- all non-Nothing TXs

      -- yield all of the first list, do auth check for second list and send the ones that peer is allowed to see
      let splitTrs::([Transaction],[Transaction]) = partition ((== Nothing) . txChainId) trs
      unfilteredChInfos::[Maybe ChainInfo] <- (lift . RBDB.withRedisBlockDB $ mapM RBDB.getChainInfo (fromJust <$> (txChainId <$> (snd splitTrs))))
      let justChInfos::[ChainInfo] = fromJust <$> unfilteredChInfos

      -- Make pairs of Transactions and their corresponding ChainInfos, do auth check, yield resultant TXs
      let txChInfoPairs::[(Transaction, ChainInfo)] = makePairs (snd splitTrs) justChInfos
      let validPairs::[(Transaction, ChainInfo)] = filter ((checkPeerIsMember peer) . snd) txChInfoPairs
      let finalTrs::[Transaction] = (fst splitTrs) ++ (fst <$> validPairs)
      yield $ Transactions finalTrs

    MsgEvt (Disconnect _) -> do
            $logInfoS "handleEvents/Disconnect" $ T.pack $ "Disconnect event received in Event handler"
            throwIO PeerDisconnected

    NewSeqEvent oe -> case oe of
      OEBlock b  -> do
        when (shouldSend peer $ obOrigin b) $ do
          worldBestBlock <- RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo
          case worldBestBlock of
            Nothing -> return ()
            Just (RedisBestBlock _ _ worldTDiff) -> do
              $logInfoS "NewSeqEvent.block" . T.pack $ "World TDiff: " ++ show worldTDiff
              when (obTotalDifficulty b >= worldTDiff) $ do
                $logInfoS "NewSeqEvent.block" . T.pack $ "yielding new block: " ++ show (blockDataNumber . blockBlockData . outputBlockToBlock $ b)
                yield $ NewBlock (outputBlockToBlock b) (obTotalDifficulty b)
      OETx _ tx -> do
        when (shouldSend peer $ otOrigin tx) $ do
          let cId = txChainId tx
          match <- case cId of
            Nothing -> return True
            Just cid' -> do
              mCInfo <- RBDB.withRedisBlockDB $ RBDB.getChainInfo cid'
              case mCInfo of
                Nothing -> return False
                Just cInfo -> do
                  let pIp = readIP $ T.unpack (pPeerIp peer)
                      ipList = ipAddress <$> members cInfo
                  return $ pIp `elem` ipList

          if not match
            then $logInfoS "handleEvents/OETx" $ T.pack $ "peer is not authorized for chainID " ++ show cId
            else do
              $logInfoS "handleEvents/OETx" $ T.pack $ "sending Transaction " ++ format (otHash tx) ++ " for chainID " ++ show cId
              $logDebugS "NewSeqEvent.tx" . T.pack $ "the transaction was: " ++ format tx
              yield $ Transactions [otBaseTx tx]
      OEGenesis (OutputGenesis og (cId, cInfo)) -> do
        when (shouldSend peer og) $ do
          $logInfoS "NewSeqEvent.genesis" . T.pack $ "yielding new chain: " ++ show cId ++ " with " ++ show cInfo
          let pIp = readIP $ T.unpack (pPeerIp peer)
          let ipList = ipAddress <$> members cInfo
          let match = find (==pIp) ipList

          case match of
            Nothing -> do
              $logInfoS "handleEvents/OEGenesis" $ T.pack $ "peer requesting chain details is not authorized for chainID " ++ (show cId)
            Just _ -> do
              $logInfoS "handleEvents/OEGenesis" $ T.pack $ "sending ChainDetails for chainID " ++ (show cId)
              yield $ ChainDetails [(cId, cInfo)]
      OEGetChain chainIds -> yield $ GetChainDetails chainIds
      OEGetTx shas -> yield $ GetTransactions shas
      OEBlockstanbul msg -> do
        let outbound = Blockstanbul msg
        $logDebugS "handleEvents/OEBlockstanbul" . T.pack $ "Outgoing mesage: " ++ show outbound
        yield outbound
      OEAskForBlocks start end -> do
        let outbound = GetBlockHeaders (BlockNumber start) (fromIntegral $ end - start + 1) 0 Forward
        $logDebugS "handleEvents/OEAskForBlocks" . T.pack $ "Outgoing message: " ++ show outbound
        yield outbound
      OEJsonRpcCommand _ -> $logErrorS "handleEvents/OEJsonRpcCommand" "The impossible happened"
      OECreateBlockCommand -> $logErrorS "handleEvents/OECreateBlockCommand" "何"

    TimerEvt -> do
        maybeOldTS <- getActionTimestamp
        case maybeOldTS of
            Just oldTS -> do
                ts <- liftIO getCurrentTime
                let diffTime = ts `diffUTCTime` oldTS
                maxTime <- gets (fromIntegral . connectionTimeout)
                liftIO $ setTitle $ "timer: " ++ show (maxTime - diffTime)
                when (diffTime > maxTime) $ do
                    yield $ Disconnect UselessPeer
                    liftIO $ setTitle "timer timed out!"
                    error "Peer did not respond"
            Nothing -> do
              $logInfoS "TimerEvt" $ T.pack "Timestamp is not set"
              return ()

    AbortEvt reason -> do
      $logInfoS "handleEvents/AbortEvt" . T.pack $ "Received AbortEvt: " ++ reason
      yield $ Disconnect AlreadyConnected
    event -> liftIO . error $ "unrecognized event: " ++ show event

numFromRedis :: Maybe RedisBestBlock -> Integer
numFromRedis = \case
    Nothing                     -> 0
    Just (RedisBestBlock _ n _) -> n

-- todo: we should take blockNumber as argument here instead of just looking for
-- bestBlock to prevent us from getting stuck
syncFetch :: (MonadIO m, RBDB.HasRedisBlockDB m, MonadState Context m, MonadLogger m)
          => Direction -> Integer -> ConduitT Event Message m ()
syncFetch d num = do
    blockHeaders' <- lift getBlockHeaders -- get blockHeaders from Context
    when (null blockHeaders') $ do
        mrh <- gets maxReturnedHeaders
        yield $ GetBlockHeaders (BlockNumber num) mrh 0 d
        stampActionTimestamp

shouldSend :: PPeer -> Origin.TXOrigin -> Bool
shouldSend peer tx = case tx of
    Origin.PeerString ps -> ps /= peerString peer
    Origin.API           -> True
    Origin.BlockHash _   -> False
    Origin.Direct        -> True
    Origin.Quarry        -> True -- this should never reach this far anyway
    Origin.Morphism      -> -- probably means it was converted, see if this is a problem
        trace "NewTx of type Morphism came in. Should this even happen?" True
    Origin.Blockstanbul -> False

-- check that the peer is authorized to receive these chain details, by verifying that their
-- IPaddress is associated with one of the Enodes in the chain's member list
checkPeerIsMember :: PPeer -> ChainInfo -> Bool
checkPeerIsMember peer ci =
  case match of
    Nothing -> False
    Just _ -> True
  where
    pIp = readIP $ T.unpack (pPeerIp peer)
    ipList = ipAddress <$> (snd <$> (toList $ members ci))
    match = find (==pIp) ipList

makePairs :: [a] -> [b] -> [(a,b)]
makePairs [] _ = []
makePairs _ [] = []
makePairs (x:xs) (y:ys) = (x,y) : makePairs xs ys
