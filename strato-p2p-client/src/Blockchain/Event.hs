{-# LANGUAGE FlexibleContexts, OverloadedStrings, LambdaCase, ScopedTypeVariables #-}

module Blockchain.Event (
  Event(..),
  handleEvents,
  maxReturnedHeaders,
  getBestKafkaBlockNumber
  ) where

import Control.Arrow ((&&&))
import Control.Exception.Lifted
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.State
import Data.Conduit
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.ByteString             as BS
import qualified Data.ByteString.Char8       as BS8
import qualified Data.ByteString.Base16      as BC16
import Data.Time.Clock

import Blockchain.Colors
import Blockchain.Context
import Blockchain.Data.DataDefs
import Blockchain.Data.Wire
import Blockchain.Data.BlockDB
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockOffset
import Blockchain.Data.NewBlk
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.DB.SQLDB
import Blockchain.EventException
import Blockchain.Format
import Blockchain.SHA
import Blockchain.Stream.VMEvent
import Blockchain.Verification
import Blockchain.DBM
import Blockchain.Data.PubKey

import Blockchain.Sequencer.Event (IngestTx(..), IngestEvent(..), blockToIngestBlock)
import Blockchain.Sequencer.Kafka (writeUnseqEvents)
import Blockchain.EthConf (runKafkaConfigured)

import Blockchain.Util (getCurrentMicrotime)

import Blockchain.Strato.Model.Class
import Blockchain.Strato.RedisBlockDB.Models hiding (Transactions)
import qualified Blockchain.Strato.RedisBlockDB as RBDB

import Debug.Trace (trace) -- yes i know you shouldn't, but its for just one thing that ill really want to know one day

data Event = MsgEvt Message | NewTX RawTransaction | NewBL Block Integer | TimerEvt deriving (Show)

setTitleAndProduceBlocks :: (MonadLogger m, HasSQLDB m, RBDB.HasRedisBlockDB m) => [Block] -> m Int
setTitleAndProduceBlocks blocks = do
    lastVMEvents <- liftIO $ fetchLastVMEvents 200
    let lastBlockHashes = [blockHash b | ChainBlock b <- lastVMEvents]
    let newBlocks = filter (not . (`elem` lastBlockHashes) . blockHash) blocks
    unless (null newBlocks) $ do
        liftIO . setTitle $ "Block #" ++ show (maximum $ map (blockDataNumber . blockBlockData) newBlocks)
        void . produceVMEvents $ map ChainBlock newBlocks
    return $ length newBlocks

-- drop every n-th element from the list
-- e.g. skipEntries 0 [1..20] => [1..20]
--      skipEntries 1 [1..20] => [1,3,5,7,9,11,13,15,17,19]
--      skipEntries 2 [1..20] => [1,4,7,10,13,16,19]
--      skipEntries 3 [1..20] => [1,5,9,13,17]
skipEntries :: Int -> [a] -> [a]
skipEntries n xs = if null xs then [] else head xs : helper (tail xs)
    where helper xs' = case drop n xs' of
                           (y:ys) -> y : helper ys
                           [] -> []

-- todo: seriously???
maxReturnedHeaders :: Int
maxReturnedHeaders = 1000

peerString :: PPeer -> String
peerString peer = key ++ "@" ++ T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer)
    where
        key = p2s (pPeerPubkey peer)
        p2s (Just p) = BS8.unpack . BC16.encode . BS.pack $ pointToBytes p 
        p2s _                    = ""

emitKafkaTransactions :: (MonadIO m, MonadLogger m) => Origin.TXOrigin -> [Transaction] -> m ()
emitKafkaTransactions origin txs = do
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = IETx ts . IngestTx origin <$> txs
    rets <- liftIO $ runKafkaConfigured "strato-p2p-client" $ writeUnseqEvents ingestTxs
    case rets of
        Left e      -> logErrorN . T.pack $ "Could not write txs to Kafka: " ++ show e
        Right resps -> logDebugN . T.pack $ "Kafka commit: " ++ show resps
    return ()

emitKafkaBlock :: (MonadIO m, MonadLogger m) => Origin.TXOrigin -> Block -> m ()
emitKafkaBlock origin baseBlock = do
    let ingestBlock = IEBlock $ blockToIngestBlock origin baseBlock
    rets <- liftIO $ runKafkaConfigured "strato-p2p-client" $ writeUnseqEvents [ingestBlock]
    case rets of
        Left e      -> logErrorN . T.pack $ "Could not write block to Kafka: " ++ show e
        Right resps -> logDebugN . T.pack $ "Kafka commit: " ++ show resps
    return ()

handleEvents :: (MonadIO m, HasSQLDB m, RBDB.HasRedisBlockDB m, MonadState Context m, MonadLogger m)
             =>  DebugMode -> PPeer -> Conduit Event m Message
handleEvents mode peer = awaitForever $ \case
    MsgEvt Hello{}  -> error "A hello message appeared after the handshake"
    MsgEvt Status{} -> error "A status message appeared after the handshake"
    MsgEvt Ping     -> yield Pong

    MsgEvt (Transactions txs) -> do
        let txo = Origin.PeerString (peerString peer)
        _ <- lift $ insertTX mode txo Nothing txs
        emitKafkaTransactions txo txs
        return ()

    MsgEvt (NewBlock block' tdiff) -> do
        liftIO . putStrLn $ "newBlock with tdiff " ++ show tdiff
        lift $ putNewBlk $ blockToNewBlk block' -- todo delete this?
        let sha         = blockHash block'
        let header      = blockHeader block'
        let num         = blockHeaderBlockNumber header
        let parentHash' = blockHeaderParentHash header
        (redisParentHeader :: Maybe BlockData) <- RBDB.withRedisBlockDB (RBDB.getHeader parentHash')
        void $ RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo sha num tdiff) -- todo handle the result
        case redisParentHeader of
            Nothing -> logInfoN "#### New block is missing its parent, I am resyncing" >> syncFetch
            Just _  -> do
                void $  RBDB.withRedisBlockDB $ RBDB.updateWorldBestBlockInfo sha num tdiff
                lift . void $ setTitleAndProduceBlocks [block']
                void $ emitKafkaBlock (Origin.PeerString $ peerString peer) block'

    MsgEvt (NewBlockHashes _) -> syncFetch

    MsgEvt (GetBlockHeaders (BlockNumber start) max' skip' dir) -> case dir of
        Reverse -> do
            maybeHeader :: Maybe BlockHeader <- RBDB.withRedisBlockDB $ RBDB.getCanonicalHeader start
            case maybeHeader of
                Nothing    -> yield (BlockBodies [])
                Just head' -> do
                    let hash' = blockHeaderHash head'
                    chain :: [(SHA, BlockHeader)] <- RBDB.withRedisBlockDB $ RBDB.getHeaderChain hash' max'
                    yield . BlockHeaders . skipEntries skip' $ snd <$> chain
        Forward -> do
            headers <- RBDB.withRedisBlockDB $ RBDB.getCanonicalHeaderChain start max'
            yield . BlockHeaders . skipEntries skip' $ snd <$> headers

    MsgEvt (GetBlockHeaders (BlockHash start) max' skip' dir) -> case dir of
        Reverse -> do
            headers <- RBDB.withRedisBlockDB $ RBDB.getHeaderChain start max'
            yield . BlockHeaders . skipEntries skip' $ snd <$> headers
        Forward -> do
            maybeHeader :: Maybe BlockHeader <- RBDB.withRedisBlockDB $ RBDB.getHeader start
            case maybeHeader of
                Nothing    -> yield (BlockBodies [])
                Just head' -> do
                    let num = blockHeaderBlockNumber head'
                    chain :: [(SHA, BlockHeader)] <- RBDB.withRedisBlockDB $ RBDB.getCanonicalHeaderChain num max'
                    yield . BlockHeaders . skipEntries skip' $ snd <$> chain

    MsgEvt (BlockHeaders headers) -> do
        clearActionTimestamp
        alreadyRequestedHeaders <- lift getBlockHeaders
        when (null alreadyRequestedHeaders) $ do
            let headerHashes = S.fromList $ map headerHash headers
                parentHashes = S.fromList $ map parentHash headers
                allNeeded = headerHashes `S.union` parentHashes
            blockOffsets <- lift $ fmap (map blockOffsetHash) $ getBlockOffsetsForHashes $ S.toList allNeeded
            let neededHeaders = filter (not . (`elem` blockOffsets) . headerHash) headers
                neededHashes = map headerHash neededHeaders
                neededParents = filter (not . (`elem` blockOffsets)) $ map parentHash neededHeaders
                unfoundParents = S.toList $ S.fromList neededParents S.\\ S.fromList neededHashes
            unless (null unfoundParents) $
                error $ "incoming blocks don't seem to have existing parents: " ++ unlines (map format unfoundParents)
            lift $ putBlockHeaders neededHeaders
            logInfoN $ T.pack $ "putBlockHeaders called with length " ++ show (length neededHeaders)
            yield $ GetBlockBodies neededHashes
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
    MsgEvt (GetBlockBodies [])   -> yield (BlockBodies []) -- todo parity bans peers when they do this. should we?
    MsgEvt (GetBlockBodies shas) -> getUntilMissing shas [] >>=  yield . BlockBodies . Prelude.reverse . fmap toBody
        where getUntilMissing :: (RBDB.HasRedisBlockDB m, MonadIO m) => [SHA] -> [Block] -> m [Block]
              getUntilMissing []     bodies = return bodies
              getUntilMissing (h:hs) bodies = RBDB.withRedisBlockDB (RBDB.getBlock h) >>= \case
                  Nothing   -> return bodies
                  Just body -> getUntilMissing hs (body:bodies)

              toBody :: Block -> ([Transaction], [BlockHeader])
              toBody = (blockTransactions &&& fmap morphBlockHeader . blockUncleHeaders)

    -- todo: support the "best effort" behavior that everyone uses for bodies they dont have (mentioned above
    -- todo:
    MsgEvt (BlockBodies []) -> clearActionTimestamp
    MsgEvt (BlockBodies bodies) -> do
        clearActionTimestamp
        headers <- lift getBlockHeaders
        let verified = and $ zipWith (\h b -> transactionsRoot h == transactionsVerificationValue (fst b)) headers bodies
        unless verified $ error "headers don't match bodies"
        logInfoN $ T.pack $ "len headers is " ++ show (length headers) ++ ", len bodies is " ++ show (length bodies)
        let blocks' = zipWith createBlockFromHeaderAndBody headers bodies
        newCount <- lift $ setTitleAndProduceBlocks blocks'
        forM_ blocks' $ lift . emitKafkaBlock (Origin.PeerString $ peerString peer)
        let remainingHeaders = drop (length bodies) headers
        lift $ putBlockHeaders remainingHeaders
        if null remainingHeaders
            then when (newCount > 0) $ do
                yield $ GetBlockHeaders (BlockHash $ headerHash $ last headers) maxReturnedHeaders 0 Forward
                stampActionTimestamp
            else do
                yield $ GetBlockBodies (map headerHash remainingHeaders)
                stampActionTimestamp

    MsgEvt (Disconnect _) -> throwIO PeerDisconnected
    NewTX tx -> when shouldSend . yield $ Transactions [rawTX2TX tx]
        where shouldSend = case rawTransactionOrigin tx of
                Origin.PeerString ps -> ps /= peerString peer
                Origin.API           -> True
                Origin.BlockHash _   -> False
                Origin.Direct        -> True
                Origin.Quarry        -> False -- this should never reach this far anyway
                Origin.Morphism      -> -- probably means it was converted, see if this is a problem
                    trace "NewTx of type Morphism came in. Should this even happen?" True

    NewBL b d -> yield (NewBlock b d)

    TimerEvt -> do
        maybeOldTS <- getActionTimestamp
        case maybeOldTS of
            Just oldTS -> do
                ts <- liftIO getCurrentTime
                liftIO $ setTitle $ "timer: " ++ show (60 - ts `diffUTCTime` oldTS)
                when (ts `diffUTCTime` oldTS > 60) $ do
                    yield $ Disconnect UselessPeer
                    liftIO $ setTitle "timer timed out!"
                    error "Peer did not respond"
            Nothing -> return ()

    event -> liftIO . error $ "unrecognized event: " ++ show event

syncFetch :: (MonadIO m, RBDB.HasRedisBlockDB m, MonadState Context m) => Conduit Event m Message
syncFetch = do
    blockHeaders' <- lift getBlockHeaders
    when (null blockHeaders') $ do
        bestBlock <- RBDB.withRedisBlockDB RBDB.getBestBlockInfo
        let fetchNumber = case bestBlock of
                              Nothing          -> 0
                              Just (RedisBestBlock _ num _) -> num
        yield $ GetBlockHeaders (BlockNumber fetchNumber) maxReturnedHeaders 0 Forward
        stampActionTimestamp
