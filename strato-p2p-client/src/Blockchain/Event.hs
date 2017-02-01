{-# LANGUAGE FlexibleContexts, OverloadedStrings, LambdaCase #-}

module Blockchain.Event (
  Event(..),
  handleEvents,
  maxReturnedHeaders,
  getBestKafkaBlockNumber
  ) where

import Control.Exception.Lifted
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.State
import Data.Conduit
import Data.List
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Time.Clock
import Network.Kafka.Protocol (Offset)

import Control.Arrow ((&&&))

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

import Blockchain.Sequencer.Event (IngestTx(..), IngestEvent(..), blockToIngestBlock)
import Blockchain.Sequencer.Kafka (writeUnseqEvents)
import Blockchain.EthConf (runKafkaConfigured)

import Blockchain.Util (getCurrentMicrotime)

import qualified Blockchain.Strato.RedisBlockDB as RBDB

import Debug.Trace (trace)

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

-- todo: seriously???
fetchLimit :: Offset
fetchLimit = 50

filterRequestedBlocks :: [SHA] -> [Block] -> [Block]
filterRequestedBlocks _ [] = []
filterRequestedBlocks [] _ = []
filterRequestedBlocks (h:hRest) (b:bRest) | blockHash b == h = b:filterRequestedBlocks hRest bRest
filterRequestedBlocks hashes (_:bRest) = filterRequestedBlocks hashes bRest

-- todo: seriously???
maxReturnedHeaders :: Int
maxReturnedHeaders=1000

peerString :: PPeer -> String
peerString peer = show (pPeerPubkey peer) ++ "@" ++ T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer)

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

    MsgEvt (NewBlock block' _) -> do
        lift $ putNewBlk $ blockToNewBlk block' -- todo delete this?
        let parentHash' = blockDataParentHash $ blockBlockData block'
        blockOffsets <- lift $ getBlockOffsetsForHashes [parentHash']
        case blockOffsets of
            [x] | blockOffsetHash x == parentHash' -> do
                lift . void $ setTitleAndProduceBlocks [block']
                void $ emitKafkaBlock (Origin.PeerString $ peerString peer) block'
            _ -> logInfoN "#### New block is missing its parent, I am resyncing" >> syncFetch

    MsgEvt (NewBlockHashes _) -> syncFetch

    MsgEvt (GetBlockHeaders start max' 0 Forward) -> do
        blockOffsets <-
            case start of
                BlockNumber n -> lift $ fmap (map blockOffsetOffset) $ getBlockOffsetsForNumber $ fromIntegral n
                BlockHash h -> lift $ getOffsetsForHashes [h]
        logInfoN $ T.pack $ "blockOffsets: " ++ show blockOffsets
        blocks <-
            case blockOffsets of
                [] -> return []
                (blockOffset:_) -> do
                    vmEvents <- liftIO $ fromMaybe [] <$> fetchVMEventsIO (fromIntegral blockOffset)
                    return [b | ChainBlock b <- vmEvents]
        let blocksWithHashes = (blockHash &&& id) <$>  blocks
        existingHashes <- lift $ fmap (map blockOffsetHash) $ getBlockOffsetsForHashes $ map fst blocksWithHashes
        let existingBlocks = snd <$> filter ((`elem` existingHashes) . fst) blocksWithHashes
        yield . BlockHeaders . nub . map blockToBlockHeader  . take max' $ existingBlocks
        return ()

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

    MsgEvt (GetBlockBodies []) -> yield $ BlockBodies []
    MsgEvt (GetBlockBodies headers@(first:_)) -> lift (getOffsetsForHashes [first]) >>= \case
        [] -> do
            logInfoN $ T.pack $ "########### Warning: peer is asking for a block I don't have: " ++ format first
            yield $ BlockBodies []
        (o:_) -> do
            vmEvents <- liftIO $ fromMaybe crashViolentlyWithNoRegardForHumanLife <$> fetchVMEventsIO (fromIntegral o)
            let blocks = [b | ChainBlock b <- vmEvents]
            let requestedBlocks = filterRequestedBlocks headers blocks
            yield $ BlockBodies $ map blockToBody requestedBlocks

        where crashViolentlyWithNoRegardForHumanLife = error
                  "Internal error: an offset in SQL points to a value ouside of the block stream."

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

syncFetch :: (MonadIO m, MonadState Context m) => Conduit Event m Message
syncFetch = do
    blockHeaders' <- lift getBlockHeaders
    when (null blockHeaders') $ do
        lastVMEvents <- liftIO $ fetchLastVMEvents fetchLimit
        let lastBlocks = [b | ChainBlock b <- lastVMEvents]
        if null lastBlocks
            then error "overflow in syncFetch"
            else do
                let lastBlockNumber = blockDataNumber . blockBlockData . last $ lastBlocks
                yield $ GetBlockHeaders (BlockNumber lastBlockNumber) maxReturnedHeaders 0 Forward
                stampActionTimestamp
