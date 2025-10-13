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

--import           Data.List.Split                       (chunksOf)

import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
--import Blockchain.BlockChain
import Blockchain.BlockDB
import Blockchain.DB.ChainDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonce)
import Blockchain.Data.BlockHeader
import Blockchain.Data.DataDefs (EventDB, eventDBContractAddress, eventDBName, eventDBArgs)
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.EthConf
import Blockchain.Event
import Blockchain.JsonRpcCommand
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import Blockchain.NetworkParameters (initializeTxSizeLimitCache, updateCachedTxSizeLimit, transactionParametersAddress)
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.StateRootMismatch
import Blockchain.Strato.Indexer.Kafka (produceIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Class
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

    initializeBestBlock
    
    -- Initialize transaction size limit cache from LevelDB on startup
    initializeTxSizeLimitCache

    failures <- runConsume "evm/loop" consumerGroup seqVmEventsTopicName $ \_ seqEvents -> do

        let maybeSelfAddress = listToMaybe [ addr | VmSelfAddress addr <- toList seqEvents ]
        $logInfoLS "ethereumVM/maybeSelfAddress" (format maybeSelfAddress)
        case maybeSelfAddress of
          Just x -> contextModify' $ \cs@(ContextState{}) -> cs{_selfAddress = x}
          Nothing -> pure ()
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
      CertRegistrationMismatch BlockDelta{..} -> do
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "There was a cert mismatch in block #" ++ show bNum ++ ", hash " ++ format bHash 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "New certs found in block header:        " ++ show (fst _inBlock) 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "New certs found from running block:     " ++ show (fst _derived) 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "Removed certs found in block header:    " ++ show (snd _inBlock) 
        $logErrorS "ethereumVM/CertRegistrationMismatch" . T.pack $ "Removed certs found from running block: " ++ show (snd _derived) 
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
      _ <- bootstrapChainDB (blockHeaderHash $ obBlockData redisBestBlock) [(Nothing, stateRoot $ obBlockData redisBestBlock)]
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
    getNames VmCreateBlockCommand = "CreateBlockCommand"
    getNames (VmGetMPNodesRequest _ _) = "GetMPNodesRequest"
    getNames (VmMPNodesReceived _) = "MPNodesReceived"
    getNames (VmRunPreprepare _) = "VmRunPreprepare"
    getNames (VmSelfAddress _) = "VmSelfAddress"

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
sendOutEvent (OutEvent events) = do
  -- Process TransactionSizeLimitChanged events to update cache
  processTransactionParameterEvents events
  -- Emit events to indexer
  loopTimeit "flushEventEntries" $ void $ produceIndexEvents (EventDBEntry <$> events)
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

-- Process TransactionSizeLimitChanged events and update cache
processTransactionParameterEvents :: (MonadLogger m, HasContext m) => [EventDB] -> m ()
processTransactionParameterEvents events = do
  forM_ events $ \event -> do
    when (eventDBContractAddress event == transactionParametersAddress && 
          eventDBName event == "TransactionSizeLimitChanged") $ do
      $logInfoS "processTransactionParameterEvents" $ T.pack $
        "Received TransactionSizeLimitChanged event from contract " ++ show transactionParametersAddress
      -- Parse the newLimit from event args
      -- Event args: [previousLimit, newLimit, blockNumber, timestamp]
      let args = eventDBArgs event
      case args of
        (_:newLimitStr:_) -> do
          case reads newLimitStr :: [(Int, String)] of
            [(newLimit, _)] -> do
              $logInfoS "processTransactionParameterEvents" $ T.pack $
                "Updating transaction size limit cache to: " ++ show newLimit
              updateCachedTxSizeLimit newLimit
            _ -> do
              $logWarnS "processTransactionParameterEvents" $ T.pack $
                "Failed to parse newLimit from event args: " ++ newLimitStr
        _ -> do
          $logWarnS "processTransactionParameterEvents" $
            "TransactionSizeLimitChanged event missing expected args structure"

