{-# LANGUAGE BangPatterns      #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE DerivingStrategies  #-}

module Executable.EthereumVM (
  ethereumVM,
  handleVmEvents,
  writeBlockSummary
) where

import           Conduit
import           Control.Applicative                   ((<|>))
import           Control.Arrow                         ((&&&), (***))
import           Control.Lens                          hiding (Context)
import           Control.Monad
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Trans.Maybe
import qualified Blockchain.Database.MerklePatricia    as MP
import qualified Data.ByteString                       as BS
import qualified Data.ByteString.Char8                 as BC
import           Data.Foldable                         hiding (fold)
import           Data.List
--import           Data.List.Split                       (chunksOf)
import qualified Data.Map                              as M
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set                              as S
import qualified Data.Sequence                         as Seq
import qualified Data.Text                             as T
import           Data.Traversable                      (for)
import           Debugger
import qualified Network.Kafka.Protocol                as KP
import           Prometheus
import           Text.Printf

import           Blockapps.Crossmon
import           BlockApps.Logging
import           Blockchain.BlockChain
import           Blockchain.Data.Block                 (BestBlock(..), WorldBestBlock(..))
import           Blockchain.Data.BlockHeader           (extraData2TxsLen)
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs              (blockDataExtraData, blockDataNumber, BlockData(..), TransactionResult(..))
import           Blockchain.Data.TransactionResultStatus
import           Blockchain.Data.GenesisBlock
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.ChainDB
import           Blockchain.EthConf
import           Blockchain.Event
import           Blockchain.JsonRpcCommand
import qualified Blockchain.MilenaTools                as K
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.MicroTime
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Stream.UnminedBlock        (produceUnminedBlocksM)
import           Blockchain.Stream.VMEvent
import           Blockchain.VMContext
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import           Executable.EVMCheckpoint
import           Executable.EVMFlags

import qualified Blockchain.Bagger                     as Bagger
import qualified Blockchain.Bagger.BaggerState         as B
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.AddressStateRef       (updateSQLBalanceAndNonce)
import           Blockchain.Data.ExecResults
import           Blockchain.DB.CodeDB                  (getCode, CodeKind(..))
import qualified Blockchain.DB.MemAddressStateDB       as Mem
import           Blockchain.DB.StorageDB
import qualified Blockchain.SolidVM                    as SolidVM
import           Blockchain.Strato.Indexer.Kafka       (writeIndexEvents)
import           Blockchain.Strato.Indexer.Model       (IndexEvent (..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Keccak256     (Keccak256)
import qualified Blockchain.Strato.Model.Keccak256     as Keccak256
import           Blockchain.Strato.StateDiff.Database  (commitSqlDiffs)
import           Blockchain.Stream.Action              (Action)
import qualified Blockchain.Stream.Action              as Action
import           Blockchain.Timing

import qualified Text.Colors                           as CL
import           Text.Format                           (format)
import           Text.Tools

-- newtype CertRoot = CertRoot { unCertRoot :: MP.StateRoot }
--   deriving (Eq, Ord, Show)

ethereumVM :: Maybe DebugSettings -> LoggingT IO ()
ethereumVM d = void . execContextM d $ do


    Bagger.setCalculateIntrinsicGas $ \i otx -> toInteger (calculateIntrinsicGas' i otx)
    (cpOffsetStart, EVMCheckpoint cpHash cpHead cpBBI cpSR ) <- getCheckpoint
    $logInfoLS "ethereumVM/getCheckpoint" (cpHash, cpBBI, cpSR)

    putContextBestBlockInfo cpBBI
    Mod.put Proxy $ BlockHashRoot cpSR

    Bagger.processNewBestBlock cpHash cpHead [] -- bootstrap Bagger with genesis block

    $logInfoS "evm/preLoop" $ T.pack $ "cpOffset = " ++ show cpOffsetStart
    forever $ loopTimeit "one full loop" $ do
        recordBaggerMetrics =<< contextGets _baggerState
        cpOffset <- getCheckpointNoMetadata
        $logInfoS "evm/loop" "Getting Blocks/Txs"
        seqEvents <- loopTimeit "======>>>> waiting for new events <<<<======" $ getUnprocessedKafkaEvents cpOffset

        logEventSummaries seqEvents

        let !vmInEventBatch = foldr insertInBatch newInBatch seqEvents
        trs <- runConduit $ yield vmInEventBatch
                         .| handleVmEvents flags_useSyncMode
                         .| awaitForever sendOutEvent
                         .| sinkList
        void . produceVMEvents $ NewTransactionResult <$> trs
        
        loopTimeit "compactContextM" $ compactContextM

        let newOffset = cpOffset + fromIntegral (length seqEvents)
        baggerData <- uncurry EVMCheckpoint <$> Bagger.getCheckpointableState
        checkpointData <- baggerData <$> getContextBestBlockInfo
        withChainroot <- checkpointData . unBlockHashRoot <$> Mod.get Proxy
        -- withCertroot <- withChainroot . unCertRoot <$> Mod.get Proxy
        setCheckpoint newOffset withChainroot

microtimeCutoff :: Microtime
microtimeCutoff = secondsToMicrotime flags_mempoolLivenessCutoff
{-# NOINLINE microtimeCutoff #-}

handleVmEvents :: (MonadFail m, Bagger.MonadBagger m, MonadMonitor m, Mod.Accessible RBDB.RedisConnection m)
               => Bool -> ConduitT VmInEventBatch VmOutEvent m ()
handleVmEvents useSyncMode = awaitForever $ \InBatch{..} -> do
  rpcResps <- lift $ do
    bbHash <- maybe Keccak256.zeroHash fst <$> getChainBestBlock Nothing
    resps <- withCurrentBlockHash bbHash $ traverse runJsonRpcCommand' rpcCommands
    recordSeqEventCount bLen tLen
    pure resps
  yieldMany $! uncurry OutJSONRPC <$> rpcResps

  numPoolable <- uncurry (*>) . (yieldMany *** pure) =<< lift (processTransactions txPairs)
  yieldMany $ outputPrivateTransactions privateTxs
  processBlocksAndNewChains blocksAndNewChains

  mNewBlock <- lift $ do
    Mod.modify_ (Mod.Proxy @ContextState) $ pure . (blockRequested ||~ createBlock)
    -- todo: perhaps we shouldnt even add TXs to the mempool, it might make for a VERY large checkpoint
    -- todo: which may fail
    isCaughtUp <- shouldProcessNewTransactions useSyncMode
    bState <- Bagger.getBaggerState
    pbft <- _hasBlockstanbul <$> Mod.get (Mod.Proxy @ContextState)
    reqd <- _blockRequested <$> Mod.get (Mod.Proxy @ContextState)
    synced <- fromMaybe False <$> RBDB.withRedisBlockDB RBDB.getSyncStatusNow
    $logInfoS "evm/loop/newBlock/syncStatus" . T.pack . CL.yellow . show $ synced
    Mod.modify_ (Mod.Proxy @ContextState) $ pure . (isSynced &&~ synced)
    let makeLazyBlocks = False --lazyBlocks $ quarryConfig ethConf -- TODO?: Remove reference to ethConf
        pending = B.pending bState
        priv = toList . B.privateHashes $ B.miningCache bState
        hasTxs = (numPoolable > 0) || not (M.null pending) || not (null priv)
        shouldOutputBlocks = isCaughtUp && (
          if pbft
            then reqd && hasTxs
            else not makeLazyBlocks || hasTxs)
    $logInfoS "evm/loop/newBlock" . T.pack $ printf "Num poolable: %d, num pending: %d"
        numPoolable (M.size pending)
    multilineLog "evm/loop/newBlock" $ boringBox [
        CL.yellow "Decision making for block creation:",
        "isCaughtUp: " ++ formatBool isCaughtUp,
        "pbft: " ++ formatBool pbft,
        "reqd: " ++ formatBool reqd,
        "hasTxs: " ++ formatBool hasTxs,
        "makeLazyBlocks: " ++ formatBool makeLazyBlocks,
        "shouldOutputBlocks: " ++ formatBool shouldOutputBlocks
      ]
    when (pbft && shouldOutputBlocks) $
      Mod.modify_ (Mod.Proxy @ContextState) $ pure . (blockRequested .~ False)
    $logDebugS "evm/loop/newBlock" $ T.pack $ "Queued: " ++ show numPoolable
    $logDebugS "evm/loop/newBlock" $ T.pack $ "Pending: " ++ show (length pending)
    $logInfoS "evm/loop/newBlock" "about to evaluate shouldOutputBlocks"
    if shouldOutputBlocks
      then do
        $logInfoS "evm/loop/newBlock" "calling Bagger.makeNewBlock"
        newBlock <- Bagger.makeNewBlock mineTransactions
        pure $ Just newBlock
      else pure Nothing
  traverse_ (yield . OutBlock) mNewBlock

groupEithers :: [Either a b] -> [Either [a] [b]]
groupEithers = foldr f []
  where f (Left l)   b = let ~(ls, es) = case b of
                               (Left ls'):es' -> (ls', es')
                               es' -> ([], es')
                          in (Left $ l : ls) : es
        f (Right r)  b = let ~(rs, es) = case b of
                               (Right rs'):es' -> (rs', es')
                               es' -> ([], es')
                          in (Right $ r : rs) : es

processBlocksAndNewChains :: (MonadFail m, Bagger.MonadBagger m, MonadMonitor m)
                          => [Either OutputGenesis OutputBlock]
                          -> ConduitT a VmOutEvent m ()
processBlocksAndNewChains blocksAndChains = do
  let !grouped = groupEithers blocksAndChains
  for_ grouped $ \case
    Left newChains -> outputNewChains =<< insertNewChains newChains
    Right blocks -> processBlocks blocks

insertNewChains :: VMBase m
                => [OutputGenesis]
                -> ConduitT a VmOutEvent m [(Word256, ChainInfo, Keccak256, [ExecResults])]
insertNewChains ogs = fmap catMaybes . forM ogs $ \OutputGenesis{..} -> do
  let (cId, cInfo) = ogGenesisInfo
  $logInfoS "insertNewChains" $ T.pack $ "Inserting Chain ID: " ++ CL.yellow (format cId)
  $logDebugS "insertNewChains" $ T.pack $ "With ChainInfo: " ++ show cInfo
  mGSR <- getGenesisStateRoot $ Just cId
  case mGSR of
    Just gsr -> do
      $logInfoS "insertNewChains" $ T.pack $ "We already have a genesis state root for this chain. It's " ++ format gsr
      return Nothing
    Nothing -> do
      let cBlock = creationBlock $ chainInfo cInfo
          pChains = parentChains $ chainInfo cInfo
      bHash <- if cBlock /= Keccak256.zeroHash
                 then pure cBlock
                 else do
                   mBB <- getChainGenesisInfo Nothing
                   case mBB of
                     Just (bb, _, _) -> pure bb
                     Nothing -> error "insertNewChains: could not find non-zero block hash to run from. Chain DB not bootstrapped correctly"

      withCurrentBlockHash bHash $ do
        $logInfoS "insertNewChains" $ T.pack $ "This is a new chain!"
        let theVM = T.unpack $ fromMaybe "EVM" $ M.lookup "VM" $ chainMetadata (chainInfo cInfo)
            tHash = Keccak256.unsafeCreateKeccak256FromWord256 cId
        sr' <- chainInfoToGenesisState theVM (Just cId) cInfo
        void $ putChainGenesisInfo (Just cId) cBlock sr' pChains
        (kind, (sr, addrsCreated, mExecResults)) <-           
          case theVM of
            "SolidVM" -> lift $ (SolidVM,) <$> runChainConstructors cId cInfo
            _ -> return (EVM, (sr', [], [])) -- TODO: add contracts from accountInfo list?
        case catMaybes $ erException <$> mExecResults of
          [] -> do
            yieldMany . concat $! map (OutLog . mkLogEntry bHash tHash (Just cId)) . erLogs <$> mExecResults
            yieldMany . concat $! map (OutEvent . mkEventEntry (Just cId)) . erEvents <$> mExecResults
            let (orgName, appName) = case mExecResults of
                                       [] -> ("","")
                                       x:_ -> (erOrgName x, erAppName x)
            when flags_createTransactionResults $
              yield . OutTXR $
                     TransactionResult { transactionResultBlockHash        = cBlock
                                       , transactionResultTransactionHash  = tHash
                                       , transactionResultMessage          = "Success!"
                                       , transactionResultResponse         = case kind of
                                                                               EVM -> ""
                                                                               SolidVM -> "()"
                                       , transactionResultTrace            = unlines $ unlines . reverse . erTrace <$> mExecResults
                                       , transactionResultGasUsed          = 0
                                       , transactionResultEtherUsed        = 0
                                       , transactionResultContractsCreated = intercalate "," $ map show addrsCreated
                                       , transactionResultContractsDeleted = ""
                                       , transactionResultStateDiff        = ""
                                       , transactionResultTime             = 0.0
                                       , transactionResultNewStorage       = ""
                                       , transactionResultDeletedStorage   = ""
                                       , transactionResultStatus           = Just Success
                                       , transactionResultChainId          = Just cId
                                       , transactionResultKind             = Just kind
                                       , transactionResultOrgName          = orgName
                                       , transactionResultAppName          = appName
                                       }
            Just (cId, cInfo, bHash, mExecResults) <$ putChainGenesisInfo (Just cId) cBlock sr pChains
          x:_ -> do
            let fmt = either show show x
            when flags_createTransactionResults $
              yield . OutTXR $
                     TransactionResult { transactionResultBlockHash        = cBlock
                                       , transactionResultTransactionHash  = tHash
                                       , transactionResultMessage          = fmt
                                       , transactionResultResponse         = case kind of
                                                                               EVM -> ""
                                                                               SolidVM -> "()"
                                       , transactionResultTrace            = unlines $ unlines . reverse . erTrace <$> mExecResults
                                       , transactionResultGasUsed          = 0
                                       , transactionResultEtherUsed        = 0
                                       , transactionResultContractsCreated = ""
                                       , transactionResultContractsDeleted = ""
                                       , transactionResultStateDiff        = ""
                                       , transactionResultTime             = 0.0
                                       , transactionResultNewStorage       = ""
                                       , transactionResultDeletedStorage   = ""
                                       , transactionResultStatus           = Just $ Failure "Execution" Nothing (ExecutionFailure fmt) Nothing Nothing (Just fmt)
                                       , transactionResultChainId          = Just cId
                                       , transactionResultKind             = Just kind
                                       , transactionResultOrgName          = ""
                                       , transactionResultAppName          = ""
                                       }
            return Nothing

outputNewChains :: VMBase m => [(Word256, ChainInfo, Keccak256, [ExecResults])] -> ConduitT a VmOutEvent m ()
outputNewChains = traverse_ $ \(cId, cInfo, bHash, execr) -> do
  yield . OutIndexEvent $! NewChainInfo cId cInfo
  let org = fromMaybe "" $ do
        e <- listToMaybe execr
        a <- erAction e
        d <- listToMaybe . M.toList $ a ^. Action.actionData
        pure $ d ^. _2 . Action.actionDataOrganization
      app = fromMaybe "" $ do
        e <- listToMaybe execr
        a <- erAction e
        d <- listToMaybe . M.toList $ a ^. Action.actionData
        pure $ d ^. _2 . Action.actionDataApplication
  yield $ OutToStateDiff cId cInfo bHash org app
  for_ (catMaybes $ erAction <$> execr) $ yield . OutAction
  for_ (concatMap erEvents execr) $ yield . OutEvent . mkEventEntry (Just cId)

processBlocks :: (MonadFail m, Bagger.MonadBagger m, MonadMonitor m)
              => [OutputBlock]
              -> ConduitT a VmOutEvent m ()
processBlocks blocks = do
  $logInfoS "evm/processBlocks" $ T.pack $ "Running " ++ show (length blocks) ++ " blocks"
  processBlockSummaries blocks
  addBlocks blocks

processBlockSummaries :: ( MonadIO m
                         , MonadLogger m
                         , HasBlockSummaryDB m
                         )
                      => [OutputBlock]
                      -> m ()
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
  writeBlockSummary b

processTransactions :: ( Bagger.MonadBagger m
                       )
                    => [(Timestamp, OutputTx)]
                    -> m ([VmOutEvent], Int)
processTransactions = uncurry (fmap . (,)) . (outputTransactions &&& getNumPoolable)

getNumPoolable :: ( Bagger.MonadBagger m
                  )
               => [(Timestamp, OutputTx)]
               -> m Int
getNumPoolable txPairs = do
  $logDebugS "evm/getNumPoolable" $ T.pack $ "allTxs :: " ++ show txPairs
  let allNewTxs = filter (isNothing . txChainId . otBaseTx . snd) txPairs -- PrivateHashTXs have chainId = Nothing
  !currentMicrotime <- liftIO getCurrentMicrotime
  $logInfoS "evm/getNumPoolable" $ T.pack $ "currentMicrotime :: " ++ show currentMicrotime

  forM_ allNewTxs $ \(ts, _) ->
      $logInfoS "evm/getNumPoolable/allNewTxs" $ T.pack $ "math :: " ++ show currentMicrotime ++ " - " ++ show ts ++ " = " ++ show (currentMicrotime - ts) ++ "; <= " ++ show microtimeCutoff ++ "? " ++ show ((currentMicrotime - ts) <= microtimeCutoff)
  let !poolableNewTxs = [t | (ts, t) <- allNewTxs, abs (currentMicrotime - ts) <= microtimeCutoff]
  $logInfoS "evm/loop" (T.pack ("adding " ++ show (length poolableNewTxs) ++ "/" ++ show (length allNewTxs) ++ " txs to mempool"))
  unless (null poolableNewTxs) $ Bagger.addTransactionsToMempool poolableNewTxs
  return $ length poolableNewTxs

outputTransactions :: [(Timestamp, OutputTx)] -> [VmOutEvent]
outputTransactions = map $ OutIndexEvent . uncurry IndexTransaction

outputPrivateTransactions :: [OutputTx] -> [VmOutEvent]
outputPrivateTransactions = map $ OutIndexEvent . IndexPrivateTx

-- TODO: maybe move this into solid-vm?
runChainConstructors :: SolidVM.SolidVMBase m => Word256 -> ChainInfo -> m (MP.StateRoot, [Address], [ExecResults])
runChainConstructors cId cInfo = do
  -- We are inventing the rules of how the constructor should run when a chain is created.
  -- Since all VM runs need some environment variables passed in, we need to define what all of
  -- those variables should be.  The truth is, most of these variables are rarely used, but we
  -- still need to pre-decide what they should be else the VM would crash whenever they are used.
  -- I've set most of these variables to default dummy values below...  We might decide to refine
  -- some of these variables in the future.

  let getSrcBS = BC.pack . T.unpack . codeInfoSource
      getCodeHash ci = Keccak256.hash $ getSrcBS ci
      codeHashMap = M.fromList . map (getCodeHash &&& codeInfoSource) $ codeInfo $ chainInfo cInfo
      resolveSrc a ch = do
        mcp <- resolveCodePtr (Just cId) ch
        msrc <- runMaybeT $ do
          cp <- MaybeT $ pure mcp
          hsh <- MaybeT $ pure $ case cp of
            SolidVMCode _ h -> Just h
            EVMCode h -> Just h
            CodeAtAccount _ _ -> Nothing
          (MaybeT $ pure $ M.lookup hsh codeHashMap) <|>
            MaybeT (fmap (T.pack . BC.unpack . snd) <$> getCode hsh)
        pure $ Just (a,msrc)
      sender = Account (fromMaybe 0 $ whoSignedThisChainInfo cInfo) $ Just cId
  curBlockHash <- Mod.get (Mod.Proxy @CurrentBlockHash )
  curBlockSummary <- getBSum $ unCurrentBlockHash curBlockHash
  (addrs, actions) <- fmap (unzip . catMaybes) . for (accountInfo $ chainInfo cInfo) $ \aInfo -> do
    addrSrc <- case aInfo of
      NonContract{} -> pure Nothing
      ContractNoStorage a _ ch -> resolveSrc a ch
      ContractWithStorage a _ ch _ -> resolveSrc a ch
      SolidVMContractWithStorage a _ ch _ -> resolveSrc a ch
    for addrSrc $ \(addr,ms) -> (addr,) <$> SolidVM.call
         False --isRunningTests
         True --isHomestead
         False --noValueTransfer
         True -- isRunChainConstructors
         S.empty --pre-existing suicide list
         (BlockData
            (Keccak256.unsafeCreateKeccak256FromWord256 0)
            (Keccak256.unsafeCreateKeccak256FromWord256 0)
            emptyChainMember
            MP.emptyTriePtr
            MP.emptyTriePtr
            MP.emptyTriePtr
            ""
            0
            0 --block number
            100000000000
            0
            (bSumTimestamp curBlockSummary)
            ""
            0
            (Keccak256.unsafeCreateKeccak256FromWord256 0))
         0 --callDepth
         (Account 0 $ Just cId) --receiveAddress
         (Account addr $ Just cId) --codeAddress
         sender
         0 --value
         1 --gasPrice
         ""
         1000000000000 --availableGas
         sender
         (Keccak256.unsafeCreateKeccak256FromWord256 0)
         (Just cId)
         (Just $ M.fromList $
           [ ("args", fromMaybe "()" (M.lookup "args" . chainMetadata $ chainInfo cInfo))
           , ("funcName", "<constructor>")
           , ("history", fromMaybe "" (M.lookup "history" . chainMetadata $ chainInfo cInfo))
           ]
           ++ case ms of Nothing -> []; Just s -> [("src", s)])

  -- let evs = Action._events <$> actions
  -- $logInfoS "Events" (T.pack $ show evs)

  flushMemStorageDB
  Mem.flushMemAddressStateDB

  sr <- A.lookupWithDefault (Proxy @MP.StateRoot) (Just cId)
  return (sr, addrs, actions) 

initializeCheckpointAndBlockSummary :: ( HasBlockSummaryDB m
                                       , Mod.Modifiable BlockHashRoot m
                                       , Mod.Modifiable GenesisRoot m
                                       , (MP.StateRoot `A.Alters` MP.NodeData) m
                                       )
                                    => OutputBlock
                                    -> m EVMCheckpoint
initializeCheckpointAndBlockSummary block = do
  let evmc@(EVMCheckpoint sha _ _ sr ) = outputBlockToEvmCheckpoint block
  writeBlockSummary block
  (BlockHashRoot bhr) <- bootstrapChainDB sha [(Nothing, sr)]
  return evmc{ ctxChainDBStateRoot = bhr
             }

outputBlockToEvmCheckpoint :: OutputBlock -> EVMCheckpoint
outputBlockToEvmCheckpoint block =
  let sha    = outputBlockHash block
      header = obBlockData block
      txs    = obReceiptTransactions block
      td     = obTotalDifficulty block
      txL    = length txs
      uncL   = length (obBlockUncles block)
      cbbi   = ContextBestBlockInfo sha header td txL uncL
      sr     = blockDataStateRoot header
   in EVMCheckpoint sha header cbbi sr 

writeBlockSummary :: HasBlockSummaryDB m => OutputBlock -> m ()
writeBlockSummary block =
    let sha    = outputBlockHash block
        header = obBlockData block
        td     = obTotalDifficulty block
        txCnt  = fromIntegral $ length (obReceiptTransactions block)
    in
        putBSum sha (blockHeaderToBSum header td txCnt)

shouldProcessNewTransactions :: ( MonadLogger m
                                , Mod.Accessible (Maybe WorldBestBlock) m
                                , HasBlockSummaryDB m
                                )
                             => Bool -> m Bool -- todo: probably shouldn't do it by number, but tdiff.
shouldProcessNewTransactions useSyncMode =
  if useSyncMode
    then do
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
      $logInfoS "shouldProcessNewTransactions" "useSyncMode == false, will process all new TXs"
      return True

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

sendOutEvent :: VmOutEvent ->  ConduitT VmOutEvent TransactionResult ContextM ()
sendOutEvent (OutAction act) =
  let filterOutEvents :: Action -> Action
      filterOutEvents x = x{Action._events=Seq.empty}
      extractCodeCollectionAddedMessages :: Action -> Maybe VMEvent
      extractCodeCollectionAddedMessages a =
        case (join $ fmap (M.lookup "src") $ a^.Action.metadata,
              join $ fmap (M.lookup "name") $ a^.Action.metadata,
              M.toList $ a^.Action.actionData) of
          (Just c, Just n, first:_) -> Just $ CodeCollectionAdded {
              ccString = c,
              codePtr =
                  case join $ fmap (M.lookup "VM") $ a^.Action.metadata of
                    Just "SolidVM" -> SolidVMCode (T.unpack n) $ Keccak256.hash $ BC.pack $ T.unpack c
                    Just "EVM" -> EVMCode $ Keccak256.hash $ BC.pack $ T.unpack c
                    Just v -> error $ "Unknown VM: " ++ show v
                    Nothing -> EVMCode $ Keccak256.hash $ BC.pack $ T.unpack c,
              organization = first^._2.Action.actionDataOrganization,
              application = n,
              historyList=
                  case join $ fmap (M.lookup "history") (a^.Action.metadata) of
                    Nothing -> []
                    Just v -> T.splitOn "," v
            }
          _ -> Nothing
      ccEvents = maybeToList $ extractCodeCollectionAddedMessages act
      eventEvents = map EventEmitted . toList $ Action._events act
      actionEvents = [NewAction $ filterOutEvents act]
   in void . produceVMEvents $ ccEvents ++ eventEvents ++ actionEvents
sendOutEvent (OutBlock o) = loopTimeit "produceUnminedBlocksM" $
  void . K.withKafkaRetry1s $ produceUnminedBlocksM [outputBlockToBlock o]
sendOutEvent (OutIndexEvent e) = void . K.withKafkaRetry1s $ writeIndexEvents [e]
sendOutEvent (OutToStateDiff cId cInfo bHash org app) = lift . withCurrentBlockHash bHash $ initializeChainDBs (Just cId) cInfo org app
sendOutEvent (OutStateDiff diff) = lift $ commitSqlDiffs diff
sendOutEvent (OutLog l) = loopTimeit "flushLogEntries" $ void . K.withKafkaRetry1s $ writeIndexEvents [LogDBEntry l]
sendOutEvent (OutEvent e) = loopTimeit "flushEventEntries" $ void . K.withKafkaRetry1s $ writeIndexEvents [EventDBEntry e]
sendOutEvent (OutTXR tr) = yield tr
sendOutEvent (OutASM asm) = when (not flags_sqlDiff) $
  timeit "updateSQLBalanceAndNonce" (Just vmBlockInsertionMined) $
    lift . updateSQLBalanceAndNonce $
      [ (theAccount,
         (addressStateBalance asMod, addressStateNonce asMod))
      | (theAccount, Mem.ASModification asMod) <- M.toList asm
      ]
sendOutEvent (OutJSONRPC s b) = liftIO $ produceResponse s b

-- sendOutEvents :: VmOutEventBatch -> ContextM ()
-- sendOutEvents OutBatch{..} = do
--   let
--     filterOutEvents :: Action -> Action
--     filterOutEvents x = x{Action._events=Seq.empty}
-- --    filterOutMetadata :: Action -> Action
-- --    filterOutMetadata x = x{Action._metadata=Nothing}
-- 
--     extractCodeCollectionAddedMessages :: Action -> Maybe VMEvent
--     extractCodeCollectionAddedMessages a =
--       case (join $ fmap (M.lookup "src") $ a^.Action.metadata,
--             join $ fmap (M.lookup "name") $ a^.Action.metadata,
--             M.toList $ a^.Action.actionData) of
--         (Just c, Just n, first:_) -> Just $ CodeCollectionAdded {
--             ccString = c,
--             codePtr =
--                 case join $ fmap (M.lookup "VM") $ a^.Action.metadata of
--                   Just "SolidVM" -> SolidVMCode (T.unpack n) $ Keccak256.hash $ BC.pack $ T.unpack c
--                   Just "EVM" -> EVMCode $ Keccak256.hash $ BC.pack $ T.unpack c
--                   Just v -> error $ "Unknown VM: " ++ show v
--                   Nothing -> EVMCode $ Keccak256.hash $ BC.pack $ T.unpack c,
--             organization = first^._2.Action.actionDataOrganization,
--             application = n,
--             historyList=
--                 case join $ fmap (M.lookup "history") (a^.Action.metadata) of
--                   Nothing -> []
--                   Just v -> T.splitOn "," v
--           }
--         _ -> Nothing
--   
--   for_ outJSONRPCs $ liftIO . uncurry produceResponse
--   for_ outToStateDiffs $ \(cId, cInfo, bHash, org, app) ->
--     withCurrentBlockHash bHash $ initializeChainDBs (Just cId) cInfo org app
--   traverse_ commitSqlDiffs outStateDiffs
--   when (not flags_sqlDiff) $
--     timeit "updateSQLBalanceAndNonce" (Just vmBlockInsertionMined) $
--       forM_ outASMs $ \asm -> do
--         updateSQLBalanceAndNonce $
--           [ (theAccount,
--              (addressStateBalance asMod, addressStateNonce asMod))
--           | (theAccount, Mem.ASModification asMod) <- M.toList asm
--           ]
-- 
--   let ccEvents = concat (map (maybeToList . extractCodeCollectionAddedMessages) (toList outActions))
--       eventEvents = concat (map (map EventEmitted . toList . Action._events) (toList outActions))
--       actionEvents = map (NewAction . filterOutEvents) (toList outActions)
--       --actionEvents =  map (NewAction . filterOutMetadata . filterOutEvents) (toList outActions)
--       trEvents = map NewTransactionResult $ toList outTXRs
--           
--   loopTimeit "produceVMEvents" $ do
--     $logInfoS "sendOutEvents" $ "outputting VMEvents"
--     _ <- produceVMEvents $ ccEvents ++ eventEvents ++ actionEvents ++ trEvents
--     return ()
--   
--   loopTimeit "produceUnminedBlocksM" $
--     void . K.withKafkaRetry1s . produceUnminedBlocksM $
--       outputBlockToBlock <$> toList outBlocks
--   void . K.withKafkaRetry1s . writeIndexEvents $ toList outIndexEvents
--   loopTimeit "flushLogEntries" $ do
--     void . K.withKafkaRetry1s $ writeIndexEvents (LogDBEntry <$> toList outLogs)
--   loopTimeit "flushEventEntries" $ do
--     void . K.withKafkaRetry1s $ writeIndexEvents (EventDBEntry <$> toList outEvents)
-- -- I've moved the transaction result indexing to slipstream and the VMEvent stream, above
-- -- I'll keep the old code commented out below until we verify that the changes all work.
-- --  loopTimeit "flushTransactionResults" $ do
-- --    let q = toList outTXRs
-- --        toWrite = chunksOf 2000 $ TxResult <$> q
-- --    recordTxrFlush $ length q
-- --    mapM_ (K.withKafkaRetry1s . writeIndexEvents) toWrite

consumerGroup :: KP.ConsumerGroup
consumerGroup = lookupConsumerGroup "ethereum-vm"

getFirstBlockFromSequencer :: ContextM OutputBlock
getFirstBlockFromSequencer = do
    (VmBlock block) <- head <$> getUnprocessedKafkaEvents (KP.Offset 0)
    return block

-- this one starts at 1, 0 is reserved for genesis block and is used to
-- bootstrap a ton of this
-- Also seeds the BlockSummaryDatabase
initializeCheckpointAndBlockSummaryKafka :: ContextM ()
initializeCheckpointAndBlockSummaryKafka = do
  block <- getFirstBlockFromSequencer
  checkpoint <- initializeCheckpointAndBlockSummary block
  setCheckpoint 1 checkpoint

getCheckpoint :: ContextM (KP.Offset, EVMCheckpoint)
getCheckpoint = do
    let topic  = seqVmEventsTopicName
        topic' = show topic
        cg'    = show consumerGroup
    $logInfoS "getCheckpoint" . T.pack $ "Getting checkpoint for " ++ topic' ++ "#0 for " ++ cg'
    K.withKafkaRetry1s (K.fetchSingleOffset consumerGroup topic 0) >>= \case
        Left KP.UnknownTopicOrPartition -> initializeCheckpointAndBlockSummaryKafka >> getCheckpoint
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

        !ret' = eventLimit . countLimit $ ret
    return ret'
