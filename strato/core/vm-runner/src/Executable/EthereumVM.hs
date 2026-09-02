{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Executable.EthereumVM
  ( ethereumVM,
    bootstrapIfFirstRun,
    initializeBestBlock,
    routeOutEvents,
    seedDatabases,
    sendOutEvent,
  )
where

import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Bagger.Transactions as Flush
import Blockchain.BlockDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB ()
import Blockchain.DB.StateDB (setStateDBStateRoot)
import Blockchain.Data.AddressStateDB ()
import Blockchain.Data.GenesisBlock (genesisInfoToBlock)
import Blockchain.Data.GenesisInfo (stateRoot, getGenesisInfo)
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Bootstrap
import Blockchain.Database.MerklePatricia.NodeData ()
import Blockchain.Database.MerklePatricia.Profile
import Blockchain.EthConf
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Event
import Blockchain.JsonRpcCommand
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.PhaseProfile
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.StateRootMismatch
import Blockchain.Strato.Indexer.Kafka (produceEncodedIndexEvents, produceIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Address ()
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.StateRoot ()
import Blockchain.Strato.RedisBlockDB
import Blockchain.Strato.StateDiff          (stateDiff')
import Blockchain.Stream.VMEvent
import Blockchain.SyncDB
import Blockchain.Timing
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.Wiring
import Conduit hiding (Flush)
import Control.DeepSeq (force)
import Control.Exception (evaluate)
import Control.Monad
import Control.Monad.Change.Alter ()
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Streaming
import qualified Data.Binary as Bin
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Foldable hiding (fold)
import Data.List
import Data.Maybe
import qualified Data.Text as T
import Executable.EthereumVM2
import Text.Format (format)

ethereumVM :: LoggingT IO ()
ethereumVM = runResourceT $ do
  ctx <- initBatchedContext
  void . runStreamMConfigured "ethereum-vm" $ execContextM' ctx $ do
--    Bagger.setCalculateIntrinsicGas $ \i otx -> toInteger (calculateIntrinsicGas' i otx)

    bootstrapIfFirstRun

    initializeBestBlock

    failures <- runConsume consumerGroup seqVmTasksTopicName $ \seqEvents -> do

        let maybeSelfAddress = listToMaybe [ addr | VmSelfAddress addr <- toList seqEvents ]
        $logInfoS "ethereumVM/maybeSelfAddress" $ T.pack $ format maybeSelfAddress
        case maybeSelfAddress of
          Just x -> contextModify' $ \cs@(ContextState{}) -> cs{_selfAddress = x}
          Nothing -> pure ()

        -- Handle flush mempool events immediately
        forM_ seqEvents $ \event -> case event of
          VmFlushMempool req -> handleVmFlushMempool req
          _ -> return ()

        recordBaggerMetrics =<< contextGets _baggerState
        logEventSummaries seqEvents

        let !vmInEventBatch = foldr insertInBatch newInBatch seqEvents
        -- Keep the state/output/offset ordering crash-safe.  Merkle writes are
        -- accumulated while this bounded input batch executes, made durable,
        -- and only then are its outputs published.  runConsume advances the
        -- input checkpoint after this callback returns.
        outEvents <- runConduit $
          yield vmInEventBatch
            .| handleVmTasks
            .| sinkList
        finalizePendingMPNodes
        failures <- fmap concat . runConduit $
          yieldMany outEvents
            .| routeOutEvents
            .| sinkList

        loopTimeit "compactContextM" $ compactContextM

        return $ if null failures then Nothing else Just failures

    for_ failures $ \(BlockVerificationFailure bNum bHash bDetails) -> case bDetails of
      StateRootMismatch BlockDelta{..} -> do
        let err = "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format _inBlock
        runStateRootMismatchM $ do
          sd <- runConduit $ stateDiff' Nothing bNum bHash _inBlock _derived
             .| headDefC (error $ err ++ "\nError encountered while analyzing stateRoot mismatch")
          $logErrorS "ethereumVM/StateRootMismatch" . T.pack $ formatStateRootMismatch sd
      ValidatorMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "There was a validator mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "New validators found in block header:        " ++ show (fst _inBlock)
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "New validators found from running block:     " ++ show (fst _derived)
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "Removed validators found in block header:    " ++ show (snd _inBlock)
        $logErrorS "ethereumVM/ValidatorMismatch" . T.pack $ "Removed validators found from running block: " ++ show (snd _derived)
      StakeMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/StakeMismatch" . T.pack $ "There was a stake update mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash
        $logErrorS "ethereumVM/StakeMismatch" . T.pack $ "Stake updates found in block header:    " ++ show _inBlock
        $logErrorS "ethereumVM/StakeMismatch" . T.pack $ "Stake updates found from running block: " ++ show _derived
      RoundMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/RoundMismatch" . T.pack $ "Block #" ++ show bNum ++ ", hash " ++ format bHash ++ " has PBFT round " ++ show _inBlock ++ " behind its parent's round " ++ show _derived
      VersionMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/InvalidVersion" . T.pack $ "There was a block header version mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash
        $logErrorS "ethereumVM/InvalidVersion" . T.pack $ "Block header version found in block header:      " ++ show _inBlock
        $logErrorS "ethereumVM/InvalidVersion" . T.pack $ "Latest supported block header version by system: " ++ show _derived
      UnclesMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/UnclesMismatch" . T.pack $ "There was a mismatch between uncles in block #" ++ show bNum
        $logErrorS "ethereumVM/UnclesMismatch" . T.pack $ "Received uncle hashes: " ++ format _inBlock
        $logErrorS "ethereumVM/UnclesMismatch" . T.pack $ "But expected: " ++ format _derived
      UnexpectedBlockNumber BlockDelta{..} -> do
        $logErrorS "ethereumVM/UnexpectedBlockNumber" . T.pack $ "Expected block number: " ++ show _derived
        $logErrorS "ethereumVM/UnexpectedBlockNumber" . T.pack $ "But actually received: " ++ show _inBlock
      ReceiptsRootMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/ReceiptsRootMismatch" . T.pack $ "Receipts root mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash
        $logErrorS "ethereumVM/ReceiptsRootMismatch" . T.pack $ "Receipts root in block header: " ++ format _inBlock
        $logErrorS "ethereumVM/ReceiptsRootMismatch" . T.pack $ "Derived receipts root:         " ++ format _derived
    error "STRATO vm-runner encountered errors while verifying a block in the chain. Please review the logs above for more information."

bootstrapIfFirstRun :: (VMBase m, HasContext m, Mod.Accessible RedisConnection m) => m ()
bootstrapIfFirstRun = do
  genesisInfo <- getGenesisInfo
  let genesisBlock = genesisInfoToBlock genesisInfo
      genesisHash = blockHash genesisBlock
  maybeGenesisStateRoot <- getChainStateRoot Nothing genesisHash
  case maybeGenesisStateRoot of -- If first run, then bootstrap
    Nothing -> withCurrentBlockHash genesisHash $ do
      $logInfoS "bootstrap" "Bootstrapping"
      bootstrapChainDB genesisHash $ stateRoot genesisInfo
      setStateDBStateRoot Nothing  $ stateRoot genesisInfo
      seedDatabases genesisBlock
      populateStorageDBs genesisInfo genesisBlock Nothing
    Just _ -> $logInfoS "bootstrap" "Bootstrapping not needed"

initializeBestBlock :: (HasContext m, Mod.Accessible RedisConnection m, Bagger.MonadBagger m) => m ()
initializeBestBlock = do
  maybeRedisBestBlockHash <- fmap (fmap bestBlockHash) (withRedisBlockDB getBestBlockInfo)
  maybeRedisBestBlock <-
    case maybeRedisBestBlockHash of
      Nothing -> error "no best block hash in redisdb"
      Just hash -> withRedisBlockDB $ getBlock hash

  case maybeRedisBestBlock of
    Nothing -> error "no best block in redisdb"
    Just redisBestBlock -> do
      putContextBestBlockInfo $ outputBlockToContextBestBlockInfo redisBestBlock

      Bagger.processNewBestBlock (blockHeaderHash $ obBlockData redisBestBlock) (obBlockData redisBestBlock) [] -- bootstrap Bagger with genesis block



outputBlockToContextBestBlockInfo :: OutputBlock -> ContextBestBlockInfo
outputBlockToContextBestBlockInfo block =
  let header = obBlockData block
      txs = obReceiptTransactions block
      txL = length txs
  in ContextBestBlockInfo (blockHeaderHash header) header txL

logEventSummaries :: MonadLogger m => [VmTask] -> m ()
logEventSummaries evs = do
  let names = map getNames evs
      numberedNames = map (\case [] -> []; x@(x0:_) -> numberIt (length x) x0) $ group $ sort names

  $logInfoS "logEventSummaries" . T.pack $
    "#### Got: " ++ intercalate ", " numberedNames -- show numTXs ++ "TXs, " ++ show numBlocks ++ " blocks"
  where
    getNames :: VmTask -> String
    getNames (VmTx _ _) = "TX"
    getNames (VmBlock _) = "Block"
    getNames (VmJsonRpcCommand _) = "JsonRpcCommand"
    getNames (VmGetMPNodesRequest _ _) = "GetMPNodesRequest"
    getNames (VmMPNodesReceived _) = "MPNodesReceived"
    getNames (VmRunPreprepare _) = "VmRunPreprepare"
    getNames (VmSelfAddress _) = "VmSelfAddress"
    getNames (VmFlushMempool _) = "FlushMempool"

    numberIt :: Int -> String -> String
    numberIt 1 x = "1 " ++ x
    numberIt i x = show i ++ " " ++ x ++ "s"

-- KAFKA

-- | Preserve the order within each Kafka topic while batching a VM input
-- batch into bounded produce calls.  The old mapMaybeM route called the
-- synchronous producer once for every RanBlock/NewAction, even though the
-- producer already knows how to encode and chunk a list.  We flush before
-- non-Kafka side effects and before returning to runConsume, so its offset is
-- not advanced until every accumulated output has been acknowledged.
routeOutEvents ::
  (MonadLogger m, HasStreaming m, HasContext m) =>
  ConduitT VmOutEvent [BlockVerificationFailure] m ()
routeOutEvents = go [] [] 0
  where
    maxPendingItems = 256 :: Int

    go vmEvents indexEvents pendingCount = await >>= \case
      Nothing -> flush vmEvents indexEvents
      Just event -> case event of
        OutVMEvents events ->
          continue (foldl' (flip (:)) vmEvents events) indexEvents (pendingCount + length events)
        OutIndexEvent indexEvent ->
          continue vmEvents (indexEvent : indexEvents) (pendingCount + 1)
        OutStateDiff diff ->
          continue vmEvents (StateDiffEntry diff : indexEvents) (pendingCount + 1)
        OutLog logEntry ->
          continue vmEvents (LogDBEntry logEntry : indexEvents) (pendingCount + 1)
        OutEvent events ->
          let entries = EventDBEntry <$> events
           in continue vmEvents (foldl' (flip (:)) indexEvents entries) (pendingCount + length entries)
        OutASM asm
          | not (Conf.sqlDiff $ Conf.vmConfig ethConf) ->
              continue vmEvents (AddressStateUpdates asm : indexEvents) (pendingCount + 1)
        OutBlockVerificationFailure failures -> do
          flush vmEvents indexEvents
          yield failures
          go [] [] 0
        other -> do
          flush vmEvents indexEvents
          sendOutEvent other
          go [] [] 0

    continue vmEvents indexEvents pendingCount
      | pendingCount >= maxPendingItems = flush vmEvents indexEvents >> go [] [] 0
      | otherwise = go vmEvents indexEvents pendingCount

    flush vmEvents indexEvents = do
      unless (null vmEvents && null indexEvents) $
        sendProfiledTopicItems (reverse vmEvents) (reverse indexEvents)

sendProfiledTopicItems ::
  (MonadLogger m, HasStreaming m) =>
  [VMEvent] ->
  [IndexEvent] ->
  m ()
sendProfiledTopicItems vmEvents indexEvents = do
  vmPayloads <- encodeProfiledItems "vmevents" vmEvents
  indexPayloads <- encodeProfiledItems "indexevents" indexEvents
  let taggedPayloads = map Left vmPayloads ++ map Right indexPayloads
  profilePhase EventKafkaEnqueue . mapM_ produceBatch $ chunkPayloads taggedPayloads
  where
    produceBatch payloads =
      void $
        produceToTopics
          [ ("vmevents", [payload | Left payload <- payloads]),
            ("indexevents", [payload | Right payload <- payloads])
          ]

    chunkPayloads = go [] 0 0
      where
        go [] _ _ [] = []
        go current _ _ [] = [reverse current]
        go current count bytes remaining@(item : rest)
          | not (null current)
              && (count >= maxProduceBatchItems || bytes + payloadLength item > maxProduceBatchBytes) =
              reverse current : go [] 0 0 remaining
          | otherwise =
              go (item : current) (count + 1) (bytes + payloadLength item) rest

    payloadLength = either B.length B.length
    maxProduceBatchItems :: Int
    maxProduceBatchItems = 256
    maxProduceBatchBytes :: Int
    maxProduceBatchBytes = 2 * 1024 * 1024

sendOutEvent :: (MonadLogger m, HasStreaming m, HasContext m) => VmOutEvent -> m ()
sendOutEvent (OutVMEvents vmes) = sendProfiledItems "vmevents" produceVMEvents produceEncodedVMEvents vmes
sendOutEvent (OutIndexEvent e) = sendProfiledItems "indexevents" produceIndexEvents produceEncodedIndexEvents [e]
sendOutEvent (OutStateDiff diff) = sendProfiledItems "indexevents" produceIndexEvents produceEncodedIndexEvents [StateDiffEntry diff]
sendOutEvent (OutLog l) = loopTimeit "flushLogEntries" $ sendProfiledItems "indexevents" produceIndexEvents produceEncodedIndexEvents [LogDBEntry l]
sendOutEvent (OutEvent e) = loopTimeit "flushEventEntries" $ sendProfiledItems "indexevents" produceIndexEvents produceEncodedIndexEvents (EventDBEntry <$> e)
sendOutEvent (OutASM asm) =
  when (not $ Conf.sqlDiff $ Conf.vmConfig ethConf) $
    timeit "produceAddressStateUpdates" (Just vmBlockInsertionMined) $
      sendProfiledItems "indexevents" produceIndexEvents produceEncodedIndexEvents [AddressStateUpdates asm]
sendOutEvent (OutJSONRPC r) = produceResponse r
sendOutEvent (OutBlock o) = void $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry $ outputBlockToBlock o]
sendOutEvent (OutBlockVerificationFailure _) = pure ()
sendOutEvent (OutGetMPNodes mpNodes) = void $ writeUnseqEvents [IEGetMPNodes mpNodes]
sendOutEvent (OutMPNodesResponse o nds) = void $ writeUnseqEvents [IEMPNodesResponse o nds]
sendOutEvent (OutPreprepareResponse dec) = void $ writeUnseqEvents [IEPreprepareResponse dec]

sendProfiledItems ::
  (Bin.Binary a, HasStreaming m) =>
  String ->
  ([a] -> m [ProduceResponse]) ->
  ([B.ByteString] -> m [ProduceResponse]) ->
  [a] ->
  m ()
sendProfiledItems channel produceValues produceBytes values
  | not phaseProfileEnabled = void $ produceValues values
  | otherwise = do
      payloads <- encodeProfiledItems channel values
      profilePhase EventKafkaEnqueue $ void $ produceBytes payloads

encodeProfiledItems :: (Bin.Binary a, MonadIO m) => String -> [a] -> m [B.ByteString]
encodeProfiledItems channel values
  | not phaseProfileEnabled = pure $ map (BL.toStrict . Bin.encode) values
  | otherwise = do
      payloads <- profilePhase SolidVMDiffActionConstructionSerialization $
        liftIO $ evaluate $ force $ map (BL.toStrict . Bin.encode) values
      liftIO $ do
        noteProfileOutput channel payloads
        bumpDBProfile SerializedEventCount $ fromIntegral (length payloads)
        bumpDBProfile SerializedEventBytes . fromIntegral $ sum (map B.length payloads)
      pure payloads

consumerGroup :: ConsumerGroup
consumerGroup = "ethereum-vm"

-- | Handle flush mempool event by converting scope and calling Bagger.flush
handleVmFlushMempool :: Bagger.MonadBagger m => FlushMempoolRequest -> m ()
handleVmFlushMempool (FlushMempoolRequest scope reqId) = do
  $logInfoS "EthereumVM.flush" $ T.pack $
    "Processing flush request " ++ reqId ++ " with scope " ++ show scope
  flushedTxs <- Bagger.flush (convertFlushScope scope)
  $logInfoS "EthereumVM.flush" $ T.pack $
    "Flushed " ++ show (length flushedTxs) ++ " transactions for request " ++ reqId
  where
    -- Convert event scope to Bagger scope
    convertFlushScope :: FlushMempoolScope -> Flush.FlushScope
    convertFlushScope FlushPending = Flush.FlushPending
    convertFlushScope FlushQueued = Flush.FlushQueued
    convertFlushScope FlushAll = Flush.FlushAll
