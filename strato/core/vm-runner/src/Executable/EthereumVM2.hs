{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Executable.EthereumVM2
  ( handleVmEvents,
    writeBlockSummary,
  )
where

--import           Data.List.Split                       (chunksOf)

import BlockApps.Crossmon
import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import qualified Blockchain.Bagger.BaggerState as B
import Blockchain.BlockChain
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.Blockstanbul (PreprepareDecision(..))
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB (CodeKind (..), getCode)
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs (TransactionResult (..))
import Blockchain.Data.ExecResults
import Blockchain.Data.GenesisBlock
import Blockchain.Data.TransactionResultStatus
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Event hiding (selfAddress)
import Blockchain.JsonRpcCommand
import Blockchain.Sequencer.Event
import qualified Blockchain.SolidVM as SolidVM
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas (Gas (..))
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import qualified Blockchain.Strato.Model.Keccak256 as Keccak256
import Blockchain.Strato.Model.MicroTime
import qualified Blockchain.Stream.Action as Action
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.VMOptions
import Conduit hiding (Flush)
import Control.Applicative ((<|>))
import Control.Arrow ((&&&), (***))
import Control.Lens hiding (Context)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Trans.Maybe
import qualified Data.ByteString.Char8 as BC
import Data.Foldable hiding (fold)
import Data.List
import qualified Data.Map as M
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import Data.Proxy
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Traversable (for)
import Executable.EVMFlags
import Prometheus
import qualified Text.Colors as CL
import Text.Format (format)
import Text.Printf
import Text.Tools

microtimeCutoff :: Microtime
microtimeCutoff = secondsToMicrotime flags_mempoolLivenessCutoff
{-# NOINLINE microtimeCutoff #-}

handleVmEvents ::
  (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) =>
  ConduitT VmInEventBatch VmOutEvent m ()
handleVmEvents = awaitForever $ \InBatch {..} -> do
  mpResps <- lift $ for mpNodesReqs $ \(o, srs) -> do
    nds <- catMaybes <$> traverse (A.lookup (A.Proxy @MP.NodeData)) srs
    pure $! OutMPNodesResponse o nds
  yieldMany $! mpResps

  rpcResps <- lift $ do
    bbHash <- maybe Keccak256.zeroHash fst <$> getChainBestBlock Nothing
    resps <- withCurrentBlockHash bbHash $ traverse runJsonRpcCommand' rpcCommands
    recordSeqEventCount bLen tLen
    pure resps
  yieldMany $! uncurry OutJSONRPC <$> rpcResps

  numPoolable <- uncurry (*>) . (yieldMany *** pure) =<< lift (processTransactions txPairs)
  yieldMany $ outputPrivateTransactions privateTxs
  processBlocksAndNewChains blocksAndNewChains


  mPreDec <- lift $ do
    case preprepareBlock of
      Nothing -> pure Nothing
      Just block -> do
        let bHeader = blockBlockData block
            bHash = blockHeaderHash bHeader
            -- bro if there are any maybes in this list thaz BAD
            -- private txs don't affect stateroot we compute
            otxs = catMaybes $ wrapIngestBlockTransaction  bHash <$> [t | t <- blockReceiptTransactions block, txType t /= PrivateHash]
        mSumm <- A.lookup (A.Proxy @BlockSummary) (parentHash bHeader)
        case mSumm of 
          Nothing -> pure Nothing
          Just summ -> do
            let bHeader' = case bHeader of
                            -- imitate parent block as closely as possible (most important is the stateroot)
                            BlockHeader {} -> bHeader { 
                              parentHash = bSumParentHash summ,
                              stateRoot = bSumStateRoot summ,
                              number = bSumNumber summ,
                              gasLimit = bSumGasLimit summ
                            }
                            BlockHeaderV2 {} -> bHeader { 
                              parentHash = bSumParentHash summ,
                              stateRoot = bSumStateRoot summ,
                              number = bSumNumber summ
                            }
            let pHash = proposalHash bHeader
                mSig = getProposerSeal bHeader  -- Signature is Maybe type
            proposer <- case mSig of
                            Just sig -> do
                                let (r, s, v) = getSigVals sig
                                    proposerAddress = whoReallySignedThisTransactionEcrecover pHash r s (v - 0x1b)
                                case proposerAddress of
                                  Just addr ->  return addr
                                  Nothing -> error "no proposer"
                            Nothing -> error "no proposer"
            res <- Bagger.runFromStateRoot 
              --account
              mineTransactions 
              (bSumGasLimit summ) 
              bHeader'
              otxs 
              proposer
            case res of 
              Right (sr, trrs, _) -> do 
                $logDebugS "handleVmEvents/preprepareBlock" . T.pack $ "Stateroot we got: " <> format sr
                $logDebugS "handleVmEvents/preprepareBlock" . T.pack $ "Stateroot in block: " <> format (stateRoot bHeader)
                blockFailures <- verifyBlock block (trrs, Just sr) summ
                case blockFailures of 
                  [] -> pure . Just $ AcceptPreprepare bHash
                  _  -> do
                    $logDebugS "handleVmEvents/preprepareBlock" . T.pack $ show blockFailures
                    pure $ Just RejectPreprepare
              _ -> pure $ Just RejectPreprepare
  $logDebugS "handleVmEvents/mPreDec" . T.pack $ format mPreDec
  traverse_ (yield . OutPreprepareResponse) mPreDec

  mSelfAddress <- _selfAddress <$> Mod.get (Mod.Proxy @ContextState)
  mNewBlock <- lift $ do
    Mod.modify_ (Mod.Proxy @ContextState) $ pure . (blockRequested ||~ createBlock)
    -- todo: perhaps we shouldnt even add TXs to the mempool, it might make for a VERY large checkpoint
    -- todo: which may fail
    bState <- Bagger.getBaggerState
    pbft <- _hasBlockstanbul <$> Mod.get (Mod.Proxy @ContextState)
    reqd <- _blockRequested <$> Mod.get (Mod.Proxy @ContextState)
    let makeLazyBlocks = False --lazyBlocks $ quarryConfig ethConf -- TODO?: Remove reference to ethConf
        pending = B.pending bState
        priv = toList . B.privateHashes $ B.miningCache bState
        hasTxs = (numPoolable > 0) || not (M.null pending) || not (null priv)
        shouldOutputBlocks =
          if pbft
            then reqd && hasTxs
            else not makeLazyBlocks || hasTxs
    $logInfoS "evm/loop/newBlock" . T.pack $
      printf
        "Num poolable: %d, num pending: %d"
        numPoolable
        (M.size pending)
    multilineLog "evm/loop/newBlock" $
      boringBox
        [ CL.yellow "Decision making for block creation:",
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
        newBlock <- Bagger.makeNewBlock mineTransactions mSelfAddress
        pure $ Just newBlock 
      else pure Nothing
    
  for_ mNewBlock $ yield . OutBlock 

groupEithers :: [Either a b] -> [Either [a] [b]]
groupEithers = foldr f []
  where
    f :: Either a b -> [Either [a] [b]] -> [Either [a] [b]]
    f (Left l) ((Left ls):es) = (Left (l:ls)) : es
    f (Right r) ((Right rs):es) = (Right (r:rs)) : es
    f (Left l) es = (Left [l]) : es
    f (Right r) es = (Right [r]) : es

processBlocksAndNewChains ::
  (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) =>
  [Either OutputGenesis OutputBlock] ->
  ConduitT a VmOutEvent m ()
processBlocksAndNewChains blocksAndChains = do
  let !grouped = groupEithers blocksAndChains
  for_ grouped $ \case
    Left newChains -> outputNewChains =<< insertNewChains newChains
    Right blocks -> processBlocks blocks

insertNewChains ::
  VMBase m =>
  [OutputGenesis] ->
  ConduitT a VmOutEvent m [(Word256, ChainInfo, Keccak256, [ExecResults])]
insertNewChains ogs = fmap catMaybes . forM ogs $ \OutputGenesis {..} -> do
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
      bHash <-
        if cBlock /= Keccak256.zeroHash
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
            yield . OutEvent . concat $! map (mkEventEntry (Just cId)) . erEvents <$> mExecResults
            let (creator, appName) = case mExecResults of
                  [] -> ("", "")
                  x : _ -> (erCreator x, erAppName x)
            yield . OutTXR $
              TransactionResult
                { transactionResultBlockHash = cBlock,
                  transactionResultTransactionHash = tHash,
                  transactionResultMessage = "Success!",
                  transactionResultResponse = case kind of
                    EVM -> ""
                    SolidVM -> "()",
                  transactionResultTrace = unlines $ unlines . reverse . erTrace <$> mExecResults,
                  transactionResultGasUsed = 0,
                  transactionResultEtherUsed = 0,
                  transactionResultContractsCreated = intercalate "," $ map show addrsCreated,
                  transactionResultContractsDeleted = "",
                  transactionResultStateDiff = "",
                  transactionResultTime = 0.0,
                  transactionResultNewStorage = "",
                  transactionResultDeletedStorage = "",
                  transactionResultStatus = Just Success,
                  transactionResultChainId = Just cId,
                  transactionResultKind = Just kind,
                  transactionResultCreator = creator,
                  transactionResultAppName = appName
                }
            Just (cId, cInfo, bHash, mExecResults) <$ putChainGenesisInfo (Just cId) cBlock sr pChains
          x : _ -> do
            let fmt = either show show x
            yield . OutTXR $
              TransactionResult
                { transactionResultBlockHash = cBlock,
                  transactionResultTransactionHash = tHash,
                  transactionResultMessage = fmt,
                  transactionResultResponse = case kind of
                    EVM -> ""
                    SolidVM -> "()",
                  transactionResultTrace = unlines $ unlines . reverse . erTrace <$> mExecResults,
                  transactionResultGasUsed = 0,
                  transactionResultEtherUsed = 0,
                  transactionResultContractsCreated = "",
                  transactionResultContractsDeleted = "",
                  transactionResultStateDiff = "",
                  transactionResultTime = 0.0,
                  transactionResultNewStorage = "",
                  transactionResultDeletedStorage = "",
                  transactionResultStatus = Just $ Failure "Execution" Nothing (ExecutionFailure fmt) Nothing Nothing (Just fmt),
                  transactionResultChainId = Just cId,
                  transactionResultKind = Just kind,
                  transactionResultCreator = "",
                  transactionResultAppName = ""
                }
            return Nothing

outputNewChains :: VMBase m => [(Word256, ChainInfo, Keccak256, [ExecResults])] -> ConduitT a VmOutEvent m ()
outputNewChains = traverse_ $ \(cId, cInfo, bHash, execr) -> do
  yield . OutIndexEvent $! NewChainInfo cId cInfo
  let crtr = fromMaybe "" $ do
        e <- listToMaybe execr
        a <- erAction e
        d <- listToMaybe . OMap.assocs $ a ^. Action.actionData
        pure $ d ^. _2 . Action.actionDataCreator
      app = fromMaybe "" $ do
        e <- listToMaybe execr
        a <- erAction e
        d <- listToMaybe . OMap.assocs $ a ^. Action.actionData
        pure $ d ^. _2 . Action.actionDataApplication
  yield $ OutToStateDiff cId cInfo bHash crtr app
  for_ (catMaybes $ erAction <$> execr) $ yield . OutAction
  yield . OutEvent $ flip map (concatMap erEvents execr) $ mkEventEntry (Just cId)

processBlocks ::
  (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) =>
  [OutputBlock] ->
  ConduitT a VmOutEvent m ()
processBlocks blocks = do
  $logInfoS "evm/processBlocks" $ T.pack $ "Running " ++ show (length blocks) ++ " blocks"
  processBlockSummaries blocks
  addBlocks blocks

processBlockSummaries ::
  ( MonadIO m,
    MonadLogger m,
    HasBlockSummaryDB m
  ) =>
  [OutputBlock] ->
  m ()
processBlockSummaries = mapM_ $ \b -> do
  let number' = number $ obBlockData b
      txCount = length $ obReceiptTransactions b
  recordMaxBlockNumber "vm_seqevents" number'
  $logDebugS "evm/processBlockSummaries" . T.pack $
    concat
      [ "Received block number ",
        show number',
        " with ",
        show txCount,
        " transactions from seqEvents"
      ]
  writeBlockSummary b

processTransactions ::
  ( Bagger.MonadBagger m
  ) =>
  [(Timestamp, OutputTx)] ->
  m ([VmOutEvent], Int)
processTransactions = uncurry (fmap . (,)) . (outputTransactions &&& getNumPoolable)

getNumPoolable ::
  ( Bagger.MonadBagger m
  ) =>
  [(Timestamp, OutputTx)] ->
  m Int
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
          hsh <- MaybeT $
            pure $ case cp of
              SolidVMCode _ h -> Just h
              ExternallyOwned h -> Just h
              CodeAtAccount _ _ -> Nothing
          (MaybeT $ pure $ M.lookup hsh codeHashMap)
            <|> MaybeT (fmap (T.pack . BC.unpack . snd) <$> getCode hsh)
        pure $ Just (a, msrc)
      sender = Account (fromMaybe 0 $ whoSignedThisChainInfo cInfo) $ Just cId
  curBlockHash <- Mod.get (Mod.Proxy @CurrentBlockHash)
  curBlockSummary <- getBSum $ unCurrentBlockHash curBlockHash
  (addrs, actions) <- fmap (unzip . catMaybes) . for (accountInfo $ chainInfo cInfo) $ \aInfo -> do
    addrSrc <- case aInfo of
      NonContract {} -> pure Nothing
      ContractNoStorage a _ ch -> resolveSrc a ch
      ContractWithStorage a _ ch _ -> resolveSrc a ch
      SolidVMContractWithStorage a _ ch _ -> resolveSrc a ch
    for addrSrc $ \(addr, ms) ->
      (addr,)
        <$> SolidVM.call
          False --isRunningTests
          True --isHomestead
          False --noValueTransfer
          True -- isRunChainConstructors
          S.empty --pre-existing suicide list
          ( BlockHeader
              (Keccak256.unsafeCreateKeccak256FromWord256 0)
              (Keccak256.unsafeCreateKeccak256FromWord256 0)
              emptyChainMember
              MP.emptyTriePtr
              MP.emptyTriePtr
              MP.emptyTriePtr
              ""
              0
              0 --block number
              (toInteger flags_gasLimit)
              0
              (bSumTimestamp curBlockSummary)
              ""
              (Keccak256.unsafeCreateKeccak256FromWord256 0)
              0
          )
          0 --callDepth
          (Account 0 $ Just cId) --receiveAddress
          (Account addr $ Just cId) --codeAddress
          sender
          (Address 0)
          0 --value
          1 --gasPrice
          ""
          (Gas $ toInteger flags_gasLimit) --availableGas
          sender
          (Keccak256.unsafeCreateKeccak256FromWord256 0)
          (Just cId)
          ( Just $
              M.fromList $
                [ ("args", fromMaybe "()" (M.lookup "args" . chainMetadata $ chainInfo cInfo)),
                  ("funcName", "<constructor>"),
                  ("history", fromMaybe "" (M.lookup "history" . chainMetadata $ chainInfo cInfo))
                ]
                  ++ case ms of Nothing -> []; Just s -> [("src", s)]
          )

  -- let evs = Action._events <$> actions
  -- logInfoS "Events" (T.pack $ show evs)

  flushMemStorageDB
  Mem.flushMemAddressStateDB

  sr <- A.lookupWithDefault (Proxy @MP.StateRoot) (Just cId)
  return (sr, addrs, actions)

writeBlockSummary :: HasBlockSummaryDB m => OutputBlock -> m ()
writeBlockSummary block =
  let sha = outputBlockHash block
      header = obBlockData block
      txCnt = fromIntegral $ length (obReceiptTransactions block)
   in putBSum sha (blockHeaderToBSum header txCnt)

