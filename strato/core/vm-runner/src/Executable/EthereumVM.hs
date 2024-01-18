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
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef (updateSQLBalanceAndNonce)
import Blockchain.Data.BlockHeader (extraData2TxsLen)
import Blockchain.Data.DataDefs (BlockData (..), blockDataExtraData)
import Blockchain.Data.GenesisBlock
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import Blockchain.Event
import Blockchain.JsonRpcCommand
import qualified Blockchain.MilenaTools as K
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Strato.Indexer.Kafka (writeIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import qualified Blockchain.Strato.Model.Keccak256 as Keccak256
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
import Control.Concurrent.STM (TQueue, atomically, readTQueue, writeTQueue)
import Control.Lens hiding (Context)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL
import Control.Monad.Reader (ask, runReaderT)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as BC
import qualified Data.DList as DL
import Data.Foldable hiding (fold)
import Data.List
import qualified Data.Map as M
import Data.Maybe
import Data.Proxy
import Data.String
import qualified Data.Text as T
import Debugger
import Executable.EthereumVM2
import Executable.EVMCheckpoint
import Executable.EVMFlags
import qualified Network.Kafka.Protocol as KP
import Text.Format (format)
import UnliftIO (race_)

-- newtype CertRoot = CertRoot { unCertRoot :: MP.StateRoot }
--   deriving (Eq, Ord, Show)

ethereumVM :: Maybe DebugSettings -> LoggingT IO ()
ethereumVM d = runResourceT $ do
  ctx <- initContext d
  let k = kafkaConfig ethConf
  race_ (deployCommitsSqlDiffs ctx) . runSQLM . runKafkaM "ethereum-vm" (fromString $ kafkaHost k, fromIntegral $ kafkaPort k) . execContextM' ctx $ do
    Bagger.setCalculateIntrinsicGas $ \i otx -> toInteger (calculateIntrinsicGas' i otx)
    (cpOffsetStart, EVMCheckpoint cpHash cpHead cpBBI cpSR) <- getCheckpoint
    $logInfoLS "ethereumVM/getCheckpoint" (cpHash, cpBBI, cpSR)

    putContextBestBlockInfo cpBBI
    Mod.put Proxy $ BlockHashRoot cpSR

    Bagger.processNewBestBlock cpHash cpHead [] -- bootstrap Bagger with genesis block
    $logInfoS "evm/preLoop" $ T.pack $ "cpOffset = " ++ show cpOffsetStart
    forever $
      loopTimeit "one full loop" $ do
        recordBaggerMetrics =<< contextGets _baggerState
        cpOffset <- getCheckpointNoMetadata
        $logInfoS "evm/loop" "Getting Blocks/Txs"
        seqEvents <- loopTimeit "======>>>> waiting for new events <<<<======" $ getUnprocessedKafkaEvents cpOffset

        logEventSummaries seqEvents

        let !vmInEventBatch = foldr insertInBatch newInBatch seqEvents
        void . runConduit $
          yield vmInEventBatch
            .| handleVmEvents flags_useSyncMode
            .| mapM_C sendOutEvent
        contx <- ask
        void . liftIO $ enqueue (_stateDiffQueue contx) Flush

        loopTimeit "compactContextM" $ compactContextM

        let newOffset = cpOffset + fromIntegral (length seqEvents)
        baggerData <- uncurry EVMCheckpoint <$> Bagger.getCheckpointableState
        checkpointData <- baggerData <$> getContextBestBlockInfo
        withChainroot <- checkpointData . unBlockHashRoot <$> Mod.get Proxy
        -- withCertroot <- withChainroot . unCertRoot <$> Mod.get Proxy
        setCheckpoint newOffset withChainroot

initializeCheckpointAndBlockSummary ::
  ( HasBlockSummaryDB m,
    Mod.Modifiable BlockHashRoot m,
    Mod.Modifiable GenesisRoot m,
    (MP.StateRoot `A.Alters` MP.NodeData) m
  ) =>
  OutputBlock ->
  m EVMCheckpoint
initializeCheckpointAndBlockSummary block = do
  let evmc@(EVMCheckpoint sha _ _ sr) = outputBlockToEvmCheckpoint block
  writeBlockSummary block
  (BlockHashRoot bhr) <- bootstrapChainDB sha [(Nothing, sr)]
  return
    evmc
      { ctxChainDBStateRoot = bhr
      }

outputBlockToEvmCheckpoint :: OutputBlock -> EVMCheckpoint
outputBlockToEvmCheckpoint block =
  let sha = outputBlockHash block
      header = obBlockData block
      txs = obReceiptTransactions block
      td = obTotalDifficulty block
      txL = length txs
      uncL = length (obBlockUncles block)
      cbbi = ContextBestBlockInfo sha header td txL uncL
      sr = blockDataStateRoot header
   in EVMCheckpoint sha header cbbi sr

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

    numberIt :: Int -> String -> String
    numberIt 1 x = "1 " ++ x
    numberIt i x = show i ++ " " ++ x ++ "s"

-- KAFKA

sendOutEvent :: (MonadLogger m, HasKafka m, HasSQL m, HasContext m) => VmOutEvent -> m ()
sendOutEvent (OutAction act) = do
  let extractCodeCollectionAddedMessages :: Action -> Maybe VMEvent
      extractCodeCollectionAddedMessages a =
        case ( join $ fmap (M.lookup "src") $ a ^. Action.metadata,
               join $ fmap (M.lookup "name") $ a ^. Action.metadata,
               M.toList $ a ^. Action.actionData
             ) of
          (Just c, Just n, actionDatas) ->
            let cp = case join $ fmap (M.lookup "VM") $ a ^. Action.metadata of
                  Just "SolidVM" -> SolidVMCode (T.unpack n) $ Keccak256.hash $ BC.pack $ T.unpack c
                  Just "EVM" -> EVMCode $ Keccak256.hash $ BC.pack $ T.unpack c
                  Just v -> error $ "Unknown VM: " ++ show v
                  Nothing -> EVMCode $ Keccak256.hash $ BC.pack $ T.unpack c
                org = fromMaybe "" . listToMaybe . catMaybes . flip map actionDatas $ \(_, Action.ActionData {..}) ->
                  if _actionDataCodeHash == cp
                    then Just _actionDataOrganization
                    else Nothing
             in Just $
                  CodeCollectionAdded
                    { ccString = c,
                      codePtr = cp,
                      organization = org,
                      application = n,
                      historyList =
                        case join $ fmap (M.lookup "history") (a ^. Action.metadata) of
                          Nothing -> []
                          Just v -> T.splitOn "," v,
                      recordMappings = []
                    }
          _ -> Nothing
      ccEvents = maybeToList $ extractCodeCollectionAddedMessages act
      dcEvents = DelegatecallMade <$> toList (act ^. Action.delegatecalls)
      actionEvents = [NewAction act]
      vmes = ccEvents ++ dcEvents ++ actionEvents
  contx <- accessEnv
  void . liftIO $ enqueue (_stateDiffQueue contx) (VME vmes)
sendOutEvent (OutIndexEvent e) = void . execKafka $ writeIndexEvents [e]
sendOutEvent (OutToStateDiff cId cInfo bHash org app) = withCurrentBlockHash bHash $ initializeChainDBs (Just cId) cInfo org app
sendOutEvent (OutStateDiff diff) = do
  contx <- accessEnv
  void . liftIO $ enqueue (_stateDiffQueue contx) (SD diff)
sendOutEvent (OutLog l) = loopTimeit "flushLogEntries" $ void . execKafka $ writeIndexEvents [LogDBEntry l]
sendOutEvent (OutEvent e) = loopTimeit "flushEventEntries" $ void . execKafka $ writeIndexEvents [EventDBEntry e]
sendOutEvent (OutTXR tr) = do
  contx <- accessEnv
  void . liftIO $ enqueue (_stateDiffQueue contx) (TXR tr)
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
sendOutEvent (OutBlock o) = void . execKafka $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry $ outputBlockToBlock o]

consumerGroup :: KP.ConsumerGroup
consumerGroup = lookupConsumerGroup "ethereum-vm"

getFirstBlockFromSequencer :: (MonadLogger m, MonadFail m, HasKafka m) => m OutputBlock
getFirstBlockFromSequencer = do
  (VmBlock block) <- head <$> getUnprocessedKafkaEvents (KP.Offset 0)
  return block

-- this one starts at 1, 0 is reserved for genesis block and is used to
-- bootstrap a ton of this
-- Also seeds the BlockSummaryDatabase
initializeCheckpointAndBlockSummaryKafka :: (MonadLogger m, MonadFail m, HasKafka m, HasContext m) => m ()
initializeCheckpointAndBlockSummaryKafka = do
  block <- getFirstBlockFromSequencer
  checkpoint <- initializeCheckpointAndBlockSummary block
  setCheckpoint 1 checkpoint

getCheckpoint :: (MonadLogger m, MonadFail m, HasKafka m, HasContext m) => m (KP.Offset, EVMCheckpoint)
getCheckpoint = do
  let topic = seqVmEventsTopicName
      topic' = show topic
      cg' = show consumerGroup
  $logInfoS "getCheckpoint" . T.pack $ "Getting checkpoint for " ++ topic' ++ "#0 for " ++ cg'
  execKafka (K.fetchSingleOffset consumerGroup topic 0) >>= \case
    Left KP.UnknownTopicOrPartition -> initializeCheckpointAndBlockSummaryKafka >> getCheckpoint
    Left err -> error $ "Unexpected response when fetching checkpoint: " ++ show err
    Right (ofs, md) -> do
      let md' = fromKafkaMetadata md
      $logInfoS "getCheckpoint" . T.pack $ show ofs ++ " / " ++ format md'
      return (ofs, md')

getCheckpointNoMetadata :: (MonadLogger m, HasKafka m) => m KP.Offset
getCheckpointNoMetadata = do
  let topic = seqVmEventsTopicName
      topic' = show topic
      cg' = show consumerGroup
  $logInfoS "getCheckpointNoMetadata" . T.pack $ "Getting checkpoint for " ++ topic' ++ "#0 for " ++ cg'
  execKafka (K.fetchSingleOffset consumerGroup topic 0) >>= \case
    Left KP.UnknownTopicOrPartition -> setCheckpointNoMetadata 1 >> getCheckpointNoMetadata
    Left err -> error $ "Unexpected response when fetching checkpoint: " ++ show err
    Right (ofs, _) -> do
      return ofs

setCheckpoint :: (MonadLogger m, HasKafka m) => KP.Offset -> EVMCheckpoint -> m ()
setCheckpoint ofs checkpoint = do
  $logInfoS "setCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs ++ " / " ++ format checkpoint
  let kMetadata = toKafkaMetadata checkpoint
  ret <- execKafka $ K.commitSingleOffset consumerGroup seqVmEventsTopicName 0 ofs kMetadata
  either (error . show) return ret

setCheckpointNoMetadata :: (MonadLogger m, HasKafka m) => KP.Offset -> m ()
setCheckpointNoMetadata ofs = do
  $logInfoS "setCheckpointNoMetadata" . T.pack $ "Setting checkpoint to " ++ show ofs
  let emptyMetadata = KP.Metadata $ KP.KString BS.empty
  ret <- execKafka $ K.commitSingleOffset consumerGroup seqVmEventsTopicName 0 ofs emptyMetadata
  either (error . show) return ret

getUnprocessedKafkaEvents :: (MonadLogger m, HasKafka m) => KP.Offset -> m [VmEvent]
getUnprocessedKafkaEvents offset = do
  $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Fetching sequenced blockchain events with offset " ++ show offset
  ret <- execKafka (readSeqVmEvents offset)
  let countLimit =
        if flags_seqEventsBatchSize > 0
          then take flags_seqEventsBatchSize
          else id
      eventLimit =
        if flags_seqEventsCostHeuristic > 0
          then take num
          else id
      num =
        length
          . takeWhile (<= flags_seqEventsCostHeuristic)
          . scanl (+) 0
          . map approxCost
          $ ret
      approxCost :: VmEvent -> Int
      approxCost = \case
        VmBlock OutputBlock {..} ->
          fromMaybe (length obReceiptTransactions)
            . extraData2TxsLen
            $ blockDataExtraData obBlockData
        _ -> 1

      !ret' = eventLimit . countLimit $ ret
  return ret'

-- This function lives on its own thread
checkQueueAndCommitsSqlDiffsForever :: (MonadLogger m, HasSQL m, HasContext m) => DL.DList VMEvent -> m ()
checkQueueAndCommitsSqlDiffsForever vmEvents = loop vmEvents
  where
    loop acc = do
      context' <- accessEnv
      let que = _stateDiffQueue context'
      msg <- liftIO . atomically $ readTQueue que
      case msg of
        TXR !txResult -> loop $ acc `DL.snoc` NewTransactionResult txResult
        SD !stateDiff' -> do
          commitSqlDiffs stateDiff'
          loop acc
        VME !vmes -> loop $ acc `DL.append` DL.fromList vmes
        Flush -> do
          void . produceVMEvents $ toList acc
          loop DL.empty

deployCommitsSqlDiffs :: Context -> ResourceT (LoggingT IO) ()
deployCommitsSqlDiffs context' = runSQLM $ runReaderT (checkQueueAndCommitsSqlDiffsForever DL.empty) context'

-- Add an element to the end of the queue
enqueue :: TQueue a -> a -> IO ()
enqueue queue item = atomically $ writeTQueue queue item
