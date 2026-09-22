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
    seedDatabases,
  )
where

import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Bagger.Transactions as Flush
import Blockchain.BlockDB
import Blockchain.DB.BlockSummaryDB (hasBSum)
import Blockchain.Data.Block (blockBlockData)
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.DB.CodeDB ()
import Blockchain.DB.StateDB (setStateDBStateRoot)
import Blockchain.Data.AddressStateDB ()
import Blockchain.Data.GenesisBlock (genesisInfoToBlock)
import Blockchain.Data.GenesisInfo (stateRoot, getGenesisInfo)
import Blockchain.Bootstrap
import Blockchain.Database.MerklePatricia.NodeData ()
import Blockchain.Event
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka (seqVmTasksTopicName)
import Blockchain.StateRootMismatch
import Blockchain.Strato.Model.Address ()
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.StateRoot ()
import Blockchain.Strato.RedisBlockDB
import Blockchain.Strato.StateDiff          (stateDiff')
import Blockchain.SyncDB
import Blockchain.Timing
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.Wiring
import Control.Monad
import Control.Monad.Change.Alter ()
import Control.Monad.Composable.NodeDB (flushNodeDB)
import Control.Monad.Composable.Streaming
import Data.Foldable hiding (fold)
import Data.List
import Data.Maybe
import qualified Data.Text as T
import Executable.EthereumVM2
import Text.Format (format)

ethereumVM :: ContextM ()
ethereumVM = do
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
      failures <- handleVmTasks vmInEventBatch
      -- Trie writes held back over this input batch are made durable before
      -- runConsume advances the input checkpoint.
      flushNodeDB

      loopTimeit "compactContextM" $ compactContextM

      return $ if null failures then Nothing else Just failures

  for_ failures $ \(BlockVerificationFailure bNum bHash bDetails) -> case bDetails of
    StateRootMismatch BlockDelta{..} -> do
      let err = "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format _inBlock
      withFetchMissingNodes $ do
        sds <- stateDiff' Nothing bNum bHash _inBlock _derived
        let sd = fromMaybe (error $ err ++ "\nError encountered while analyzing stateRoot mismatch") (listToMaybe sds)
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

bootstrapIfFirstRun :: ContextM ()
bootstrapIfFirstRun = do
  genesisInfo <- getGenesisInfo
  let genesisBlock = genesisInfoToBlock genesisInfo
      genesisHash = blockHash genesisBlock
  bootstrapped <- hasBSum genesisHash
  if bootstrapped
    then $logInfoS "bootstrap" "Bootstrapping not needed"
    else withCurrentBlockHash genesisHash $ do
      $logInfoS "bootstrap" "Bootstrapping"
      writeBlockSummary OutputBlock {obOrigin = Origin.Direct, obBlockData = blockBlockData genesisBlock, obReceiptTransactions = [], obBlockUncles = []}
      setStateDBStateRoot Nothing  $ stateRoot genesisInfo
      seedDatabases genesisBlock
      populateStorageDBs genesisInfo genesisBlock Nothing

initializeBestBlock :: ContextM ()
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
