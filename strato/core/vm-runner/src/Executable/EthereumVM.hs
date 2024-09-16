{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
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
import Blockchain.BlockChain
import Blockchain.DB.ChainDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonce)
import Blockchain.Data.BlockHeader
import Blockchain.Data.GenesisBlock
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import Blockchain.Event
import Blockchain.JsonRpcCommand
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.StateRootMismatch
import Blockchain.Strato.Indexer.Kafka (produceIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.Model.Keccak256 as Keccak256
import Blockchain.Strato.RedisBlockDB
import Blockchain.Strato.RedisBlockDB.Models
import Blockchain.Strato.StateDiff          (stateDiff')
import Blockchain.Strato.StateDiff.Database (commitSqlDiffs)
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action
import Blockchain.Stream.VMEvent
import Blockchain.Timing
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.VMOptions
import Blockchain.Wiring
import Conduit hiding (Flush)
import Control.Lens hiding (Context)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import qualified Data.ByteString.Char8 as BC
import Data.Conduit.List (mapMaybeM)
import Data.Foldable hiding (fold)
import Data.List
import qualified Data.Map as M
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Text as T
import qualified Data.Text.Encoding as UTF8
import Debugger
import Executable.EthereumVM2
import Text.Format (format)

-- newtype CertRoot = CertRoot { unCertRoot :: MP.StateRoot }
--   deriving (Eq, Ord, Show)

ethereumVM :: Maybe DebugSettings -> LoggingT IO ()
ethereumVM d = runResourceT $ do
  ctx <- initContext d
  void . runSQLM . runKafkaMConfigured "ethereum-vm" $ execContextM' ctx $ do
    Bagger.setCalculateIntrinsicGas $ \i otx -> toInteger (calculateIntrinsicGas' i otx)

    initializeBestBlock

    StateRootMismatch{..} <- runConsume "evm/loop" consumerGroup seqVmEventsTopicName $ \_ seqEvents -> do
        recordBaggerMetrics =<< contextGets _baggerState
        logEventSummaries seqEvents

        let !vmInEventBatch = foldr insertInBatch newInBatch seqEvents
        mSRMismatch <- fmap listToMaybe . runConduit $
          yield vmInEventBatch
            .| handleVmEvents
            .| mapMaybeM routeOutEvent
            .| sinkList

        loopTimeit "compactContextM" $ compactContextM

        return (mSRMismatch, ())
    
    let err = "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format _srmBlockSR 
    runStateRootMismatchM $ do
      sd <- runConduit $ stateDiff' Nothing _srmBlockNumber _srmBlockHash _srmBlockSR _srmNewSR
         .| headDefC (error $ err ++ "\nError encountered while analyzing stateRoot mismatch")
      $logErrorS "ethereumVM/StateRootMismatch" . T.pack $ formatStateRootMismatch sd
    error err

initializeBestBlock :: (HasContext m, Bagger.MonadBagger m) => m ()
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
      td = obTotalDifficulty block
      txL = length txs
  in ContextBestBlockInfo (blockHeaderHash header) header td txL

logEventSummaries :: MonadLogger m => [VmEvent] -> m ()
logEventSummaries events = do
  let names = map getNames events
      numberedNames = map (\x -> numberIt (length x) (head x)) $ group $ sort names

  $logInfoS "logEventSummaries" . T.pack $
    "#### Got: " ++ intercalate ", " numberedNames -- show numTXs ++ "TXs, " ++ show numBlocks ++ " blocks"
  where
    getNames :: VmEvent -> String
    getNames (VmTx _ _) = "TX"
    getNames (VmBlock _) = "Block"
    getNames (VmGenesis _) = "GenesisBlock"
    getNames (VmJsonRpcCommand _) = "JsonRpcCommand"
    getNames VmCreateBlockCommand = "CreateBlockCommand"
    getNames (VmPrivateTx _) = "PrivateTx"
    getNames (VmGetMPNodesRequest _ _) = "GetMPNodesRequest"
    getNames (VmMPNodesReceived _) = "MPNodesReceived"
    getNames (VmRunPreprepare _) = "VmRunPreprepare"

    numberIt :: Int -> String -> String
    numberIt 1 x = "1 " ++ x
    numberIt i x = show i ++ " " ++ x ++ "s"

-- KAFKA

routeOutEvent :: (MonadLogger m, HasKafka m, HasSQL m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => VmOutEvent -> m (Maybe StateRootMismatch)
routeOutEvent (OutStateRootMismatch srm) = pure $ Just srm
routeOutEvent oev = Nothing <$ sendOutEvent oev

sendOutEvent :: (MonadLogger m, HasKafka m, HasSQL m, HasContext m, (MP.StateRoot `A.Alters` MP.NodeData) m) => VmOutEvent -> m ()
sendOutEvent (OutAction act) = do
  let extractCodeCollectionAddedMessages :: Action -> Maybe VMEvent
      extractCodeCollectionAddedMessages a =
        case ( join $ fmap (M.lookup "src") $ a ^. Action.metadata,
               join $ fmap (M.lookup "name") $ a ^. Action.metadata,
               OMap.assocs $ a ^. Action.actionData
             ) of
          (Just c, Just n, actionDatas) ->
            let cp = case join $ fmap (M.lookup "VM") $ a ^. Action.metadata of
                  Just "SolidVM" -> SolidVMCode (T.unpack n) $ Keccak256.hash $ UTF8.encodeUtf8 c
                  Just "EVM" -> ExternallyOwned $ Keccak256.hash $ BC.pack $ T.unpack c
                  Just v -> error $ "Unknown VM: " ++ show v
                  Nothing -> ExternallyOwned $ Keccak256.hash $ BC.pack $ T.unpack c
                cn = fromMaybe "" . listToMaybe . catMaybes . flip map actionDatas $ \(_, Action.ActionData {..}) ->
                  if _actionDataCodeHash == cp
                    then Just _actionDataCreator
                    else Nothing
                cc = foldr (\ad b -> Action._actionDataCodeCollection ad <> b) mempty $ snd <$> actionDatas
                abstracts' = foldr (\ad b -> Action._actionDataAbstracts ad <> b) mempty $ snd <$> actionDatas
             in Just $
                  CodeCollectionAdded
                    { codeCollection = const () <$> cc,
                      codePtr = cp,
                      creator = cn,
                      application = n,
                      historyList =
                        case join $ fmap (M.lookup "history") (a ^. Action.metadata) of
                          Nothing -> []
                          Just v -> T.splitOn "," v,
                      abstracts = abstracts',
                      recordMappings = []
                    }
          _ -> Nothing
      ccEvents = maybeToList $ extractCodeCollectionAddedMessages act
      dcEvents = DelegatecallMade <$> toList (act ^. Action.delegatecalls)
      act' = act { Action._actionData = Action.omapMap (Action.actionDataCodeCollection .~ mempty) (Action._actionData act) }
      actionEvents = [NewAction act']
      vmes = ccEvents ++ dcEvents ++ actionEvents
  void . produceVMEvents $ toList vmes
sendOutEvent (OutIndexEvent e) = void $ produceIndexEvents [e]
sendOutEvent (OutToStateDiff cId cInfo bHash cn app) = withCurrentBlockHash bHash $ initializeChainDBs (Just cId) cInfo cn app
sendOutEvent (OutStateDiff diff) = commitSqlDiffs diff
sendOutEvent (OutLog l) = loopTimeit "flushLogEntries" $ void $ produceIndexEvents [LogDBEntry l]
sendOutEvent (OutEvent e) = loopTimeit "flushEventEntries" $ void $ produceIndexEvents (EventDBEntry <$> e)
sendOutEvent (OutTXR tr) = void . produceVMEvents $ [NewTransactionResult tr]
sendOutEvent (OutASM asm) =
  when (not flags_sqlDiff) $
    timeit "updateSQLBalanceAndNonce" (Just vmBlockInsertionMined) $
      updateSQLBalanceAndNonce $
        [ ( theAccount,
            (addressStateBalance asMod, addressStateNonce asMod)
          )
          | (theAccount, Mem.ASModification asMod) <- M.toList asm
        ]
sendOutEvent (OutJSONRPC s b) = liftIO $ produceResponse s b
sendOutEvent (OutBlock o) = void $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry $ outputBlockToBlock o]
sendOutEvent (OutStateRootMismatch _) = pure ()
sendOutEvent (OutGetMPNodes mpNodes) = void $ writeUnseqEvents [IEGetMPNodes mpNodes]
sendOutEvent (OutMPNodesResponse o nds) = void $ writeUnseqEvents [IEMPNodesResponse o nds]
sendOutEvent (OutPreprepareResponse dec) = void $ writeUnseqEvents [IEPreprepareResponse dec]

consumerGroup :: ConsumerGroup
consumerGroup = "ethereum-vm"

