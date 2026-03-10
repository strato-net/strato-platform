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
  ( ethereumVM
  )
where

import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Bagger.Transactions as Flush
import Blockchain.BlockDB
import Blockchain.DB.ChainDB
import Blockchain.DB.StateDB (setStateDBStateRoot)
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonce)
import Blockchain.Data.GenesisBlock (genesisInfoToBlock)
import Blockchain.Data.GenesisInfo (stateRoot, getGenesisInfo)
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Database.MerklePatricia.NodeData
import Blockchain.EthConf
import Blockchain.Event
import Blockchain.JsonRpcCommand
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.StateRootMismatch
import Blockchain.Strato.Indexer.Kafka (produceIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.StateRoot
import Blockchain.Strato.RedisBlockDB
import Blockchain.Strato.StateDiff          (stateDiff')
import Blockchain.Strato.StateDiff.Database (commitSqlDiffs)
import Blockchain.Stream.VMEvent
import Blockchain.SyncDB
import Blockchain.Timing
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.VMOptions
import Blockchain.Wiring
import Conduit hiding (Flush)
import Control.Monad
import Control.Monad.Change.Alter
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Data.Conduit.List (mapMaybeM)
import Data.Foldable hiding (fold)
import Data.List
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Text as T
import Debugger
import Executable.EthereumVM2
import Text.Format (format)

ethereumVM :: Maybe DebugSettings -> LoggingT IO ()
ethereumVM d = runResourceT $ do
  ctx <- initContext d
  void . runSQLM . runKafkaMConfigured "ethereum-vm" $ execContextM' ctx $ do
--    Bagger.setCalculateIntrinsicGas $ \i otx -> toInteger (calculateIntrinsicGas' i otx)

    bootstrapIfFirstRun

    initializeBestBlock

    failures <- runConsume "evm/loop" consumerGroup seqVmEventsTopicName $ \_ seqEvents -> do

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
        failures <- fmap concat . runConduit $
          yield vmInEventBatch
            .| handleVmEvents
            .| mapMaybeM routeOutEvent
            .| sinkList

        loopTimeit "compactContextM" $ compactContextM

        return (if null failures then Nothing else Just failures, ())

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
    error "STRATO vm-runner encountered errors while verifying a block in the chain. Please review the logs above for more information."

bootstrapIfFirstRun :: (MonadLogger m, (StateRoot `Alters` NodeData) m, HasContext m) => m ()
bootstrapIfFirstRun = do
  genesisInfo <- getGenesisInfo
  let genesisHash = blockHash (genesisInfoToBlock genesisInfo)
  maybeGenesisStateRoot <- getChainStateRoot Nothing genesisHash
  case maybeGenesisStateRoot of -- If first run, then bootstrap
    Nothing -> do
      $logInfoS "bootstrap" "Bootstrapping"
      bootstrapChainDB genesisHash $ stateRoot genesisInfo
      setStateDBStateRoot Nothing  $ stateRoot genesisInfo
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

logEventSummaries :: MonadLogger m => [VmEvent] -> m ()
logEventSummaries evs = do
  let names = map getNames evs
      numberedNames = map (\case [] -> []; x@(x0:_) -> numberIt (length x) x0) $ group $ sort names

  $logInfoS "logEventSummaries" . T.pack $
    "#### Got: " ++ intercalate ", " numberedNames -- show numTXs ++ "TXs, " ++ show numBlocks ++ " blocks"
  where
    getNames :: VmEvent -> String
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

routeOutEvent :: (MonadLogger m, HasKafka m, HasSQL m, HasContext m) => VmOutEvent -> m (Maybe [BlockVerificationFailure])
routeOutEvent (OutBlockVerificationFailure bvf) = pure $ Just bvf
routeOutEvent oev = Nothing <$ sendOutEvent oev

sendOutEvent :: (MonadLogger m, HasKafka m, HasSQL m, HasContext m) => VmOutEvent -> m ()
sendOutEvent (OutVMEvents vmes) = void $ produceVMEvents vmes
sendOutEvent (OutIndexEvent e) = void $ produceIndexEvents [e]
sendOutEvent (OutStateDiff diff) = commitSqlDiffs diff
sendOutEvent (OutLog l) = loopTimeit "flushLogEntries" $ void $ produceIndexEvents [LogDBEntry l]
sendOutEvent (OutEvent e) = loopTimeit "flushEventEntries" $ void $ produceIndexEvents (EventDBEntry <$> e)
sendOutEvent (OutASM asm) =
  when (not flags_sqlDiff) $
    timeit "updateSQLBalanceAndNonce" (Just vmBlockInsertionMined) $
      updateSQLBalanceAndNonce $
        [ ( theAddress,
            (addressStateBalance asMod, addressStateNonce asMod)
          )
        | (theAddress, Mem.ASModification asMod) <- M.toList asm
        ]
sendOutEvent (OutJSONRPC s b) = liftIO $ produceResponse s b
sendOutEvent (OutBlock o) = void $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry $ outputBlockToBlock o]
sendOutEvent (OutBlockVerificationFailure _) = pure ()
sendOutEvent (OutGetMPNodes mpNodes) = void $ writeUnseqEvents [IEGetMPNodes mpNodes]
sendOutEvent (OutMPNodesResponse o nds) = void $ writeUnseqEvents [IEMPNodesResponse o nds]
sendOutEvent (OutPreprepareResponse dec) = void $ writeUnseqEvents [IEPreprepareResponse dec]

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
