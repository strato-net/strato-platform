{-# LANGUAGE FlexibleContexts, OverloadedStrings, LambdaCase, ScopedTypeVariables, TemplateHaskell #-}

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
import Data.List
--import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.ByteString             as BS
import qualified Data.ByteString.Char8       as BS8
import qualified Data.ByteString.Base16      as BC16
import Data.Time.Clock
import Network.Kafka as K

import Blockchain.Colors
import Blockchain.Context
import Blockchain.Data.DataDefs
import Blockchain.Data.Wire
import Blockchain.Data.BlockDB
import Blockchain.Data.BlockHeader
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

import Blockchain.Sequencer.Event ( IngestTx(..), IngestEvent(..), OutputEvent(..), OutputTx(..)
                                  , blockToIngestBlock, obTotalDifficulty, outputBlockToBlock
                                  , otBaseTx
                                  )
import Blockchain.Sequencer.Kafka (writeUnseqEvents)

import Blockchain.Util (getCurrentMicrotime)

import Blockchain.Strato.Model.Class
import Blockchain.Strato.RedisBlockDB.Models hiding (Transactions)
import qualified Blockchain.Strato.RedisBlockDB as RBDB

import Debug.Trace (trace) -- yes i know you shouldn't, but its for just one thing that ill really want to know one day

data Event = MsgEvt Message | NewSeqEvent OutputEvent | TimerEvt deriving (Show)

-- MonadBaseControl IO m, MonadIO m
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

emitKafkaTransactions :: (MonadIO m, K.HasKafkaState m, MonadLogger m) => Origin.TXOrigin -> [Transaction] -> m ()
emitKafkaTransactions origin txs = do
    ts <- liftIO getCurrentMicrotime
    let ingestTxs = IETx ts . IngestTx origin <$> txs
    void . withKafkaViolently $ writeUnseqEvents ingestTxs

emitKafkaBlock :: (MonadIO m, K.HasKafkaState m, MonadLogger m) => Origin.TXOrigin -> Block -> m ()
emitKafkaBlock origin baseBlock = do
    let ingestBlock = IEBlock $ blockToIngestBlock origin baseBlock
    void . withKafkaViolently $ writeUnseqEvents [ingestBlock]

handleEvents :: (MonadIO m, HasSQLDB m, RBDB.HasRedisBlockDB m, K.HasKafkaState m, MonadState Context m, MonadLogger m)
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
            Nothing -> do
                bestBlock <- RBDB.withRedisBlockDB RBDB.getBestBlockInfo
                let fetchNumber = numFromRedis bestBlock
                logInfoN . T.pack $ "newBlock :: fetchNumber is " ++ show fetchNumber
                logInfoN "#### New block is missing its parent, I am resyncing" >> syncFetch Forward fetchNumber 
            Just _  -> do
                void $  RBDB.withRedisBlockDB $ RBDB.updateWorldBestBlockInfo sha num tdiff
                lift . void $ setTitleAndProduceBlocks [block']
                void $ emitKafkaBlock (Origin.PeerString $ peerString peer) block'

    MsgEvt (NewBlockHashes _) -> do
        bestBlock <- RBDB.withRedisBlockDB RBDB.getBestBlockInfo
        let fetchNumber = numFromRedis bestBlock
        logInfoN . T.pack $ "newBlockHashes :: fetchNumber is " ++ show fetchNumber
        syncFetch Forward fetchNumber

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
        alreadyRequestedHeaders <- lift getBlockHeaders -- get already requested headers
        when (null alreadyRequestedHeaders) $ do        -- proceed if we are not already requesting headers
            -- let headerHashes = S.fromList $ map headerHash headers
            --     parentHashes = S.fromList $ map parentHash headers
            --     allNeeded = headerHashes `S.union` parentHashes

            -- check if blockheaders we recieved have parents.  
            parentsInDB :: [(SHA, Maybe BlockHeader)] <- RBDB.withRedisBlockDB . RBDB.getHeaders $ parentHash <$> headers 
            let existingParents = [(sha, x) | (sha, Just x) <- parentsInDB]
            let missingParents  = [sha | (sha, Nothing) <- parentsInDB]
            unless (null missingParents) $ do
                 bestBlock <- RBDB.withRedisBlockDB RBDB.getBestBlockInfo
                 let fetchNumber = numFromRedis bestBlock
                 logInfoN . T.pack $ "blockHeaders :: fetchNumber is " ++ show fetchNumber
                 let lastParent = head . sort $ blockHeaderBlockNumber . snd <$> existingParents
                 (logInfoN $ T.pack $ "missing blocks: " ++ (unlines $ format <$> missingParents)) >> syncFetch Reverse lastParent
           
            -- todo: try with (&&&)
            headersInDB :: [(SHA, Maybe BlockHeader)] <- RBDB.withRedisBlockDB . RBDB.getHeaders $ headerHash <$> headers
            let neededHeaders = filter (\x -> (headerHash x) `elem` [sha | (sha, Nothing) <- headersInDB]) headers
            
            -- blockOffsets <- lift $ fmap (map blockOffsetHash) $ getBlockOffsetsForHashes $ S.toList allNeeded
            -- let neededHeaders = filter (not . (`elem` blockOffsets) . headerHash) headers
            --     neededHashes = map headerHash neededHeaders
            --     neededParents = filter (not . (`elem` blockOffsets)) $ map parentHash neededHeaders
            --     unfoundParents = S.toList $ S.fromList neededParents S.\\ S.fromList neededHashes
            -- unless (null unfoundParents) $ do
            --     -- logInfoN . T.pack $ "neededHashes: " ++ unlines (map format neededHashes)
            --     logInfoN . T.pack $ "incoming blocks don't seem to have existing parents: " ++ unlines (map format unfoundParents)
            --     logInfoN "### calling syncFetch again" >> syncFetch
            
            lift $ putBlockHeaders neededHeaders
            logInfoN $ T.pack $ "putBlockHeaders called with length " ++ show (length neededHeaders)
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
    
    NewSeqEvent oe -> case oe of 
            -- todo: use shouldSend here, to make sure we don't send back block
            -- to peer we got it from
            OEBlock b  -> do
                $logInfoS "NewSeqEvent.block" . T.pack $ "yielding new block: " ++ show (blockDataNumber . blockBlockData . outputBlockToBlock $ b)
                yield $ NewBlock (outputBlockToBlock b) (obTotalDifficulty b)
            OETx ts tx -> do
                $logInfoS "NewSeqEvent.tx" . T.pack $ "yielding new tx: " ++ format tx ++ " at " ++ show ts
                when (shouldSend peer tx) . yield $ Transactions [tx'] where
                    tx' = otBaseTx $ tx
            _          -> return () -- shouldn't happen but our types don't prohibit us 

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

numFromRedis :: Maybe RedisBestBlock -> Integer
numFromRedis = \case
    Nothing                     -> 0
    Just (RedisBestBlock _ n _) -> n

-- todo: we should take blockNumber as argument here instead of just looking for
-- bestBlock to prevent us from getting stuck
syncFetch :: (MonadIO m, RBDB.HasRedisBlockDB m, MonadState Context m, MonadLogger m) 
          => Direction -> Integer -> Conduit Event m Message
syncFetch d num = do
    blockHeaders' <- lift getBlockHeaders -- get blockHeaders from Context
    when (null blockHeaders') $ do
        yield $ GetBlockHeaders (BlockNumber num) maxReturnedHeaders 0 d 
        stampActionTimestamp

shouldSend :: PPeer -> OutputTx -> Bool 
shouldSend peer tx = case otOrigin tx of
    Origin.PeerString ps -> ps /= peerString peer
    Origin.API           -> True
    Origin.BlockHash _   -> False
    Origin.Direct        -> True
    Origin.Quarry        -> False -- this should never reach this far anyway
    Origin.Morphism      -> -- probably means it was converted, see if this is a problem
        trace "NewTx of type Morphism came in. Should this even happen?" True

