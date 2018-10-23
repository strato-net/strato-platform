{-# LANGUAGE BangPatterns      #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Executable.EthereumVM (
  ethereumVM
) where

import           Control.Lens                          ((.=), (||=), use)
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans.State.Lazy        (gets)
import qualified Data.Text                             as T
import qualified Data.Map                              as M
import           Data.Maybe                            (isNothing)
import qualified Data.ByteString                       as BS
import qualified Blockchain.MilenaTools                as K
import qualified Network.Kafka.Protocol                as KP
import           Text.Printf

import           Blockchain.BlockChain
import           Blockchain.Data.DataDefs              (blockDataNumber)
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.GenesisBlock
import           Blockchain.Data.LogDB
import           Blockchain.Data.TransactionResult
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.ChainDB
import           Blockchain.EthConf
import           Blockchain.Format                     (format)
import           Blockchain.JsonRpcCommand
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Stream.UnminedBlock        (produceUnminedBlocksM)
import           Blockchain.VMContext
import           Blockchain.VMOptions

import           Executable.EVMCheckpoint
import           Executable.EVMFlags

import qualified Blockchain.Bagger                     as Bagger
import qualified Blockchain.Bagger.BaggerState         as B
import           Blockchain.Strato.Indexer.Kafka       (writeIndexEvents)
import           Blockchain.Strato.Indexer.Model       (IndexEvent (..))
import           Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models
import           Blockchain.Strato.StateDiff.Kafka     (writeActionJSONToKafka)
import           Blockchain.Util                       (getCurrentMicrotime, secondsToMicrotime)

ethereumVM :: LoggingT IO ()
ethereumVM = void . execContextM $ do

    $logInfoS "difficultyBomb" $ T.pack $ "Difficulty bomb is " ++ show flags_difficultyBomb -- remove me once we figure out how to print args at startup

    let makeLazyBlocks = lazyBlocks $ quarryConfig ethConf
    Bagger.setCalculateIntrinsicGas calculateIntrinsicGas'
    (cpOffsetStart, EVMCheckpoint cpHash cpHead cpBBI) <- getCheckpoint
    putContextBestBlockInfo cpBBI
    bootstrapChainDB cpHash -- TODO: Move main chain genesis block creation to strato-genesis, and move this there too
    Bagger.processNewBestBlock cpHash cpHead [] -- bootstrap Bagger with genesis block

    $logInfoS "evm/preLoop" $ T.pack $ "cpOffset = " ++ show cpOffsetStart
    let microtimeCutoff = secondsToMicrotime flags_mempoolLivenessCutoff
    forever $ do
        cpOffset <- getCheckpointNoMetadata
        $logInfoS "evm/loop" "Getting Blocks/Txs"
        seqEvents <- getUnprocessedKafkaEvents cpOffset

        !currentMicrotime <- liftIO getCurrentMicrotime
        $logInfoS "evm/loop" $ T.pack $ "currentMicrotime :: " ++ show currentMicrotime

        insertNewChains seqEvents

        let newCommands = [c | OEJsonRpcCommand c <- seqEvents]
        forM_ newCommands runJsonRpcCommand

        let allTxs = [OETx ts t | OETx ts t <- seqEvents]
        $logDebugS "evm/loop" $ T.pack $ "allTxs :: " ++ show allTxs
        let allNewTxs = [(ts, t) | OETx ts t <- allTxs, isNothing (txChainId $ otBaseTx t)] -- PrivateHashTXs have chainId = Nothing
        forM_ allNewTxs $ \(ts, _) ->
            $logInfoS "evm/loop/allNewTxs" $ T.pack $ "math :: " ++ show currentMicrotime ++ " - " ++ show ts ++ " = " ++ show (currentMicrotime - ts) ++ "; <= " ++ show microtimeCutoff ++ "? " ++ show ((currentMicrotime - ts) <= microtimeCutoff)
        let poolableNewTxs = [t | (ts, t) <- allNewTxs, abs (currentMicrotime - ts) <= microtimeCutoff]
        $logInfoS "evm/loop" (T.pack ("adding " ++ show (length poolableNewTxs) ++ "/" ++ show (length allNewTxs) ++ " txs to mempool"))
        unless (null poolableNewTxs) $ Bagger.addTransactionsToMempool poolableNewTxs

        let blocks = [b | OEBlock b <- seqEvents]
        $logInfoS "evm/loop" $ T.pack $ "Running " ++ show (length blocks) ++ " blocks"
        forM_ blocks $ \b -> do
            let number = blockDataNumber . obBlockData $ b
                txCount = length . obReceiptTransactions $ b
            $logDebugS "evm/loop" . T.pack $ "Received block number " ++ show number ++ " with " ++ show txCount ++ " transactions from seqEvents"
            writeBlockSummary b
        actions <- addBlocks blocks

        contextBlockRequested ||= (OECreateBlockCommand `elem` seqEvents)
        -- todo: perhaps we shouldnt even add TXs to the mempool, it might make for a VERY large checkpoint
        -- todo: which may fail
        isCaughtUp <- shouldProcessNewTransactions
        state <- Bagger.getBaggerState
        pbft <- gets contextHasBlockstanbul
        reqd <- use contextBlockRequested
        let pending = B.pending state
            hasTxs = not (null poolableNewTxs) || not (M.null pending)
            shouldOutputBlocks = isCaughtUp && (
              if pbft
                then reqd && hasTxs
                else not makeLazyBlocks || hasTxs)
        $logInfoS "evm/loop/newBlock" . T.pack $ printf "Num poolable: %d, num pending: %d"
            (length poolableNewTxs) (M.size pending)
        $logInfoS "evm/loop/newBlock" . T.pack $ "Decision making for block creation: " ++
            "(isCaughtUp, pbft, reqd, hasTxs, makeLazyBlocks, shouldOutputBlocks) = " ++ show
             (isCaughtUp, pbft, reqd, hasTxs, makeLazyBlocks, shouldOutputBlocks)
        when (pbft && shouldOutputBlocks) $
          contextBlockRequested .= False
        $logDebugS "evm/loop/newBlock" $ T.pack $ "Queued: " ++ show (length poolableNewTxs)
        $logDebugS "evm/loop/newBlock" $ T.pack $ "Pending: " ++ show (length pending)
        when shouldOutputBlocks $ do
            $logInfoS "evm/loop/newBlock" "calling Bagger.makeNewBlock"
            newBlock <- Bagger.makeNewBlock
            $logInfoS "evm/loop/newBlock" "calling produceUnminedBlocksM"
            K.withKafkaViolently (produceUnminedBlocksM [outputBlockToBlock newBlock])

        -- todo: is this the best place to put this?
        flushLogEntries
        flushTransactionResults
        void . K.withKafkaViolently $ writeActionJSONToKafka actions

        let newOffset = cpOffset + fromIntegral (length seqEvents)
        baggerData <- uncurry EVMCheckpoint <$> Bagger.getCheckpointableState
        checkpointData <- baggerData <$> getContextBestBlockInfo
        setCheckpoint newOffset checkpointData

insertNewChains :: [OutputEvent] -> ContextM ()
insertNewChains events = do
  let newChainInfos = [c | OEGenesis (OutputGenesis _ c) <- events]

  newChains <- forM newChainInfos $ \(cId, cInfo) -> do
    sr <- chainInfoToGenesisState cInfo
    mGSR <- getGenesisStateRoot cId
    case mGSR of
      Just _ -> return [] -- error $ "ethereumVM.getGenesisStateRoot: chain "
      Nothing -> do
        initializeChainDBs cId cInfo sr -- only needed to update Postgres with chain info for API calls
        putGenesisStateRoot cId sr >> return [(cId, cInfo)]

  void . K.withKafkaViolently . writeIndexEvents . map (uncurry NewChainInfo) $ concat newChains

consumerGroup :: KP.ConsumerGroup
consumerGroup = lookupConsumerGroup "ethereum-vm"

getFirstBlockFromSequencer :: ContextM OutputBlock
getFirstBlockFromSequencer = do
    (OEBlock block) <- head <$> getUnprocessedKafkaEvents (KP.Offset 0)
    return block

-- this one starts at 1, 0 is reserved for genesis block and is used to
-- bootstrap a ton of this
-- Also seeds the BlockSummaryDatabase
initializeCheckpointAndBlockSummary :: ContextM ()
initializeCheckpointAndBlockSummary = do
    block <- getFirstBlockFromSequencer
    writeBlockSummary  block
    let sha    = outputBlockHash block
        header = obBlockData block
        txs    = obReceiptTransactions block
        td     = obTotalDifficulty block
        txL    = length txs
        uncL   = length (obBlockUncles block)
        cbbi   = ContextBestBlockInfo (sha, header, td, txL, uncL)
    setCheckpoint 1 (EVMCheckpoint sha header cbbi)


writeBlockSummary :: OutputBlock -> ContextM ()
writeBlockSummary block =
    let sha    = outputBlockHash block
        header = obBlockData block
        td     = obTotalDifficulty block
        txCnt  = fromIntegral $ length (obReceiptTransactions block)
    in
        putBSum sha (blockHeaderToBSum header td txCnt)

getCheckpoint :: ContextM (KP.Offset, EVMCheckpoint)
getCheckpoint = do
    let topic  = seqVmEventsTopicName
        topic' = show topic
        cg'    = show consumerGroup
    $logInfoS "getCheckpoint" . T.pack $ "Getting checkpoint for " ++ topic' ++ "#0 for " ++ cg'
    K.withKafkaRetry1s (K.fetchSingleOffset consumerGroup topic 0) >>= \case
        Left KP.UnknownTopicOrPartition -> initializeCheckpointAndBlockSummary >> getCheckpoint
        Left err -> error $ "Unexpected response when fetching checkpoint: " ++ show err
        Right (ofs, md) -> do
            let md' = fromKafkaMetadata md
            $logInfoS "getCheckpoint" . T.pack $ show ofs ++ " / " ++ format md'
            return (ofs, md')

getCheckpointNoMetadata :: ContextM KP.Offset
getCheckpointNoMetadata = do
    let topic  = seqVmEventsTopicName
        topic' = show topic
        cg'    = show consumerGroup
    $logInfoS "getCheckpointNoMetadata" . T.pack $ "Getting checkpoint for " ++ topic' ++ "#0 for " ++ cg'
    K.withKafkaViolently (K.fetchSingleOffset consumerGroup topic 0) >>= \case
        Left KP.UnknownTopicOrPartition -> setCheckpointNoMetadata 1 >> getCheckpointNoMetadata
        Left err -> error $ "Unexpected response when fetching checkpoint: " ++ show err
        Right (ofs, _) -> do
            return ofs


setCheckpoint :: KP.Offset -> EVMCheckpoint -> ContextM ()
setCheckpoint ofs checkpoint = do
    $logInfoS "setCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs ++ " / " ++ format checkpoint
    let kMetadata = toKafkaMetadata checkpoint
    ret  <- K.withKafkaViolently $ K.commitSingleOffset consumerGroup seqVmEventsTopicName 0 ofs kMetadata
    either (error . show) return ret

setCheckpointNoMetadata :: KP.Offset -> ContextM ()
setCheckpointNoMetadata ofs = do
    $logInfoS "setCheckpointNoMetadata" . T.pack $ "Setting checkpoint to " ++ show ofs
    let emptyMetadata = KP.Metadata $ KP.KString BS.empty
    ret  <- K.withKafkaViolently $ K.commitSingleOffset consumerGroup seqVmEventsTopicName 0 ofs emptyMetadata
    either (error . show) return ret

getUnprocessedKafkaEvents :: KP.Offset -> ContextM [OutputEvent]
getUnprocessedKafkaEvents offset = do
    $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Fetching sequenced blockchain events with offset " ++ show offset
    ret <- K.withKafkaViolently (readSeqVmEvents offset)
    $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Got: " ++ show (length ret) ++ " unprocessed blocks/txs"
    return ret

shouldProcessNewTransactions :: ContextM Bool -- todo: probably shouldn't do it by number, but tdiff.
shouldProcessNewTransactions =
    if flags_useSyncMode then do
        worldBestBlock <- RBDB.withRedisBlockDB RBDB.getWorldBestBlockInfo
        case worldBestBlock of
            Nothing -> do
                $logInfoS "shouldProcessNewTransactions" "got Nothing from worldBestBlockInfo, playing it safe and not mining Txs"
                return False -- we either had no peers or some other error, lets play it safe
            Just (RedisBestBlock worldBestSha _ _) -> do
                didRunBest <- hasBSum worldBestSha
                let msg =
                      if didRunBest
                      then "found blockSummary for worldBestSha " ++ format worldBestSha ++ ", will mine"
                      else "A peer has claimed that block hash " ++ format worldBestSha ++ " is the best block, but we don't have this block yet. We are behind, mining is futile, bagger is shutting down (until we are caught up)."
                $logInfoS "shouldProcessNewTransactions" (T.pack msg)
                return didRunBest  -- todo, verify TDiff etc.
    else do
        $logInfoS "shouldProcessNewTransactions" "flags_useSyncMode == false, will process all new TXs"
        return True
