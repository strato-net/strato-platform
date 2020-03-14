{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NamedFieldPuns        #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}

module Blockchain.BlockChain
    ( addBlock
    , addBlocks
    , addTransaction
    , addTransactions
    , outputTransactionResult
    , runCodeForTransaction
    , calculateIntrinsicGas'
    , compactDiffs -- For testing
  ) where

import           Conduit
import           Control.Arrow                           ((&&&))
import           Control.Lens.Operators
import           Control.Monad
import qualified Control.Monad.Change.Alter              as A
import qualified Control.Monad.Change.Modify             as Mod
import qualified Control.Monad.State                     as State
import           Control.Monad.Trans.Except
import           Data.Bifunctor                          (bimap)
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Short                   as BSS
import qualified Data.DList                              as DL
import           Data.Either.Extra
import           Data.Foldable                           (traverse_)
import           Data.List
import qualified Data.Map                                as M
import           Data.Maybe
import           Data.Proxy
import qualified Data.Set                                as S
import qualified Data.Text                               as T
import           Data.Time.Clock
import           Prometheus                                as P
import           System.Exit
import           Text.PrettyPrint.ANSI.Leijen            (pretty)
import           Text.Printf
import           UnliftIO.IORef

import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import           Blockchain.Data.Log
import           Blockchain.Data.Transaction
import           Blockchain.Data.TransactionDef          (formatChainId)
import           Blockchain.Data.TransactionResult
import           Blockchain.Data.TransactionResultStatus
import qualified Blockchain.Database.MerklePatricia      as MP
import qualified Blockchain.DB.AddressStateDB            as NoCache
import qualified Blockchain.DB.BlockSummaryDB            as BSDB
import           Blockchain.DB.ChainDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.EVM.Code
import qualified Blockchain.EVM                          as EVM
import           Blockchain.Event
import           Blockchain.ExtWord
import           Blockchain.Output
import           Blockchain.Sequencer.Event
import qualified Blockchain.SolidVM                      as SolidVM
import           Blockchain.Strato.Model.Gas
import           Blockchain.TheDAOFork
import           Blockchain.Util
import           Blockchain.Verifier
import           Blockchain.VMContext
import           Blockchain.VM.VMException
import           Blockchain.VMConstants
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import qualified Blockchain.Bagger                       as Bagger
import           Blockchain.Bagger.Transactions
import           Blockchain.Strato.Model.Event
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.Strato.StateDiff             as SD

import           Blockchain.Strato.Indexer.Model         (IndexEvent (..))
import           Blockchain.Timing
import qualified Blockchain.TxRunResultCache             as TRC

import qualified Text.Colors                             as CL
import           Text.Format
import           Text.ShortDescription
import           Text.Tools

instance (Monad m, Mod.Accessible a m) => Mod.Accessible a (ConduitT i o m) where
  access = lift . Mod.access

instance Mod.Modifiable a m => Mod.Modifiable a (ConduitT i o m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance A.Selectable k v m => A.Selectable k v (ConduitT i o m) where
  select            p k  = lift $ A.select p k
  selectMany        p ks = lift $ A.selectMany p ks
  selectWithDefault p k  = lift $ A.selectWithDefault p k

instance (k `A.Alters` v) m => (k `A.Alters` v) (ConduitT i o m) where
  lookup p k   = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k   = lift $ A.delete p k
  lookupWithDefault p k = lift $ A.lookupWithDefault p k

-- has to be here unfortunately, or else BlockChain.hs puts a circular dependency on VMContext.hs
instance Bagger.MonadBagger ContextM where
    isBlockstanbul = contextGets _hasBlockstanbul
    getBaggerState = contextGets _baggerState
    peekPendingVote = peekPendingVote
    clearPendingVote b = clearPendingVote b
    putBaggerState s = contextModify $ baggerState .~ s

    runFromStateRoot sr remainingGas theBlockHeader txs = do
        startingStateRoot <- Mod.get (Proxy @MP.StateRoot)
        setStateDBStateRoot sr
        (TxMiningResult res ranTxs unranTxs newGas) <-
          timeit "mineTransactions bagger" (Just vmBlockInsertionMined)
          $ mineTransactions' theBlockHeader remainingGas DL.empty txs
        timeit "flushMemStorageDB bagger" (Just vmBlockInsertionMined) flushMemStorageDB
        timeit "flushMemAddressStateDB bagger" (Just vmBlockInsertionMined) flushMemAddressStateDB
        newStateRoot <- Mod.get (Proxy @MP.StateRoot)
        setStateDBStateRoot startingStateRoot
        let recoverable f = Left (RecoverableFailure (tfToBaggerTxRejection f) ranTxs unranTxs newStateRoot newGas)
        return $ case res of -- currently only get GasLimit errors out of mineTransactions'
            Nothing -> Right (newStateRoot, ranTxs, newGas)
            Just TFBlockGasLimitExceeded{}  -> Left (GasLimitReached ranTxs unranTxs newStateRoot newGas)
            Just f@TFInsufficientFunds{} -> recoverable f
            Just f@TFIntrinsicGasExceedsTxLimit{} -> recoverable f
            Just f@TFChainIdMismatch{} -> recoverable f
            Just f@TFNonceMismatch{} -> error $ "mineTransactions' we messed up: " ++ format f

    rewardCoinbases sr us uncles ourNumber = do
        startingStateRoot <- Mod.get (Proxy @MP.StateRoot)
        setStateDBStateRoot sr
        _ <- addToBalance us $ rewardBase flags_testnet
        forM_ uncles $ \uncle -> do
            _ <- addToBalance us (rewardBase flags_testnet `quot` 32)
            _ <- addToBalance (blockDataCoinbase uncle) ((rewardBase flags_testnet * (8+blockDataNumber uncle - ourNumber )) `quot` 8)
            return ()
        flushMemStorageDB
        flushMemAddressStateDB
        newStateRoot <- Mod.get (Proxy @MP.StateRoot)
        setStateDBStateRoot startingStateRoot
        return newStateRoot

    -- todo batch insert results
    txsDroppedCallback rejections bestBlockShas = forM_ rejections $ \rejection -> do
        let (message, theHash) = baggerRejectionToTransactionResultBits rejection
        -- if a tx is dropped from Queued during demotion, it means it was likely culled during the demotion as the
        -- new best block we just mined came in
        let isRecentlyRan = theHash `elem` bestBlockShas
        when (flags_createTransactionResults && not isRecentlyRan) $ do
            $logInfoS "txsDroppedCallback" . T.pack $ "Transaction rejection :: " ++ format theHash
            $logInfoS "txsDroppedCallback" . T.pack $ "Reason: " ++ message
            void $ putTransactionResult
              TransactionResult { transactionResultBlockHash        = SHA 0
                                , transactionResultTransactionHash  = theHash
                                , transactionResultMessage          = message
                                , transactionResultResponse         = BSS.empty
                                , transactionResultTrace            = "rejected"
                                , transactionResultGasUsed          = 0
                                , transactionResultEtherUsed        = 0
                                , transactionResultContractsCreated = ""
                                , transactionResultContractsDeleted = ""
                                , transactionResultStateDiff        = ""
                                , transactionResultTime             = 0
                                , transactionResultNewStorage       = ""
                                , transactionResultDeletedStorage   = ""
                                , transactionResultStatus           = Just (txRejectionToAPIFailureCause rejection)
                                , transactionResultChainId          = txChainId . otBaseTx $ rejectedTx rejection
                                , transactionResultKind             = Nothing
                                }

    cacheRunResults bd (sr, gasRemaining, trrs) = when flags_cacheTransactionResults $ do
      -- Private run results should not be cached, as on the second run
      -- the hydrated transaction will reach a different stateroot.
      -- Filtering them out makes the assumption that the inclusion of the unhydrated
      -- private txs reach the same stateroot as the public txs alone.
      let publicTrrs = filter ((== Nothing) . txChainId . trrTransaction) trrs
          bhash = blockHeaderPartialHash bd
      $logInfoLS "cacheRunResults" (bhash, length publicTrrs)
      $logDebugLS "cacheRunResults" bd
      cache <- contextGets _txRunResultsCache
      liftIO $ TRC.insert cache bhash (sr, gasRemaining, publicTrrs)

    getCachedRunResults bd =
      if not flags_cacheTransactionResults
        then return Nothing
        else do
          cache <- contextGets _txRunResultsCache
          let pHash = blockHeaderPartialHash bd
          mres <- liftIO $ TRC.lookup cache pHash
          case mres of
            Nothing -> do
              $logInfoLS "getCachedRunResults/cache_miss" . T.pack $ format pHash
              $logDebugLS "getCacheRunResults/cache_miss" bd
              return Nothing
            Just (sr, gasRemaining, trrs) -> do
              $logInfoLS "getCachedRunResults/cache_hit" . T.pack $ format pHash
              let trrs' = map (rewriteBlockHash (blockHeaderHash bd)) trrs
              return $ Just (sr, gasRemaining, trrs')

baggerRejectionToTransactionResultBits :: TxRejection -> (String, SHA) -- pretty, txHash
baggerRejectionToTransactionResultBits rejection = case rejection of
    WrongChainId   s q OutputTx{otHash=hsh, otBaseTx=bt} ->
        (p' s q ++ "chainId (expected: main, actual: " ++ formatChainId (txChainId bt) ++ ")", hsh)
    NonceTooLow    s q expected OutputTx{otHash=hsh, otBaseTx=bt} ->
        (p' s q ++ "tx nonce (expected: " ++ show expected ++ ", actual: " ++ show (transactionNonce bt) ++ ")", hsh)
    BalanceTooLow  s q needed actual OutputTx{otHash=hsh} ->
        (p' s q ++ "account balance (expected: " ++ show needed ++ ", actual: " ++ show actual ++ ")", hsh)
    GasLimitTooLow s q _ OutputTx{otHash=hsh} ->
        (p' s q ++ "tx gas limit", hsh)
    LessLucrative  s q OutputTx{otHash=hashBetter} OutputTx{otHash=hashWorse} ->
        (p s q ++ formatSHAWithoutColor hashBetter ++ " being a more lucrative transaction", hashWorse)

    where p stage queue = "Rejected from mempool at " ++ show stage ++ "/" ++ show queue ++ " due to "
          p' s q        = p s q ++ "low "

-- todo: lovely!

addBlocks :: (VMBase m, Bagger.MonadBagger m, MonadMonitor m) => [OutputBlock] -> ConduitT a VmOutEvent m ()
addBlocks unfiltered = do
  let filtered = filter ((/= 0) . blockDataNumber . obBlockData) unfiltered
      timerToUse = Just vmBlockInsertionMined
  unless (null unfiltered) $ yieldMany $ OutIndexEvent . RanBlock <$> unfiltered
  bbi <- getContextBestBlockInfo
  case (filtered, bbi) of
    ([], _) -> return ()
    (_, Unspecified) -> return ()
    (firstBlock:_, ContextBestBlockInfo (_, oldHeader, _, _, _)) -> do
      $logInfoS "addBlocks" $ T.pack ("Inserting " ++ show (length filtered) ++ " blocks(s) starting with " ++
                                             (show . blockDataNumber . obBlockData $ firstBlock))
      didReplaceBest   <- newIORef False
      ranPrivateTxs    <- newIORef M.empty
      replacedBest     <- newIORef (error "addBlocks.replacedBest: evaluating uninitialized BestBlockInfo!")
      srLog <- fmap DL.toList . flip State.execStateT DL.empty $ forM_ filtered $ \block -> do
        let blockNo = blockDataNumber $! obBlockData block
            txCount = length $! obReceiptTransactions block
        timeit (printf "Block #%d (%d TXs insertion)" blockNo txCount) timerToUse $ do
          lift $ addBlock block
          (didReplaceThisTime, ranPriv, replacedBits@(hsh, num, _)) <- lift . lift $ replaceBestIfBetter block
          when didReplaceThisTime $ do
            writeIORef didReplaceBest True
            writeIORef replacedBest replacedBits
            -- Gather a chain of better block stateroots. The last one found should be the best block,
            -- and the intermediate ones increase the granularity at which we can compute a sequence
            -- of diffs. The number of blocks to skip between stateroots is determined by the cost of
            -- the diff between them, which is estimated by the number of transactions.
            id %= (`DL.snoc` (blockDataStateRoot $ obBlockData block, hsh, num, txCount))
          unless (M.null ranPriv) $
            modifyIORef' ranPrivateTxs $ flip M.unionWith ranPriv $
              \(n1,s1) (n2,s2) -> if n1 > n2 then (n1,s1) else (n2,s2)
      $logDebugLS "addBlocks/srLog" srLog
      didReplaceBest' <- readIORef didReplaceBest
      ranPrivateTxs' <- readIORef ranPrivateTxs
      when didReplaceBest' $ do
        $logInfoS "addBlocks" "done inserting, now will emit stateDiff if necessary"
        nbb <- readIORef replacedBest
        yield . OutIndexEvent $ NewBestBlock nbb
        when flags_sqlDiff $ timeit "calculateAndEmitStateDiffs " timerToUse $
          calculateAndEmitStateDiffs srLog oldHeader
      when (flags_sqlDiff && not (M.null ranPrivateTxs')) $ calculateAndEmitChainDiffs ranPrivateTxs'

setParentStateRoot :: ( MonadIO m
                      , BSDB.HasBlockSummaryDB m
                      , HasStateDB m
                      )
                   => OutputBlock -> m BlockSummary
setParentStateRoot OutputBlock{..} = do
    bSum <- BSDB.getBSum (blockDataParentHash obBlockData)
    liftIO $ setTitle $ "Block #" ++ show (blockDataNumber obBlockData)
    setStateDBStateRoot (bSumStateRoot bSum)
    return bSum

addBlock :: (VMBase m, Bagger.MonadBagger m, MonadMonitor m) => OutputBlock -> ConduitT a VmOutEvent m ()
addBlock b@OutputBlock{obBlockData = bd, obBlockUncles = uncles, obReceiptTransactions = otxs} = do
    $logInfoS "addBlocks" . T.pack $
      "Inserting Block #"
      ++ show (blockDataNumber . obBlockData $ b)
      ++ " ("
      ++ format (outputBlockHash b)
      ++ ", " ++ show (length . obReceiptTransactions $ b)
      ++ "TXs)."
    when flags_debug $ do
      bhr <- Mod.get (Proxy @BlockHashRoot)
      $logDebugS "addBlock" $ T.pack $ "Old blockhash root: " ++ format bhr
      mcr <- getChainRoot $ blockHash b
      case mcr of
        Nothing -> $logDebugS "addBlock" $ T.pack $ "Could not locate old chain root. Using emptyTriePtr"
        Just cr -> $logDebugS "addBlock" $ T.pack $ "Old chain root: " ++ format cr

    putBlockHeaderInChainDB bd

    when flags_debug $ do
      bhr' <- Mod.get (Proxy @BlockHashRoot)
      $logDebugS "addBlock" $ T.pack $ "New blockhash root after inserting header: " ++ format bhr'
      mcr' <- getChainRoot $ blockHash b
      case mcr' of
        Nothing -> $logDebugS "addBlock" $ T.pack $ "Could not locate new chain root after inserting header. Using emptyTriePtr"
        Just cr -> $logDebugS "addBlock" $ T.pack $ "New chain root after inserting header: " ++ format cr

    bSum <- setParentStateRoot b
    when (False && blockDataNumber bd == 1920000) runTheDAOFork -- TODO: Only run this if connected to Ethereum publicnet (i.e. never)

    addBlockTransactions True b

    preRewardSR <- Mod.get (Proxy @MP.StateRoot)
    postRewardSR <- lift $ Bagger.rewardCoinbases preRewardSR (blockDataCoinbase bd) uncles (blockDataNumber bd)
    lift $ flushMemAddressStateDB

    -- If there are no transactions in th
    -- TODO: this should be handled more officially,
    -- e.g. adding a chainId to the block
    let skipCheck = (not $ null otxs)
                 && (isNothing . listToMaybe $ filter (isNothing . txChainId) otxs)
    unless skipCheck $ do
      when (blockDataStateRoot (obBlockData b) /= postRewardSR) $ do
        $logInfoS "addBlock/mined" . T.pack $ "newStateRoot: " ++ format postRewardSR
        error $ "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format (blockDataStateRoot $ obBlockData b)

      valid <- checkValidity (blockIsHomestead $ blockDataNumber bd) bSum b
      case valid of
          Nothing -> lift $ P.incCounter vmBlocksValid
          Just  _ -> lift $ P.incCounter vmBlocksInvalid -- error err -- todo: i dont think we ACTUALLY need to error here

    when flags_debug $ do
      bhr'' <- Mod.get (Proxy @BlockHashRoot)
      $logDebugS "addBlock" $ T.pack $ "New blockhash root after running block: " ++ format bhr''
      mcr'' <- getChainRoot $ blockHash b
      case mcr'' of
        Nothing -> $logDebugS "addBlock" $ T.pack $ "Could not locate new chain root after running block. Using emptyTriePtr"
        Just cr -> $logDebugS "addBlock" $ T.pack $ "New chain root after running block: " ++ format cr

    lift $ P.incCounter vmBlocksMined
    lift $ P.incCounter vmBlocksProcessed
    $logInfoS "addBlock" .  T.pack $ "Inserted block became #" ++ show (blockDataNumber $ obBlockData b) ++ " (" ++ format (outputBlockHash b) ++ ")."

addBlockTransactions :: (VMBase m, Bagger.MonadBagger m, MonadMonitor m) => Bool -> OutputBlock -> ConduitT a VmOutEvent m ()
addBlockTransactions runPublicTxs b@OutputBlock{obBlockData = bd, obReceiptTransactions = transactions} = do
  $logDebugS "addBlockTransactions" . T.pack $ "All transactions: " ++ show transactions
  $logDebugS "addBlockTransactions" . T.pack $ "AnchorChains: " ++ show (map (otAnchorChain &&& txType) transactions)
  let f = if runPublicTxs then isAnchored else isAnchoredPrivate
      chains = partitionWith otAnchorChain
             . filter ((/= PrivateHash) . txType)
             $ filter (f . otAnchorChain) transactions
  forM_ chains $ \(anchor, txs) -> do
    let chainId = fromAnchorChain anchor
    $logDebugS "addBlockTransactions" . T.pack $ "Running chain: " ++ formatChainId chainId ++ " with txs: " ++ show txs
    withBlockchain (blockHeaderHash bd) chainId $ do
      when flags_debug $ do
        sr <- Mod.get (Proxy @MP.StateRoot)
        $logDebugS "addBlockTransactions/withBlockchain" $ T.pack $ "Old chain state root: " ++ format sr
      $logDebugS "evm/loop" $ T.pack $ "Running block for chain " ++ formatChainId chainId
      let canUseCache = chainId == Nothing
      -- TODO: Run the checks Bagger does reject invalid transactions for private chains
      addTransactions chainId canUseCache bd (blockDataGasLimit $ obBlockData b) txs

      lift $ timeit "flushMemStorageDB" (Just vmBlockInsertionMined) flushMemStorageDB
      lift $ timeit "flushMemAddressStateDB" (Just vmBlockInsertionMined) flushMemAddressStateDB
      when flags_debug $ do
        sr' <- Mod.get (Proxy @MP.StateRoot)
        $logDebugS "addBlockTransactions/withBlockchain" $ T.pack $ "New chain state root: " ++ format sr'

addTransactions :: (VMBase m, Bagger.MonadBagger m, MonadMonitor m)
                => Maybe Word256
                -> Bool
                -> BlockData
                -> Integer
                -> [OutputTx]
                -> ConduitT a VmOutEvent m ()
addTransactions chainId canCache blockData blockGas0 txs =
 timeit ("addTransactions, " ++ show (length txs) ++ " TXs") (Just vmBlockInsertionMined) $ do
  trrs <- lift $ do
    mtrrs <- if canCache
              then Bagger.getCachedRunResults blockData
              else return Nothing
    case mtrrs of
      Nothing -> go blockGas0 txs DL.empty
      Just (cachedSR, _, cachedTRRs) -> do
        let cachedTXs = map trrTransaction cachedTRRs
        when (flags_debug && txs /= cachedTXs) $ do
          $logErrorS "addTransactions" "Invalid transaction cache entry"
          $logErrorLS "addTransactions/cached" cachedTXs
          $logErrorLS "addTransactions/from_block" txs
          liftIO exitFailure
        Mod.put (Mod.Proxy @MP.StateRoot) cachedSR
        return cachedTRRs
  mapM_ (outputTransactionResult blockData blockHeaderHash) trrs
  yield . OutASM chainId $ foldr (flip M.union) M.empty $ map trrAfterMap trrs

  where
    go _ [] trrs = return $ DL.toList trrs
    go blockGas (t@OutputTx{otBaseTx=bt}:rest) trrs = do
      flushMemAddressStateTxToBlockDB
      flushMemStorageTxDBToBlockDB
      beforeMap <- getAddressStateTxDBMap
      (!deltaT, !result) <- timeIt $ runExceptT $ addTransaction chainId False blockData blockGas t
      afterMap <- getAddressStateTxDBMap

      printTransactionMessage t result deltaT (txChainId bt)
      P.setGauge vmTxMined (realToFrac deltaT)

      trr <- setNewAddresses $ TxRunResult t result deltaT beforeMap afterMap []

      let remainingBlockGas =
            case result of
            Left _           -> blockGas
            Right execResult -> blockGas - (transactionGasLimit bt - calculateReturned bt execResult)

      go remainingBlockGas rest (trrs `DL.snoc` trr)

data TxMiningResult = TxMiningResult { tmrFailure  :: Maybe TransactionFailureCause
                                     , tmrRanTxs   :: [TxRunResult]
                                     , tmrUnranTxs :: [OutputTx]
                                     , tmrRemGas   :: Integer
                                     } deriving (Show)

mineTransactions' :: (VMBase m, MonadMonitor m) => BlockData -> Integer -> DL.DList TxRunResult -> [OutputTx] -> m TxMiningResult
mineTransactions' _ remGas ran [] = return $ TxMiningResult Nothing (DL.toList ran) [] remGas
mineTransactions' header remGas ran unran@(tx@OutputTx{otBaseTx=bt}:txs) = do
    flushMemAddressStateTxToBlockDB
    flushMemStorageTxDBToBlockDB
    beforeMap <- getAddressStateTxDBMap
    (!time', !result) <- timeIt . runExceptT $ addTransaction Nothing False header remGas tx
    afterMap <- getAddressStateTxDBMap
    P.setGauge vmTxMining (realToFrac time')
    printTransactionMessage tx result time' (txChainId bt)
    trr <- setNewAddresses $ TxRunResult tx result time' beforeMap afterMap []
    case result of
        Right execResult -> do
          let nextRemGas = remGas - (transactionGasLimit bt-calculateReturned bt execResult)
          mineTransactions' header nextRemGas (ran `DL.snoc` trr) txs
        Left  failure    -> return $ TxMiningResult (Just failure) (DL.toList ran) unran remGas


blockIsHomestead :: Integer -> Bool
blockIsHomestead blockNum = blockNum >= fromIntegral gHomesteadFirstBlock

addTransaction :: (VMBase m, MonadMonitor m)
               => Maybe Word256
               -> Bool
               -> BlockData
               -> Integer
               -> OutputTx
               -> ExceptT TransactionFailureCause m ExecResults
addTransaction chainId isRunningTests' b remainingBlockGas t@OutputTx{otBaseTx=bt,otSigner=tAddr} = do

    nonceValid <- lift $ isNonceValid t

    let isHomestead   = blockIsHomestead $ blockDataNumber b
        intrinsicGas' = intrinsicGas isHomestead t

    when flags_debug $ do
        $logDebugS "addTx" . T.pack $ "bytes cost: " ++ show (gTXDATAZERO * fromIntegral (zeroBytesLength t) + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - fromIntegral (zeroBytesLength t)))
        $logDebugS "addTx" . T.pack $ "transaction cost: " ++ show gTX
        $logDebugS "addTx" . T.pack $ "intrinsicGas: " ++ show intrinsicGas'

    (acctBalance, acctNonce) <- lift $
      (addressStateBalance &&& addressStateNonce) <$>
        A.lookupWithDefault (Proxy @AddressState) tAddr

    let txCost      = transactionGasLimit bt * transactionGasPrice bt + transactionValue bt
        realIG = fromIntegral intrinsicGas'
        maxGas = fromIntegral (maxBound :: Int)
    when (chainId /= txChainId bt) $ throwE $ TFChainIdMismatch chainId (txChainId bt) t
    when (txCost > acctBalance) $ throwE $ TFInsufficientFunds txCost acctBalance t
    when (realIG > transactionGasLimit bt) $ throwE $ TFIntrinsicGasExceedsTxLimit realIG (transactionGasLimit bt) t
    when (transactionGasLimit bt > min remainingBlockGas maxGas) $ throwE $ TFBlockGasLimitExceeded (transactionGasLimit bt) remainingBlockGas t
    unless nonceValid $ throwE $ TFNonceMismatch (transactionNonce bt) acctNonce t

    let availableGas = transactionGasLimit bt - fromIntegral intrinsicGas'

    lift $ incrementNonce tAddr

    success <- lift $ addToBalance tAddr (-transactionGasLimit bt * transactionGasPrice bt)
    when flags_debug $ $logDebugS "addTx" "running code"
    let txTypeCounter = if isContractCreationTX bt then vmTxsCreation else vmTxsCall
    lift $ P.incCounter txTypeCounter
    if success
        then do
            execResults <- lift $ runCodeForTransaction isRunningTests' isHomestead b (fromInteger (transactionGasLimit bt) - intrinsicGas') tAddr t
            s1 <- lift $ addToBalance (blockDataCoinbase b) (transactionGasLimit bt * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addBlock"
            lift $ P.incCounter vmTxsProcessed


            success' <- lift $ pay "VM refund fees" (blockDataCoinbase b) tAddr (calculateReturned bt execResults * transactionGasPrice bt)
            unless success' $ error "oops, refund was too much"

            case erException execResults of
                Just e -> do
                    when flags_debug $ $logDebugS "addTx" . T.pack . CL.red $ show e
                    lift $ P.incCounter vmTxsUnsuccessful
                Nothing -> do
                    when flags_debug $ $logDebugS "addTx" . T.pack $ "Removing accounts in suicideList: " ++ intercalate ", " (show . pretty <$> S.toList (erSuicideList execResults))
                    forM_ (S.toList $ erSuicideList execResults) $ \address' -> do
                        lift $ purgeStorageMap address'
                        lift $ A.delete (Proxy @AddressState) address'
                    lift $ P.incCounter vmTxsSuccessful
            return execResults
        else do
            s1 <- lift $ addToBalance (blockDataCoinbase b) (fromIntegral intrinsicGas' * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addTransaction"
            balance <- lift $ addressStateBalance <$>
              A.lookupWithDefault (Proxy @AddressState) tAddr
            $logInfoS "addTransaction/success=false" . T.pack $ "Insufficient funds to run the VM: need " ++ show (availableGas*transactionGasPrice bt) ++ ", have " ++ show balance
            return $
              evmErrorResults (transactionGasLimit bt) Blockchain.VM.VMException.InsufficientFunds

runCodeForTransaction :: VMBase m
                      => Bool
                      -> Bool
                      -> BlockData
                      -> Gas
                      -> Address
                      -> OutputTx
                      -> m ExecResults
runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr OutputTx{otBaseTx=ut} | isContractCreationTX ut = do
  when flags_debug $ $logInfoS "runCodeForTransaction" "runCodeForTransaction: ContractCreationTX"

  let create =
        case join $ fmap (M.lookup "VM") $ transactionMetadata ut of
          Just "EVM" -> EVM.create
          Just "SolidVM" -> SolidVM.create
          Nothing -> EVM.create --EVM is the default
          Just vmName -> -- Return a dummy VM that just complains that the requested VM doesn't exist
            \_ _ _ _ _ _ _ _ _ ag _ _ _ _ _ ->
                         return $ evmErrorResults (toInteger ag) (UnsupportedVM vmName)

  --TODO- The new address state should be created in the VM itself....  Currently the EVM doesn't do this (and could be cleaned up by doing so), SolidVM does do this.  I will calculate this value here, but then ignore the value in SolidVM (and recalculate it there).  Eventually this should be moved into the EVM also
  nonce <- addressStateNonce <$> A.lookupWithDefault (Proxy @AddressState) tAddr
  let newAddress = getNewAddress_unsafe tAddr (nonce-1) --nonce has already been incremented, so subtract 1 here to get the proper value (this is directly specified in the yellowpaper)

  create isRunningTests'
           isHomestead
           S.empty
           b
           0
           tAddr
           tAddr
           (transactionValue ut)
           (fromInteger $ transactionGasPrice ut)
           availableGas
           newAddress
           (transactionInit ut)
           (txHash ut)
           (txChainId ut)
           (txMetadata ut)

runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr OutputTx{otBaseTx=ut} = do --MessageTX
  when flags_debug $ $logInfoS "runCodeForTransaction"  $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ format tAddr ++ ", address: " ++ format (transactionTo ut)

  let owner = transactionTo ut

  codeHash <- addressStateCodeHash <$> A.lookupWithDefault (Proxy @AddressState) owner

  let call =
        case codeHash of
          EVMCode _ -> EVM.call
          SolidVMCode _ _ ->  SolidVM.call


  call isRunningTests'
       isHomestead
       False
       S.empty
       b
       0
       owner
       owner
       tAddr
       (fromInteger $ transactionValue ut)
       (fromInteger $ transactionGasPrice ut)
       (transactionData ut)
       (fromIntegral availableGas)
       tAddr
       (txHash ut)
       (txChainId ut)
       (txMetadata ut)

----------------


codeOrDataLength :: OutputTx -> Int
codeOrDataLength OutputTx{otBaseTx=bt} | isMessageTX bt = B.length $ transactionData bt
codeOrDataLength OutputTx{otBaseTx=bt} = codeLength $ transactionInit bt --is ContractCreationTX

zeroBytesLength :: OutputTx -> Int
zeroBytesLength OutputTx{otBaseTx=bt} | isMessageTX bt = length $ filter (==0) $ B.unpack $ transactionData bt
zeroBytesLength OutputTx{otBaseTx=bt} = length $ filter (==0) $ B.unpack codeBytes' --is ContractCreationTX
                  where
                    Code codeBytes' = transactionInit bt

calculateIntrinsicGas' :: Integer -> OutputTx -> Gas
calculateIntrinsicGas' blockNum = intrinsicGas (blockIsHomestead blockNum)

intrinsicGas :: Bool -> OutputTx -> Gas
intrinsicGas isHomestead t@OutputTx{otBaseTx=bt} = gTXDATAZERO * zeroLen + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - zeroLen) + txCost bt
    where
      zeroLen = fromIntegral $ zeroBytesLength t
      txCost t' | isMessageTX t' = gTX
      txCost _  = if isHomestead then gCREATETX else gTX

setNewAddresses :: VMBase m => TxRunResult -> m TxRunResult
setNewAddresses trr@(TxRunResult _ result _ before after _) = do
  let isMod ASModification{} = True
      isMod ASDeleted = False

      split :: M.Map Address AddressStateModification -> (S.Set Address, S.Set Address)
      split = bimap (S.fromList . M.keys) (S.fromList . M.keys) . M.partition isMod
      (beforeAddresses, beforeDeletes) = split before
      (afterAddresses, afterDeletes) = split after
      modified = (afterAddresses S.\\ afterDeletes) S.\\ (beforeAddresses S.\\ beforeDeletes)
      moveToFront (Just thisAddress) | thisAddress `S.member` modified = thisAddress : S.toList (S.delete thisAddress modified)
      moveToFront _ = S.toList modified
  case result of
    Left{} -> return trr
    Right erResult -> do
      unseen <- filterM (fmap not . NoCache.addressStateExists) . moveToFront $ erNewContractAddress erResult
      return trr{trrNewAddresses = unseen}


outputTransactionResult :: VMBase m
                        => BlockData
                        -> (BlockData -> SHA)
                        -> TxRunResult
                        -> ConduitT a VmOutEvent m ()
outputTransactionResult b hashFunction (TxRunResult OutputTx{otHash=theHash, otBaseTx=t} result deltaT beforeMap afterMap newAddresses) = do
  let (txrStatus, message, gasRemaining) =
        case result of
          Left err -> let fmt = format err in (Failure "Execution" Nothing (ExecutionFailure fmt) Nothing Nothing (Just fmt), fmt, 0) -- TODO Also include the trace
          Right r  -> case erException r of
                        Nothing -> (Success, "Success!", erRemainingTxGas r)
                        Just ex -> let fmt = either show show ex
                                    in (Failure "Execution" Nothing (ExecutionFailure $ show ex) Nothing Nothing (Just fmt), fmt, 0)
      gasUsed = fromInteger $ transactionGasLimit t - gasRemaining
      etherUsed = gasUsed * fromInteger (transactionGasPrice t)

  when flags_createTransactionResults $ do
    let chainId = txChainId t
        beforeAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList beforeMap ]
        beforeDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList beforeMap ]
        afterAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList afterMap ]
        afterDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList afterMap ]
        ranBlockHash = hashFunction b
        mkLogEntry Log{..} = LogDB ranBlockHash theHash chainId address (topics `indexMaybe` 0) (topics `indexMaybe` 1) (topics `indexMaybe` 2) (topics `indexMaybe` 3) logData bloom
        mkEventEntry Event{..} = EventDB chainId evName evArgs
        (!response, theTrace', theLogs, theEvents) =
          case result of
            Left _ -> (BSS.empty, [], [], []) --TODO keep the trace when the run fails
            Right r ->
              (fromMaybe BSS.empty $ erReturnVal r, unlines $ reverse $ erTrace r, erLogs r, erEvents r)

    yieldMany $ OutLog . mkLogEntry <$> theLogs
    yieldMany $ OutEvent . mkEventEntry <$> theEvents
    yield . OutTXR $
           TransactionResult { transactionResultBlockHash        = ranBlockHash
                             , transactionResultTransactionHash  = theHash
                             , transactionResultMessage          = message
                             , transactionResultResponse         = response
                             , transactionResultTrace            = theTrace'
                             , transactionResultGasUsed          = gasUsed
                             , transactionResultEtherUsed        = etherUsed
                             , transactionResultContractsCreated = intercalate "," $ map formatAddress newAddresses
                             , transactionResultContractsDeleted = intercalate "," $ map formatAddress $ S.toList $ (beforeAddresses S.\\ afterAddresses) `S.union` (afterDeletes S.\\ beforeDeletes)
                             , transactionResultStateDiff        = ""
                             , transactionResultTime             = realToFrac deltaT
                             , transactionResultNewStorage       = ""
                             , transactionResultDeletedStorage   = ""
                             , transactionResultStatus           = Just txrStatus
                             , transactionResultChainId          = chainId
                             , transactionResultKind             = erKind <$> eitherToMaybe result
                             }
    when flags_diffPublish $ do
      traverse_ (yield . OutAction) $ either (const Nothing) erAction result

multilineLog :: MonadLogger m =>
                T.Text -> String -> m ()
multilineLog source theLines = do
  forM_ (lines theLines) $ \theLine ->
    $logInfoS source $ T.pack theLine

printTransactionMessage::MonadLogger m=>
                         OutputTx->Either TransactionFailureCause ExecResults->NominalDiffTime->Maybe Word256 ->  m ()
printTransactionMessage OutputTx{otSigner=tAddr, otBaseTx=baseTx, otHash=theHash} (Left errMsg) deltaT cid = do
  let tNonce = transactionNonce baseTx
  multilineLog "printTx/err" $ boringBox
    [ "Adding transaction signed by: " ++ format tAddr
    , "Tx hash:  " ++ format theHash
    , "Tx nonce: " ++ show tNonce
    , "Chain Id: " ++ formatChainId cid
    , CL.red "Transaction failure: " ++ CL.red (format errMsg)
    , "t = " ++ printf "%.5f" (realToFrac deltaT::Double) ++ "s"
    ]

printTransactionMessage OutputTx{otBaseTx=t, otSigner=tAddr, otHash=theHash} (Right results) deltaT cid = do
    let tNonce = transactionNonce t
        extra =
          if isMessageTX t
          then ""
          else fromMaybe "<failed>" $ fmap format $ erNewContractAddress results

    multilineLog "printTx/ok" $ boringBox
      [ "Adding transaction signed by: " ++ format tAddr
      , "Tx hash:  " ++ format theHash
      , "Tx nonce: " ++ show tNonce
      , "Chain Id: " ++ formatChainId cid
      , shortDescription t ++ " " ++ extra
      , "t = " ++ printf "%.5f" (realToFrac deltaT::Double) ++ "s"
      ]

indexMaybe :: [a] -> Int -> Maybe a
indexMaybe _ i        | i < 0 = error "indexMaybe called for i < 0"
indexMaybe [] _       = Nothing
indexMaybe (x:_) 0    = Just x
indexMaybe (_:rest) i = indexMaybe rest (i-1)

----------------

replaceBestIfBetter :: (VMBase m, Bagger.MonadBagger m) => OutputBlock -> m (Bool, M.Map Word256 (Integer, SHA), (SHA, Integer, Integer))
replaceBestIfBetter b@OutputBlock{obBlockData = bd, obTotalDifficulty = td, obReceiptTransactions=txs, obBlockUncles=uncles} = do
    bbi <- getContextBestBlockInfo

    case bbi of
      Unspecified -> error $ "Trying to replace an Unspecified Best Block"
      ContextBestBlockInfo (oldBestSha, oldBestBlock, oldBestDifficulty, oldTxCount, _) -> do

        let newNumber     = blockDataNumber bd
            newStateRoot  = blockDataStateRoot bd
            newTxCount    = fromIntegral $ length txs
            newUncleCount = fromIntegral $ length uncles
            oldNumber     = blockDataNumber oldBestBlock
            oldStateRoot  = blockDataStateRoot oldBestBlock
            bH            = outputBlockHash b
            bTHs          = otHash <$> txs

        let shouldReplace =     newNumber == 0
                            || (newNumber > oldNumber)
                            || ((newNumber == oldNumber) && (td > oldBestDifficulty))
                            || ((newNumber == oldNumber) && (td == oldBestDifficulty) && (newTxCount > oldTxCount))
            ranPriv = M.fromSet (const (newNumber, bH)) . S.fromList . catMaybes $ map txChainId txs

        $logInfoS "replaceBestIfBetter" . T.pack $ "shouldReplace = " ++ show shouldReplace ++ ", newNumber = " ++ show newNumber ++ ", oldBestNumber = " ++ show (blockDataNumber oldBestBlock)

        when shouldReplace $ do
            Bagger.processNewBestBlock bH bd bTHs
            putContextBestBlockInfo $ ContextBestBlockInfo (bH, bd, td, newTxCount, newUncleCount)

        -- we're replaying SeqEvents, and need to notify the mempool
        when (not shouldReplace && (newNumber == oldNumber) && (oldStateRoot == newStateRoot)) $
            Bagger.processNewBestBlock bH bd bTHs

        let bbi'      = (bestSha, bestNum, bestTdiff)
            bestSha   = if shouldReplace then bH        else oldBestSha
            bestNum   = if shouldReplace then newNumber else oldNumber
            bestTdiff = if shouldReplace then td        else oldBestDifficulty

        return (shouldReplace, ranPriv, bbi')

calculateAndEmitStateDiffs :: VMBase m
                           => [(MP.StateRoot, SHA, Integer, Int)]
                           -> BlockData
                           -> ConduitT a VmOutEvent m ()
calculateAndEmitStateDiffs srLog oldHeader = do
  let base = MP.StateRoot $ blockHeaderStateRoot oldHeader
      diffLog = compactDiffs base srLog
  runConduit $ yieldMany diffLog
            .| mapMC completeDiff
            .| mapM_C (yield . OutStateDiff)

calculateAndEmitChainDiffs :: VMBase m => M.Map Word256 (Integer, SHA) -> ConduitT a VmOutEvent m ()
calculateAndEmitChainDiffs chainMap = do
  let chainList = M.toList chainMap
      chainIds = format . SHA . fst <$> chainList
  $logInfoS "calculateAndEmitChainDiffs" . T.pack $ "Calculating ChainDiffs for: " ++ show chainIds
  runConduit $ yieldMany chainList
            .| mapMC (\(cId, (newNumber, newHash)) -> SD.chainDiff cId newNumber newHash)
            .| mapM_C (traverse_ $ yield . OutStateDiff)

diffMaxCost :: Int
diffMaxCost = 500

type PreDiff = (MP.StateRoot, SHA, Integer, Int)
type ToDiff = (MP.StateRoot, MP.StateRoot, SHA, Integer)

promote :: MP.StateRoot -> PreDiff -> ToDiff
promote base (next, hsh, num, _) = (base, next, hsh, num)

cost :: PreDiff -> Int
cost (_, _, _, c) = c

compactDiffs :: MP.StateRoot -> [PreDiff] -> [ToDiff]
compactDiffs _ [] = error "should not be called on an empty list"
compactDiffs base (p:ps) = go (cost p) (promote base p) ps
  where go :: Int -> ToDiff -> [PreDiff] -> [ToDiff]
        go _ lastPending [] = [lastPending]
        go pendingCost pending@(pendingBase, pendingNext, _, _) (c:cs) =
          -- If we can fit this PreDiff in, we augment it to the pending ToDiff.
          -- Otherwise, we emit and create a new ToDiff
          if pendingCost + cost c > diffMaxCost
            then pending:go (cost c) (promote pendingNext c) cs
            else go (pendingCost + cost c) (promote pendingBase c) cs

completeDiff :: ( MonadLogger m
                , HasCodeDB m
                , HasHashDB m
                , (MP.StateRoot `A.Alters` MP.NodeData) m
                )
             => ToDiff -> m SD.StateDiff
completeDiff (src, dst, hsh, num) = do
  $logInfoS "calculateAndEmitStateDiffs" . T.pack $
      "Calculating StateDiff from: " ++ format src ++ "\nto: " ++ format dst
  SD.stateDiff Nothing num hsh src dst
