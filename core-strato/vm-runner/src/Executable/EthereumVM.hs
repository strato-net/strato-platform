{-# LANGUAGE BangPatterns      #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}

module Executable.EthereumVM (
  ethereumVM
) where

import           Control.Monad
import qualified Control.Monad.Change.Modify             as Mod
import           Control.Monad.IO.Class
import qualified Blockchain.Database.MerklePatricia      as MP
import           Blockchain.Output
import qualified Data.ByteString                       as BS
import qualified Data.DList                            as DL
import           Data.List
import           Data.Proxy
import qualified Data.Text                             as T
import qualified Data.Map                              as M
import           Data.Maybe                            (catMaybes, isNothing, fromMaybe)
import qualified Data.Set                              as S
import           Data.Time.Clock.POSIX
import qualified Network.Kafka.Protocol                as KP
import           Text.Printf
import           Util                                  hiding (intercalate)

import           Blockapps.Crossmon
import           Blockchain.BlockChain
import           Blockchain.Data.Block                 (BestBlock(..), WorldBestBlock(..))
import           Blockchain.Data.BlockHeader           (extraData2TxsLen)
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs              (blockDataExtraData, blockDataNumber, BlockData(..))
import           Blockchain.Data.GenesisBlock
import           Blockchain.Data.LogDB
import           Blockchain.Data.EventDB
import           Blockchain.Data.TransactionResult
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.ChainDB
import           Blockchain.EthConf
import           Blockchain.ExtWord
import           Blockchain.JsonRpcCommand
import qualified Blockchain.MilenaTools                as K
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Strato.Model.Address
import           Blockchain.Stream.UnminedBlock        (produceUnminedBlocksM)
import           Blockchain.VMContext
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import           Executable.EVMCheckpoint
import           Executable.EVMFlags

import qualified Blockchain.Bagger                     as Bagger
import qualified Blockchain.Bagger.BaggerState         as B
import           Blockchain.Data.ExecResults
import qualified Blockchain.DB.MemAddressStateDB      as Mem
import           Blockchain.DB.StorageDB
import qualified Blockchain.SolidVM                      as SolidVM
import           Blockchain.Strato.Indexer.Kafka       (writeIndexEvents)
import           Blockchain.Strato.Indexer.Model       (IndexEvent (..))
import           Blockchain.Strato.Model.Action
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.StateDiff.Kafka     (writeActionJSONToKafka)
import           Blockchain.Timing
import           Blockchain.Util

import           Text.Format                           (format)

ethereumVM :: LoggingT IO ()
ethereumVM = void . execContextM $ do

    $logInfoS "difficultyBomb" $ T.pack $ "Difficulty bomb is " ++ show flags_difficultyBomb -- remove me once we figure out how to print args at startup

    let makeLazyBlocks = lazyBlocks $ quarryConfig ethConf
    Bagger.setCalculateIntrinsicGas $ \i otx -> toInteger (calculateIntrinsicGas' i otx)
    (cpOffsetStart, EVMCheckpoint cpHash cpHead cpBBI cpMSR) <- getCheckpoint
    $logInfoLS "ethereumVM/getCheckpoint" (cpHash, cpBBI, cpMSR)

    putContextBestBlockInfo cpBBI
    mapM_ (Mod.put Proxy . BlockHashRoot) cpMSR

    Bagger.processNewBestBlock cpHash cpHead [] -- bootstrap Bagger with genesis block

    $logInfoS "evm/preLoop" $ T.pack $ "cpOffset = " ++ show cpOffsetStart
    forever $ loopTimeit "one full loop" $ do
        recordBaggerMetrics =<< contextGets contextBaggerState
        cpOffset <- getCheckpointNoMetadata
        $logInfoS "evm/loop" "Getting Blocks/Txs"
        seqEvents <- loopTimeit "======>>>> waiting for new events <<<<======" $ getUnprocessedKafkaEvents cpOffset

        logEventSummaries seqEvents

        handleVmEvents makeLazyBlocks seqEvents

        let newOffset = cpOffset + fromIntegral (length seqEvents)
        baggerData <- uncurry EVMCheckpoint <$> Bagger.getCheckpointableState
        checkpointData <- baggerData <$> getContextBestBlockInfo
        withChainroot <- checkpointData . Just . unBlockHashRoot <$> Mod.get Proxy
        setCheckpoint newOffset withChainroot

microtimeCutoff :: Microtime
microtimeCutoff = secondsToMicrotime flags_mempoolLivenessCutoff
{-# NOINLINE microtimeCutoff #-}

handleVmEvents :: Bool -> [VmEvent] -> ContextM ()
handleVmEvents makeLazyBlocks events = do
  outputNewChains =<< insertNewChains [og | VmGenesis og <- events]
  mapM_ (uncurry3 queuePendingVote) [(r, d, s) | VmVoteToMake r d s <- events]
  mapM_ runJsonRpcCommand [c | VmJsonRpcCommand c <- events]

  let txPairs = [(ts,t) | VmTx ts t <- events]
      blocks = [b | VmBlock b <- events]
      (bLen, tLen) = (length blocks, length txPairs)
  recordSeqEventCount bLen tLen
  numPoolable <- processTransactions txPairs
  actions <- processBlocks blocks

  contextModify $ \ctx -> ctx{ _contextBlockRequested = _contextBlockRequested ctx || VmCreateBlockCommand `elem` events }
  -- todo: perhaps we shouldnt even add TXs to the mempool, it might make for a VERY large checkpoint
  -- todo: which may fail
  isCaughtUp <- shouldProcessNewTransactions
  state <- Bagger.getBaggerState
  pbft <- contextGets contextHasBlockstanbul
  reqd <- contextGets _contextBlockRequested
  let pending = B.pending state
      priv = DL.toList . B.privateHashes $ B.miningCache state
      hasTxs = (numPoolable > 0) || not (M.null pending) || not (null priv)
      shouldOutputBlocks = isCaughtUp && (
        if pbft
          then reqd && hasTxs
          else not makeLazyBlocks || hasTxs)
  $logInfoS "evm/loop/newBlock" . T.pack $ printf "Num poolable: %d, num pending: %d"
      numPoolable (M.size pending)
  $logInfoS "evm/loop/newBlock" . T.pack $ "Decision making for block creation: " ++
      "(isCaughtUp, pbft, reqd, hasTxs, makeLazyBlocks, shouldOutputBlocks) = " ++ show
       (isCaughtUp, pbft, reqd, hasTxs, makeLazyBlocks, shouldOutputBlocks)
  when (pbft && shouldOutputBlocks) $
    contextModify $ \ctx -> ctx{ _contextBlockRequested = False }
  $logDebugS "evm/loop/newBlock" $ T.pack $ "Queued: " ++ show numPoolable
  $logDebugS "evm/loop/newBlock" $ T.pack $ "Pending: " ++ show (length pending)
  when shouldOutputBlocks $ do
      $logInfoS "evm/loop/newBlock" "calling Bagger.makeNewBlock"
      newBlock <- --loopTimeit "Bagger.makeNewBlock"
                  Bagger.makeNewBlock
      $logInfoS "evm/loop/newBlock" "calling produceUnminedBlocksM"
      loopTimeit "produceUnminedBlocksM" $ K.withKafkaRetry1s (produceUnminedBlocksM [outputBlockToBlock newBlock])

  -- todo: is this the best place to put this?
  loopTimeit "flushLogEntries" $ flushLogEntries
  loopTimeit "flushEventEntries" $ flushEventEntries
  loopTimeit "flushTransactionResults" $ flushTransactionResults
  loopTimeit "writeActionJSONToKafka" $ void . K.withKafkaRetry1s $ writeActionJSONToKafka actions
  loopTimeit "compactContextM" $ compactContextM

insertNewChains :: [OutputGenesis] -> ContextM [(Word256, ChainInfo)]
insertNewChains ogs = fmap catMaybes . forM ogs $ \OutputGenesis{..} -> do
  let (cId, cInfo) = ogGenesisInfo
  $logInfoS "insertNewChains" $ T.pack $ "Inserting Chain ID: " ++ format (SHA cId)
  $logDebugS "insertNewChains" $ T.pack $ "With ChainInfo: " ++ show cInfo
  let theVM = T.unpack $ fromMaybe "EVM" $ M.lookup "VM" $ chainMetadata (chainInfo cInfo)
  sr' <- chainInfoToGenesisState theVM cInfo
  let maybeSource =
        case codeInfo $ chainInfo cInfo of
          [] -> Nothing
          (s:_) -> Just $ codeInfoSource s
  sr <-
    case theVM of
      "SolidVM" -> runChainConstructor cId maybeSource
      _ -> return sr'
  mGSR <- getGenesisStateRoot cId
  case mGSR of
    Just gsr -> do
      $logInfoS "insertNewChains" $ T.pack $ "We already have a genesis state root for this chain. It's " ++ format gsr
      return Nothing
    Nothing -> do
      $logInfoS "insertNewChains" $ T.pack $ "This is a new chain!"
      initializeChainDBs cId cInfo sr -- only needed to update Postgres with chain info for API calls
      Just (cId, cInfo) <$ putChainGenesisInfo cId (SHA 0) sr

outputNewChains :: [(Word256, ChainInfo)] -> ContextM ()
outputNewChains = void . K.withKafkaRetry1s . writeIndexEvents . map (uncurry NewChainInfo)

processBlocks :: [OutputBlock] -> ContextM [Action]
processBlocks blocks = do
  $logInfoS "evm/processBlocks" $ T.pack $ "Running " ++ show (length blocks) ++ " blocks"
  processBlockSummaries blocks
  addBlocks blocks

processBlockSummaries :: [OutputBlock] -> ContextM ()
processBlockSummaries = mapM_ $ \b -> do
  let number = blockDataNumber $ obBlockData b
      txCount = length $ obReceiptTransactions b
  recordMaxBlockNumber "vm_seqevents" number
  $logDebugS "evm/processBlockSummaries" . T.pack $ concat
    [ "Received block number "
    , show number
    , " with "
    , show txCount
    , " transactions from seqEvents"
    ]
  clearPendingVote (outputBlockToBlock b)
  writeBlockSummary b

processTransactions :: [(Timestamp, OutputTx)] -> ContextM Int
processTransactions txPairs = do
  outputTransactions txPairs
  $logDebugS "evm/processTransactions" $ T.pack $ "allTxs :: " ++ show txPairs
  let allNewTxs = filter (isNothing . txChainId . otBaseTx . snd) txPairs -- PrivateHashTXs have chainId = Nothing
  !currentMicrotime <- liftIO getCurrentMicrotime
  $logInfoS "evm/processTransactions" $ T.pack $ "currentMicrotime :: " ++ show currentMicrotime

  forM_ allNewTxs $ \(ts, _) ->
      $logInfoS "evm/processTransactions/allNewTxs" $ T.pack $ "math :: " ++ show currentMicrotime ++ " - " ++ show ts ++ " = " ++ show (currentMicrotime - ts) ++ "; <= " ++ show microtimeCutoff ++ "? " ++ show ((currentMicrotime - ts) <= microtimeCutoff)
  let poolableNewTxs = [t | (ts, t) <- allNewTxs, abs (currentMicrotime - ts) <= microtimeCutoff]
  $logInfoS "evm/loop" (T.pack ("adding " ++ show (length poolableNewTxs) ++ "/" ++ show (length allNewTxs) ++ " txs to mempool"))
  unless (null poolableNewTxs) $ Bagger.addTransactionsToMempool poolableNewTxs
  return $ length poolableNewTxs

outputTransactions :: [(Timestamp, OutputTx)] -> ContextM ()
outputTransactions txPairs =
  unless (null txPairs) . void
                        . K.withKafkaRetry1s
                        . writeIndexEvents
                        $ map (uncurry IndexTransaction) txPairs



runChainConstructor :: Word256 -> Maybe T.Text -> ContextM MP.StateRoot
runChainConstructor cId maybeSource = do
  -- We are inventing the rules of how the constructor should run when a chain is created.
  -- Since all VM runs need some environment variables passed in, we need to define what all of
  -- those variables should be.  The truth is, most of these variables are rarely used, but we
  -- still need to pre-decide what they should be else the VM would crash whenever they are used.
  -- I've set most of these variables to default dummy values below...  We might decide to refine
  -- some of these variables in the future.

  ExecResults {erAction=maybeAction} <- SolidVM.call
         False --isRunningTests
         True --isHomestead
         False --noValueTransfer
         S.empty --pre-existing suicide list
         (BlockData
            (SHA 0)
            (SHA 0)
            (Address 0)
            MP.emptyTriePtr
            MP.emptyTriePtr
            MP.emptyTriePtr
            ""
            0
            0 --block number
            100000000000
            0
            (posixSecondsToUTCTime 0)
            ""
            0
            (SHA 0))
         0 --callDepth
         (Address 0) --receiveAddress
         (Address 0x100) --codeAddress
         (Address 0) --sender
         0 --value
         1 --gasPrice
         ""
         1000000000000 --availableGas
         (Address 0)
         (SHA 0)
         (Just cId)
         (Just $ M.fromList $
           [("args", "()"), ("funcName", "<constructor>")]
           ++ case maybeSource of Nothing -> []; Just s -> [("src", s)])

  flushMemStorageDB
  Mem.flushMemAddressStateDB

  case maybeAction of
    Nothing -> return ()
    Just action -> 
      void . K.withKafkaRetry1s $ writeActionJSONToKafka [action]
  
  Mod.get (Proxy @MP.StateRoot)


consumerGroup :: KP.ConsumerGroup
consumerGroup = lookupConsumerGroup "ethereum-vm"

getFirstBlockFromSequencer :: ContextM OutputBlock
getFirstBlockFromSequencer = do
    (VmBlock block) <- head <$> getUnprocessedKafkaEvents (KP.Offset 0)
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
    bootstrapChainDB sha
    setCheckpoint 1 (EVMCheckpoint sha header cbbi Nothing)


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
    K.withKafkaRetry1s (K.fetchSingleOffset consumerGroup topic 0) >>= \case
        Left KP.UnknownTopicOrPartition -> setCheckpointNoMetadata 1 >> getCheckpointNoMetadata
        Left err -> error $ "Unexpected response when fetching checkpoint: " ++ show err
        Right (ofs, _) -> do
            return ofs


setCheckpoint :: KP.Offset -> EVMCheckpoint -> ContextM ()
setCheckpoint ofs checkpoint = do
    $logInfoS "setCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs ++ " / " ++ format checkpoint
    let kMetadata = toKafkaMetadata checkpoint
    ret  <- K.withKafkaRetry1s $ K.commitSingleOffset consumerGroup seqVmEventsTopicName 0 ofs kMetadata
    either (error . show) return ret

setCheckpointNoMetadata :: KP.Offset -> ContextM ()
setCheckpointNoMetadata ofs = do
    $logInfoS "setCheckpointNoMetadata" . T.pack $ "Setting checkpoint to " ++ show ofs
    let emptyMetadata = KP.Metadata $ KP.KString BS.empty
    ret  <- K.withKafkaRetry1s $ K.commitSingleOffset consumerGroup seqVmEventsTopicName 0 ofs emptyMetadata
    either (error . show) return ret

getUnprocessedKafkaEvents :: KP.Offset -> ContextM [VmEvent]
getUnprocessedKafkaEvents offset = do
    $logInfoS "getUnprocessedKafkaEvents" . T.pack $ "Fetching sequenced blockchain events with offset " ++ show offset
    ret <- K.withKafkaRetry1s (readSeqVmEvents offset)
    let countLimit = if flags_seqEventsBatchSize > 0
                         then take flags_seqEventsBatchSize
                         else id
        eventLimit = if flags_seqEventsCostHeuristic > 0
                         then take num
                         else id
        num = length
            . takeWhile (<= flags_seqEventsCostHeuristic)
            . scanl (+) 0
            . map approxCost
            $ ret
        approxCost :: VmEvent -> Int
        approxCost = \case
          VmBlock OutputBlock{..} -> fromMaybe (length obReceiptTransactions)
                                     . extraData2TxsLen
                                     $ blockDataExtraData obBlockData
          _ -> 1

        ret' = eventLimit . countLimit $ ret
    return ret'

shouldProcessNewTransactions :: ContextM Bool -- todo: probably shouldn't do it by number, but tdiff.
shouldProcessNewTransactions =
    if flags_useSyncMode then do
        worldBestBlock <- fmap unWorldBestBlock <$> Mod.access (Mod.Proxy @(Maybe WorldBestBlock))
        case worldBestBlock of
            Nothing -> do
                $logInfoS "shouldProcessNewTransactions" "got Nothing from worldBestBlockInfo, playing it safe and not mining Txs"
                return False -- we either had no peers or some other error, lets play it safe
            Just (BestBlock worldBestSha _ _) -> do
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





logEventSummaries :: MonadLogger m => [VmEvent] -> m ()
logEventSummaries events = do
  let names = map getNames events
      numberedNames = map (\x -> numberIt (length x) (head x)) $ group $ sort names

  $logInfoS "getUnprocessedKafkaEvents" . T.pack $
    "#### Got: " ++ intercalate ", " numberedNames -- show numTXs ++ "TXs, " ++ show numBlocks ++ " blocks"

  where
    getNames :: VmEvent -> String
    getNames (VmTx _ _) = "TX"
    getNames (VmBlock _) = "Block"
    getNames (VmGenesis _) = "GenesisBlock"
    getNames (VmJsonRpcCommand _) = "JsonRpcCommand"

    getNames VmCreateBlockCommand = "CreateBlockCommand"
    getNames (VmVoteToMake _ _ _) = "VoteToMake"
    getNames (VmPrivateTx _) = "PrivateTx"

    numberIt :: Int -> String -> String
    numberIt 1 x = "1 " ++ x
    numberIt i x = show i ++ " " ++ x ++ "s"
