{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NamedFieldPuns        #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TemplateHaskell       #-}
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
  ) where

import           Control.Arrow                           ((&&&))
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import qualified Control.Monad.State                     as State
import           Control.Monad.Trans
import           Control.Monad.Trans.Except
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Base16                  as B16
import qualified Data.ByteString.Char8                   as BC
import           Data.IORef                              (newIORef, readIORef, writeIORef)
import           Data.List
import qualified Data.Map                                as M
import           Data.Maybe
import qualified Data.Set                                as S
import qualified Data.Text                               as T
import           Data.Time.Clock
import           Blockchain.MilenaTools                  (withKafkaViolently)
import           Prometheus                                as P
import           Text.PrettyPrint.ANSI.Leijen            (pretty)
import           Text.Printf

import qualified Blockchain.Colors                       as CL
import           Blockchain.Constants
import           Blockchain.Data.Action
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import           Blockchain.Data.Log
import           Blockchain.Data.LogDB
import           Blockchain.Data.Transaction
import           Blockchain.Data.TransactionResult
import           Blockchain.Data.TransactionResultStatus
import qualified Blockchain.Database.MerklePatricia      as MP
import qualified Blockchain.DB.AddressStateDB            as NoCache
import qualified Blockchain.DB.BlockSummaryDB            as BSDB
import           Blockchain.DB.ChainDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.Sequencer.Event
import           Blockchain.TheDAOFork
import           Blockchain.Util
import           Blockchain.Verifier
import           Blockchain.VM
import           Blockchain.VM.Code
import           Blockchain.VM.OpcodePrices
import           Blockchain.VM.VMState
import           Blockchain.VMContext
import           Blockchain.VM.VMException
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import qualified Blockchain.Bagger                       as Bagger
import           Blockchain.Bagger.Transactions
import           Blockchain.Output                       (rightPad)
import           Blockchain.SHA                          (formatSHAWithoutColor)
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.StateDiff             hiding (StateDiff (blockHash))
import qualified Blockchain.Strato.StateDiff             as SD (StateDiff)
import           Blockchain.Strato.StateDiff.Database

import           Blockchain.Strato.Indexer.Kafka         (writeIndexEvents)
import           Blockchain.Strato.Indexer.Model         (IndexEvent (..))
import           Blockchain.Timing

-- has to be here unfortunately, or else BlockChain.hs puts a circular dependency on VMContext.hs
instance Bagger.MonadBagger ContextM where
    getBaggerState = contextBaggerState <$> State.get
    putBaggerState s = do
        ctx <- State.get
        State.put $ ctx { contextBaggerState = s }

    runFromStateRoot sr remainingGas theBlockHeader txs = do
        startingStateRoot <- getStateRoot
        setStateDBStateRoot sr
        (TxMiningResult res ranTxs unranTxs newGas) <- mineTransactions' theBlockHeader remainingGas [] txs
        flushMemStorageDB
        flushMemAddressStateDB
        newStateRoot <- getStateRoot
        setStateDBStateRoot startingStateRoot
        let recoverable f = Left (RecoverableFailure (tfToBaggerTxRejection f) ranTxs unranTxs newStateRoot newGas)
        return $ case res of -- currently only get GasLimit errors out of mineTransactions'
            Nothing -> Right (newStateRoot, ranTxs, newGas)
            Just TFBlockGasLimitExceeded{}  -> Left (GasLimitReached ranTxs unranTxs newStateRoot newGas)
            Just f@TFInsufficientFunds{} -> recoverable f
            Just f@TFIntrinsicGasExceedsTxLimit{} -> recoverable f
            Just f@TFNonceMismatch{} -> error $ "mineTransactions' we messed up: " ++ format f

    rewardCoinbases sr us uncles ourNumber = do
        startingStateRoot <- getStateRoot
        setStateDBStateRoot sr
        _ <- addToBalance us $ rewardBase flags_testnet
        forM_ uncles $ \uncle -> do
            _ <- addToBalance us (rewardBase flags_testnet `quot` 32)
            _ <- addToBalance (blockDataCoinbase uncle) ((rewardBase flags_testnet * (8+blockDataNumber uncle - ourNumber )) `quot` 8)
            return ()
        flushMemStorageDB
        flushMemAddressStateDB
        newStateRoot <- getStateRoot
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
            void . lift $ putTransactionResult
                     TransactionResult { transactionResultBlockHash        = SHA 0
                                       , transactionResultTransactionHash  = theHash
                                       , transactionResultMessage          = message
                                       , transactionResultResponse         = ""
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
                                       }

baggerRejectionToTransactionResultBits :: TxRejection -> (String, SHA) -- pretty, txHash
baggerRejectionToTransactionResultBits rejection = case rejection of
    NonceTooLow    s q expected OutputTx{otHash=hash, otBaseTx=bt} ->
        (p' s q ++ "tx nonce (expected: " ++ show expected ++ ", actual: " ++ show (transactionNonce bt) ++ ")", hash)
    BalanceTooLow  s q needed actual OutputTx{otHash=hash} ->
        (p' s q ++ "account balance (expected: " ++ show needed ++ ", actual: " ++ show actual ++ ")", hash)
    GasLimitTooLow s q _ OutputTx{otHash=hash} ->
        (p' s q ++ "tx gas limit", hash)
    LessLucrative  s q OutputTx{otHash=hashBetter} OutputTx{otHash=hashWorse} ->
        (p s q ++ formatSHAWithoutColor hashBetter ++ " being a more lucrative transaction", hashWorse)

    where p stage queue = "Rejected from mempool at " ++ show stage ++ "/" ++ show queue ++ " due to "
          p' s q        = p s q ++ "low "

-- todo: lovely!

addBlocks :: [OutputBlock] -> ContextM [Action]
addBlocks [] = return []
addBlocks blocks' = do
  bbi <- getContextBestBlockInfo
  case bbi of
    Unspecified -> return [] -- TODO: bootstrap private chains
    ContextBestBlockInfo (_, oldHeader, _, _, _) -> do
      let filtered = filter ((/= 0) . blockDataNumber . obBlockData) blocks'
      $logInfoS "addBlocks" $ T.pack ("Inserting " ++ show (length filtered) ++ " blocks(s) starting with " ++
                                             (show . blockDataNumber . obBlockData $ head filtered))
      didReplaceBest <- liftIO (newIORef False)
      replacedBest   <- liftIO (newIORef undefined)
      actions <- forM filtered $ \block -> timeit ("Block #" ++ show (blockDataNumber . obBlockData $ block) ++ " (" ++ show (length . obReceiptTransactions $ block) ++ " TXs) insertion") timerToUse $ do
        actions <- addBlock block
        (didReplaceThisTime, replacedBits) <- replaceBestIfBetter block
        when didReplaceThisTime . liftIO $ do
          writeIORef didReplaceBest True
          writeIORef replacedBest (block, replacedBits)
        return actions
      didReplaceBest' <- liftIO (readIORef didReplaceBest)
      timeit "writeIndexEvents1 " timerToUse $ void . withKafkaViolently $ writeIndexEvents (RanBlock <$> blocks') -- emit all blocks to the indexers
      when didReplaceBest' $ do
        $logInfoS "addBlocks" "done inserting, now will emit stateDiff if necessary"
        (theBlock, nbb) <- liftIO (readIORef replacedBest)
        timeit "writeIndexEvents2 " timerToUse $ void . withKafkaViolently $ writeIndexEvents [NewBestBlock nbb]
        timeit "calculateAndEmitStateDiffs " timerToUse $ calculateAndEmitStateDiffs theBlock oldHeader
      return $ concat actions

  where
    timerToUse = Just vmBlockInsertionMined

setTitle :: String -> IO()
setTitle value = putStr $ "\ESC]0;" ++ value ++ "\007"

setParentStateRoot :: OutputBlock -> ContextM BlockSummary
setParentStateRoot b@OutputBlock{..} = do
    bSum <- BSDB.getBSum (blockDataParentHash obBlockData)
    liftIO $ setTitle $ "Block #" ++ show (blockDataNumber obBlockData)
    $logInfoS "setParentStateRoot" . T.pack $ "Inserting block #" ++ show (blockDataNumber obBlockData) ++ " (" ++ format (outputBlockHash b) ++ ")."
    setStateDBStateRoot (bSumStateRoot bSum)
    return bSum

addBlock :: OutputBlock -> ContextM [Action]
addBlock b@OutputBlock{obBlockData = bd, obBlockUncles = uncles} = do
    putBlockHeaderInChainDB bd
    bSum <- setParentStateRoot b
    when (False && blockDataNumber bd == 1920000) runTheDAOFork -- TODO: Only run this if connected to Ethereum publicnet (i.e. never)
    s1 <- addToBalance (blockDataCoinbase bd) (rewardBase flags_testnet)
    unless s1 $ error "addToBalance failed even after a check in addBlock"

    forM_ uncles $ \uncle -> do
        s2 <- addToBalance (blockDataCoinbase bd) (rewardBase flags_testnet `quot` 32)
        unless s2 $ error "addToBalance failed even after a check in addBlock"

        s3 <- addToBalance
              (blockDataCoinbase uncle)
            ((rewardBase flags_testnet * (8+blockDataNumber uncle - blockDataNumber bd )) `quot` 8)
        unless s3 $ error "addToBalance failed even after a check in addBlock"

    flushMemAddressStateDB -- needed in case there are no transactions in the block

    actions <- addBlockTransactions True b

    db <- getStateDB

    b' <- do
      when (blockDataStateRoot (obBlockData b) /= MP.stateRoot db) $ do
          $logInfoS "addBlock/mined" . T.pack $ "newStateRoot: " ++ format (MP.stateRoot db)
          error $ "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format (blockDataStateRoot $ obBlockData b)
      return b

    valid <- checkValidity (blockIsHomestead $ blockDataNumber bd) bSum b'
    case valid of
        Right _ -> P.incCounter vmBlocksValid
        Left  _ -> P.incCounter vmBlocksInvalid -- error err -- todo: i dont think we ACTUALLY need to error here

    P.incCounter vmBlocksMined
    P.incCounter vmBlocksProcessed
    $logInfoS "addBlock" .  T.pack $ "Inserted block became #" ++ show (blockDataNumber $ obBlockData b') ++ " (" ++ format (outputBlockHash b') ++ ")."
    return actions

addBlockTransactions :: Bool -> OutputBlock -> ContextM [Action]
addBlockTransactions runPublicTxs b@OutputBlock{obBlockData = bd, obReceiptTransactions = transactions} = do
  $logDebugS "addBlockTransactions" . T.pack $ "All transactions: " ++ show transactions
  let chains' = partitionWith (txChainId . otBaseTx) . filter ((/= PrivateHash) . txType . otBaseTx) $ transactions
      chains  = if runPublicTxs then chains' else filter (isJust . fst) chains'
  fmap concat . forM chains $ \(chainId, txs) -> do
    $logDebugS "addBlockTransactions" . T.pack $ "Running chain: " ++ show chainId ++ " with " ++ show txs
    withBlockchain (blockHeaderHash bd) chainId $ do
      $logDebugS "evm/loop" $ T.pack $ "Running block for chain " ++ show chainId
      actions <- addTransactions bd (blockDataGasLimit $ obBlockData b) txs -- TODO: Run the checks Bagger does reject invalid transactions for private chains
      flushMemStorageDB
      flushMemAddressStateDB
      return actions

addTransactions :: BlockData -> Integer -> [OutputTx] -> ContextM [Action]
addTransactions bd bg ts = go bd bg ts []
  where
    go _ _ [] as = return . reverse $ catMaybes as
    go b blockGas (t:rest) as = do
      flushMemAddressStateTxToBlockDB
      flushStorageTxDBToBlockDB
      beforeMap <- getAddressStateTxDBMap
      !(deltaT, result) <- timeIt $ runExceptT $ addTransaction False b blockGas t
      afterMap <- getAddressStateTxDBMap

      printTransactionMessage t result deltaT
      P.setGauge vmTxMined (realToFrac deltaT)

      mAction <- outputTransactionResult b blockHeaderHash $ TxRunResult t result deltaT beforeMap afterMap

      let remainingBlockGas =
            case result of
            Left _           -> blockGas
            Right execResult -> erRemainingBlockGas execResult

      go b remainingBlockGas rest (mAction : as)

data TxMiningResult = TxMiningResult { tmrFailure  :: Maybe TransactionFailureCause
                                     , tmrRanTxs   :: [TxRunResult]
                                     , tmrUnranTxs :: [OutputTx]
                                     , tmrRemGas   :: Integer
                                     } deriving (Show)

mineTransactions' :: BlockData -> Integer -> [TxRunResult] -> [OutputTx] -> ContextM TxMiningResult
mineTransactions' _ remGas ran [] = return $ TxMiningResult Nothing (reverse ran) [] remGas
mineTransactions' header remGas ran unran@(tx:txs) = do
    flushMemAddressStateTxToBlockDB
    flushStorageTxDBToBlockDB
    beforeMap <- getAddressStateTxDBMap
    (time', !result) <- timeIt . runExceptT $ addTransaction False header remGas tx
    afterMap <- getAddressStateTxDBMap
    P.setGauge vmTxMining (realToFrac time')
    printTransactionMessage tx result time'
    let trr = TxRunResult tx result time' beforeMap afterMap
    case result of
        Right execResult -> mineTransactions' header (erRemainingBlockGas execResult) (trr:ran) txs
        Left  failure    -> return $ TxMiningResult (Just failure) (reverse ran) unran remGas

blockIsHomestead :: Integer -> Bool
blockIsHomestead blockNum = blockNum >= gHomesteadFirstBlock

addTransaction :: Bool -> BlockData -> Integer -> OutputTx -> ExceptT TransactionFailureCause ContextM ExecResults
addTransaction isRunningTests' b remainingBlockGas t@OutputTx{otBaseTx=bt,otSigner=tAddr} = do

    nonceValid <- lift $ isNonceValid t

    let isHomestead   = blockIsHomestead $ blockDataNumber b
        intrinsicGas' = intrinsicGas isHomestead t

    when flags_debug $ do
        $logDebugS "addTx" . T.pack $ "bytes cost: " ++ show (gTXDATAZERO * fromIntegral (zeroBytesLength t) + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - fromIntegral (zeroBytesLength t)))
        $logDebugS "addTx" . T.pack $ "transaction cost: " ++ show gTX
        $logDebugS "addTx" . T.pack $ "intrinsicGas: " ++ show intrinsicGas'

    addressState <- lift $ getAddressState tAddr

    let txCost      = transactionGasLimit bt * transactionGasPrice bt + transactionValue bt
        acctBalance = addressStateBalance addressState
    when (txCost > acctBalance) $ throwE $ TFInsufficientFunds txCost acctBalance t
    when (intrinsicGas' > transactionGasLimit bt) $ throwE $ TFIntrinsicGasExceedsTxLimit intrinsicGas' (transactionGasLimit bt) t
    when (transactionGasLimit bt > remainingBlockGas) $ throwE $ TFBlockGasLimitExceeded (transactionGasLimit bt) remainingBlockGas t
    unless nonceValid $ throwE $ TFNonceMismatch (transactionNonce bt) (addressStateNonce addressState) t

    let availableGas = transactionGasLimit bt - intrinsicGas'

    theAddress <- if isContractCreationTX bt
                  then lift $ getNewAddress tAddr
                  else do
                      lift $ incrementNonce tAddr
                      return (transactionTo bt)
    success <- lift $ addToBalance tAddr (-transactionGasLimit bt * transactionGasPrice bt)
    when flags_debug $ $logDebugS "addTx" "running code"
    let txTypeCounter = if isContractCreationTX bt then vmTxsCreation else vmTxsCall
    lift $ P.incCounter txTypeCounter
    if success
        then do
            (result, newVMState') <- lift $ runCodeForTransaction isRunningTests' isHomestead b (transactionGasLimit bt - intrinsicGas') tAddr theAddress t
            s1 <- lift $ addToBalance (blockDataCoinbase b) (transactionGasLimit bt * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addBlock"
            lift $ P.incCounter vmTxsProcessed
            case result of
                Left e -> do
                    when flags_debug $ $logDebugS "addTx" . T.pack . CL.red $ show e
                    lift $ P.incCounter vmTxsUnsuccessful
                    return ExecResults { erRemainingBlockGas  = remainingBlockGas - transactionGasLimit bt
                                       , erRemainingTxGas     = if e == RevertException
                                                                  then vmGasRemaining newVMState'
                                                                  else 0
                                       -- ReturnVal is only set for RETURN and REVERT, so this must be a REVERT.
                                       , erReturnVal          = returnVal newVMState'
                                       , erTrace              = theTrace newVMState'
                                       , erLogs               = logs newVMState'
                                       , erNewContractAddress = if isContractCreationTX bt then Just theAddress else Nothing
                                       , erAction             = Just $ _action newVMState'
                                       , erException          = Just e
                                       }
                Right _ -> do
                    let realRefund = min (refund newVMState') ((transactionGasLimit bt - vmGasRemaining newVMState') `div` 2)
                    success' <- lift $ pay "VM refund fees" (blockDataCoinbase b) tAddr ((realRefund + vmGasRemaining newVMState') * transactionGasPrice bt)
                    unless success' $ error "oops, refund was too much"

                    when flags_debug $ $logDebugS "addTx" . T.pack $ "Removing accounts in suicideList: " ++ intercalate ", " (show . pretty <$> S.toList (suicideList newVMState'))
                    forM_ (S.toList $ suicideList newVMState') $ \address' -> do
                        lift $ purgeStorageMap address'
                        lift $ deleteAddressState address'
                    lift $ P.incCounter vmTxsSuccessful
                    return ExecResults { erRemainingBlockGas  = remainingBlockGas - (transactionGasLimit bt - realRefund - vmGasRemaining newVMState')
                                       , erRemainingTxGas     = vmGasRemaining newVMState'
                                       , erReturnVal          = returnVal newVMState'
                                       , erTrace              = theTrace newVMState'
                                       , erLogs               = logs newVMState'
                                       , erNewContractAddress = if isContractCreationTX bt then Just theAddress else Nothing
                                       , erAction             = Just $ _action newVMState'
                                       , erException          = Nothing
                                       }
        else do
            s1 <- lift $ addToBalance (blockDataCoinbase b) (intrinsicGas' * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addTransaction"
            addressState' <- lift $ getAddressState tAddr
            $logInfoS "addTransaction/success=false" . T.pack $ "Insufficient funds to run the VM: need " ++ show (availableGas*transactionGasPrice bt) ++ ", have " ++ show (addressStateBalance addressState')
            return ExecResults { erRemainingBlockGas=remainingBlockGas
                               , erRemainingTxGas=transactionGasLimit bt
                               , erReturnVal=Nothing
                               , erTrace=[] --error "theTrace not set" -- seriously?
                               , erLogs=[]
                               , erNewContractAddress=Nothing
                               , erAction = Nothing
                               , erException = Just Blockchain.VM.VMException.InsufficientFunds
                               }

runCodeForTransaction :: Bool
                      -> Bool
                      -> BlockData
                      -> Integer
                      -> Address
                      -> Address
                      -> OutputTx
                      -> ContextM (Either VMException B.ByteString, VMState)
runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr newAddress OutputTx{otBaseTx=ut} | isContractCreationTX ut = do
  when flags_debug $ $logInfoS "runCodeForTransaction" "runCodeForTransaction: ContractCreationTX"

  !(result, vmState) <-
    create isRunningTests'
           isHomestead
           S.empty
           b
           0
           tAddr
           tAddr
           (transactionValue ut)
           (transactionGasPrice ut)
           availableGas
           newAddress
           (transactionInit ut)
           (txHash ut)
           (txChainId ut)
           (txMetadata ut)

  return (const B.empty <$> result, vmState)

runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr owner OutputTx{otBaseTx=ut} = do --MessageTX
  when flags_debug $ $logInfoS "runCodeForTransaction"  $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ show (pretty tAddr) ++ ", address: " ++ show (pretty $ transactionTo ut)

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

calculateIntrinsicGas' :: Integer -> OutputTx -> Integer
calculateIntrinsicGas' blockNum = intrinsicGas (blockIsHomestead blockNum)

intrinsicGas :: Bool -> OutputTx -> Integer
intrinsicGas isHomestead t@OutputTx{otBaseTx=bt} = gTXDATAZERO * zeroLen + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - zeroLen) + txCost bt
    where
      zeroLen = fromIntegral $ zeroBytesLength t
      txCost t' | isMessageTX t' = gTX
      txCost _  = if isHomestead then gCREATETX else gTX

--outputTransactionMessage::IO ()
outputTransactionResult :: BlockData
                        -> (BlockData -> SHA)
                        -> TxRunResult
                        -> ContextM (Maybe Action)
outputTransactionResult b hashFunction (TxRunResult OutputTx{otHash=theHash, otBaseTx=t} result deltaT beforeMap afterMap) = do
  let (txrStatus, message, gasRemaining) =
        case result of
          Left err -> let fmt = format err in (Failure "Execution" Nothing (ExecutionFailure fmt) Nothing Nothing (Just fmt), fmt, 0) -- TODO Also include the trace
          Right r  -> case erException r of
                        Nothing -> (Success, "Success!", erRemainingTxGas r)
                        Just ex -> let fmt = (show $ erTrace r) in (Failure "Execution" Nothing (ExecutionFailure $ show ex) Nothing Nothing (Just fmt), fmt, 0)
      gasUsed = fromInteger $ transactionGasLimit t - gasRemaining
      etherUsed = gasUsed * fromInteger (transactionGasPrice t)

  if not flags_createTransactionResults
    then return Nothing
    else do
      let chainId = txChainId t
          beforeAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList beforeMap ]
          beforeDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList beforeMap ]
          afterAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList afterMap ]
          afterDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList afterMap ]
          modified = (afterAddresses S.\\ afterDeletes) S.\\ (beforeAddresses S.\\ beforeDeletes)
          defaultNewAddrs = S.toList modified
          moveToFront (Just thisAddress) | thisAddress `S.member` modified = thisAddress : S.toList (S.delete thisAddress modified)
          moveToFront _ = defaultNewAddrs
          ranBlockHash = hashFunction b
          mkLogEntry Log{..} = LogDB ranBlockHash theHash chainId address (topics `indexMaybe` 0) (topics `indexMaybe` 1) (topics `indexMaybe` 2) (topics `indexMaybe` 3) logData bloom
          (response, theTrace', theLogs) =
            case result of
              Left _ -> ("", [], []) --TODO keep the trace when the run fails
              Right r ->
                (BC.unpack $ B16.encode $ fromMaybe "" $ erReturnVal r, unlines $ reverse $ erTrace r, erLogs r)

      newAddresses <-
          case result of
              Left _ -> return []
              Right erResult -> filterM (fmap not . NoCache.addressStateExists) $ moveToFront $ erNewContractAddress erResult

      enqueueLogEntries $ mkLogEntry <$> theLogs
      enqueueTransactionResult $
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
                               }
      if not flags_diffPublish
        then return Nothing
        else return $ either (const Nothing) erAction result

logWithBox :: MonadLogger m => T.Text -> Int -> [String] -> m ()
logWithBox source headerSize theLines = do
    let headerAndFooter = indent ++ CL.magenta (replicate headerSize '=')
        addBorder line  = indent ++ CL.magenta "|" ++ " " ++ line ++ " " ++ CL.magenta "|"
        indent          = "    "
    $logInfoS source $ T.pack headerAndFooter
    forM_ (addBorder <$> theLines) ($logInfoS source . T.pack)
    $logInfoS source $ T.pack headerAndFooter

printTransactionMessage::MonadLogger m=>
                         OutputTx->Either TransactionFailureCause ExecResults->NominalDiffTime->m ()
printTransactionMessage OutputTx{otSigner=tAddr, otBaseTx=baseTx, otHash=theHash} (Left errMsg) deltaT = do
    let tNonce = transactionNonce baseTx
    logWithBox "printTx/err" 78 [ "Adding transaction signed by: " ++ show (pretty tAddr) ++ "    "
                                , "Tx hash:  " ++ format theHash
                                , rightPad 74 ' ' $ "Tx nonce: " ++ show tNonce
                                , CL.red "Transaction failure: " ++ CL.red (format errMsg)
                                , "t = " ++ printf "%.5f" (realToFrac deltaT::Double) ++ "s                                                              "
                                ]

printTransactionMessage OutputTx{otBaseTx=t, otSigner=tAddr, otHash=theHash} (Right results) deltaT = do
    let tNonce = transactionNonce t
        txPretty = if isMessageTX t
          then "MessageTX to " ++ show (pretty $ transactionTo t) ++ "                     "
          else "Create Contract "  ++ show (pretty $ fromJust $ erNewContractAddress results) ++ "                  "
    logWithBox "printTx/ok" 78 [ "Adding transaction signed by: " ++ show (pretty tAddr) ++ "    "
                               , "Tx hash:  " ++ format theHash
                               , rightPad 74 ' ' $ "Tx nonce: " ++ show tNonce
                               , txPretty
                               , "t = " ++ printf "%.5f" (realToFrac deltaT::Double) ++ "s                                                              "
                               ]

indexMaybe :: [a] -> Int -> Maybe a
indexMaybe _ i        | i < 0 = error "indexMaybe called for i < 0"
indexMaybe [] _       = Nothing
indexMaybe (x:_) 0    = Just x
indexMaybe (_:rest) i = indexMaybe rest (i-1)

formatAddress :: Address->String
formatAddress (Address x) = BC.unpack $ B16.encode $ B.pack $ word160ToBytes x

----------------

replaceBestIfBetter :: OutputBlock -> ContextM (Bool, (SHA, Integer, Integer))
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

        $logInfoS "replaceBestIfBetter" . T.pack $ "shouldReplace = " ++ show shouldReplace ++ ", newNumber = " ++ show newNumber ++ ", oldBestNumber = " ++ show (blockDataNumber oldBestBlock)

        when shouldReplace $ do
            Bagger.processNewBestBlock bH bd bTHs
            putContextBestBlockInfo $ ContextBestBlockInfo (bH, bd, td, newTxCount, newUncleCount)

        -- we're replaying SeqEvents, and need to notify the mempool
        when (not shouldReplace && (newNumber == oldNumber) && (oldStateRoot == newStateRoot)) $
            Bagger.processNewBestBlock bH bd bTHs

        let bestBlockInfo = (bestSha, bestNum, bestTdiff)
            bestSha       = if shouldReplace then bH        else oldBestSha
            bestNum       = if shouldReplace then newNumber else oldNumber
            bestTdiff     = if shouldReplace then td        else oldBestDifficulty

        return (shouldReplace, bestBlockInfo)

splitCreateDiffs :: [SD.StateDiff] -> [(MP.StateRoot, SHA)]
splitCreateDiffs =
    let sr = stateRoot &&& (M.toList . createdAccounts)
        ch = fmap (codeHash . snd)
        srch = map ch . join . map sequence . map sr
     in S.toList . S.fromList . srch

calculateAndEmitStateDiffs :: (TransactionLike t, Format b, BlockLike BlockData t b) -- todo: generalize commitSqlDiffs etc. to take all BlockHeaderLikes
                           => b
                           -> BlockData
                           -> ContextM ()
calculateAndEmitStateDiffs newBlock oldHeader = when flags_sqlDiff $ do
    let oldHash      = blockHeaderHash oldHeader
        oldStateRoot = MP.StateRoot $ blockHeaderStateRoot oldHeader
        newHeader    = blockHeader newBlock
        newHash      = blockHash newBlock
        newStateRoot = MP.StateRoot (blockHeaderStateRoot newHeader)
        newNumber    = blockHeaderBlockNumber newHeader
    $logInfoS "calculateAndEmitStateDiffs" . T.pack $ "Calculating StateDiff from: " ++ format oldStateRoot ++ "\nto: " ++ format newStateRoot
    diffs <- stateDiff Nothing newNumber newHash oldStateRoot newStateRoot
    $logInfoS "calculateAndEmitStateDiffs" . T.pack $ "Calculating ChainDiffs from: " ++ format oldHash ++ "\nto: " ++ format newHash
    chainDiffs <- chainDiff newNumber oldHash newHash
    $logInfoS "calculateAndEmitStateDiffs" "Calculating all new code hashes"

    let allDiffs = diffs:chainDiffs

    forM_ allDiffs $ lift . commitSqlDiffs
