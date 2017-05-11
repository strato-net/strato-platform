{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NamedFieldPuns        #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.BlockChain
    ( addBlock
    , addBlocks
    , addTransaction
    , addTransactions
    , runCodeForTransaction
    , calculateIntrinsicGas'
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import qualified Control.Monad.State                     as State
import           Control.Monad.Stats                     hiding (Success)
import           Control.Monad.Trans
import           Control.Monad.Trans.Either
import qualified Data.ByteString                         as B
import qualified Data.ByteString.Base16                  as B16
import qualified Data.ByteString.Char8                   as BC
import           Data.IORef                              (newIORef, readIORef, writeIORef)
import           Data.List
import qualified Data.Map                                as M
import           Data.Maybe
import           Data.Ord                                (comparing)
import qualified Data.Set                                as S
import qualified Data.Text                               as T
import           Data.Time.Clock
import           Data.Time.Clock.POSIX
import           Network.Kafka                           (withKafkaViolently)
import           Text.PrettyPrint.ANSI.Leijen            (pretty)
import           Text.Printf

import qualified Blockchain.Colors                       as CL
import           Blockchain.Constants
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
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.Sequencer.Event
import           Blockchain.Stream.UnminedBlock
import           Blockchain.TheDAOFork
import           Blockchain.Verifier
import           Blockchain.VM
import           Blockchain.VM.Code
import           Blockchain.VM.OpcodePrices
import           Blockchain.VM.VMState
import           Blockchain.VMContext
import           Blockchain.VMMetrics
import           Blockchain.VMOptions

import qualified Blockchain.Bagger                       as Bagger
import           Blockchain.Output                       (rightPad)
import           Blockchain.SHA                          (formatSHAWithoutColor)
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.StateDiff             hiding (StateDiff (blockHash))
import           Blockchain.Strato.StateDiff.Database
import           Blockchain.Strato.StateDiff.Event
import           Blockchain.Strato.StateDiff.Kafka

import           Blockchain.Strato.Indexer.Kafka         (writeIndexEvents)
import           Blockchain.Strato.Indexer.Model         (IndexEvent (..))
import           Executable.EVMFlags

data TransactionFailureCause = TFInsufficientFunds Integer Integer OutputTx -- txCost, accountBalance
                             | TFIntrinsicGasExceedsTxLimit Integer Integer OutputTx -- intrinsicGas, txGasLimit
                             | TFBlockGasLimitExceeded Integer Integer OutputTx-- neededGas, actualGas
                             | TFNonceMismatch Integer Integer OutputTx -- expectedNonce, actualNonce
                             deriving (Eq, Read, Show)

txRejectionToAPIFailureCause :: Bagger.TxRejection -> TransactionResultStatus
txRejectionToAPIFailureCause (Bagger.NonceTooLow    stage queue needed tx) =
    Failure (show stage) (Just $ show queue) IncorrectNonce (Just needed) (Just . transactionNonce $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (Bagger.BalanceTooLow  stage queue needed actual tx) =
    Failure (show stage) (Just $ show queue) Blockchain.Data.TransactionResultStatus.InsufficientFunds (Just needed) (Just actual) Nothing
txRejectionToAPIFailureCause (Bagger.GasLimitTooLow stage queue needed tx) =
    Failure (show stage) (Just $ show queue) IntrinsicGasExceedsLimit (Just needed) (Just . transactionGasLimit $ otBaseTx tx) Nothing
txRejectionToAPIFailureCause (Bagger.LessLucrative  stage queue newTx oldTx) =
    Failure (show stage) (Just $ show queue) TrumpedByMoreLucrative Nothing Nothing (Just $ "trumped by " ++ formatSHAWithoutColor (otHash newTx))

tfToBaggerTxRejection :: TransactionFailureCause -> Bagger.TxRejection
tfToBaggerTxRejection (TFInsufficientFunds cost balance tx) = Bagger.BalanceTooLow Bagger.Execution Bagger.Queued cost balance tx
tfToBaggerTxRejection (TFIntrinsicGasExceedsTxLimit ig _ tx) = Bagger.GasLimitTooLow Bagger.Execution Bagger.Queued ig tx
tfToBaggerTxRejection TFBlockGasLimitExceeded{} = error "please dont do that (call tfToBaggerTxRejection on a TFBlockGasLimitExceeded)"
tfToBaggerTxRejection (TFNonceMismatch expected _ tx) = Bagger.NonceTooLow Bagger.Execution Bagger.Queued expected tx

instance Format TransactionFailureCause where
    format (TFInsufficientFunds cost bal _) = "Insufficient funds: cost " ++ show cost ++ " > balance " ++ show bal
    format (TFIntrinsicGasExceedsTxLimit intG txGL _) = "Intrinsic gas exceeds TX gas limit: intrinsic gas " ++ show intG ++ " > tx gas limit " ++ show txGL
    format (TFBlockGasLimitExceeded txG blkG _) = "Block gas limit exceeded: needed " ++ show txG ++ " > available " ++ show blkG
    format (TFNonceMismatch expected actual _) = "Nonce mismatch: expecting " ++ show expected ++ ", actual " ++ show actual

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
        let recoverable f = Left (Bagger.RecoverableFailure (tfToBaggerTxRejection f) ranTxs unranTxs newStateRoot newGas)
        return $ case res of -- currently only get GasLimit errors out of mineTransactions'
            Nothing -> Right (newStateRoot, newGas)
            Just TFBlockGasLimitExceeded{}  -> Left (Bagger.GasLimitReached ranTxs unranTxs newStateRoot newGas)
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
        let (message, _, _, theHash) = baggerRejectionToTransactionResultBits rejection
        -- if a tx is dropped from Queued during demotion, it means it was likely culled during the demotion as the
        -- new best block we just mined came in
        let isRecentlyRan = theHash `elem` bestBlockShas
        when (flags_createTransactionResults && not isRecentlyRan) $ do
            $logInfoS "txsDroppedCallback" . T.pack $ "Transaction rejection :: " ++ format rejection
            void $ putTransactionResult
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
                                       }

baggerRejectionToTransactionResultBits :: Bagger.TxRejection -> (String, Bagger.BaggerStage, Bagger.BaggerTxQueue, SHA) -- pretty, queue, txHash
baggerRejectionToTransactionResultBits rejection = case rejection of
    Bagger.NonceTooLow    s q actual OutputTx{otHash=hash, otBaseTx=bt} ->
        (p' s q ++ "tx nonce (expected: " ++ show (transactionNonce bt) ++ ", actual: " ++ show actual ++ ")", s, q, hash)
    Bagger.BalanceTooLow  s q needed actual OutputTx{otHash=hash} ->
        (p' s q ++ "account balance (expected: " ++ show needed ++ ", actual: " ++ show actual ++ ")", s, q, hash)
    Bagger.GasLimitTooLow s q _ OutputTx{otHash=hash} ->
        (p' s q ++ "tx gas limit", s, q, hash)
    Bagger.LessLucrative  s q OutputTx{otHash=hashBetter} OutputTx{otHash=hashWorse} ->
        (p s q ++ formatSHAWithoutColor hashBetter ++ " being a more lucrative transaction", s, q, hashWorse)

    where p stage queue = "Rejected from mempool at " ++ show stage ++ "/" ++ show queue ++ " due to "
          p' s q        = p s q ++ "low "

-- todo: lovely!

timeIt :: MonadIO m => m a -> m (NominalDiffTime, a)
timeIt f = do
    timeBefore <- liftIO getPOSIXTime
    result <- f
    timeAfter <- liftIO getPOSIXTime
    return (timeAfter - timeBefore, result)

timeit :: (MonadIO m, MonadLogger m, MonadStats m) => String -> Maybe Timer -> m a -> m a
timeit message timer f = do
    (diff, ret) <- timeIt f
    $logInfoS "timeit" . T.pack $ "#### " ++ message ++ " time = " ++ printf "%.4f" (realToFrac diff ::Double) ++ "s"
    forM_ timer (time diff)
    return ret

addBlocks :: Bool -> [OutputBlock] -> ContextM ()
addBlocks _ [] = return ()
addBlocks isUnmined blocks = if flags_newRBIBBehavior then addBlocks_new else addBlocks_old
    where addBlocks_old, addBlocks_new :: ContextM ()
          addBlocks_old = do
              let blocks' = filter ((/= 0) . blockDataNumber . obBlockData) blocks
              lift . $logInfoS "addBlocks_old" . T.pack $ ("Inserting " ++ show (length blocks) ++ " block starting with " ++
                                                     (show . blockDataNumber . obBlockData $ head blocks))
              forM_ blocks' $ timeit "Block insertion" timerToUse . addBlock isUnmined
              $logInfoS "addBlocks_old" "done inserting, now will replace best if best is among the list"
              let bestIfBetterCandidate = maximumBy (comparing obTotalDifficulty) blocks'
              unless isUnmined $ do
                  void $ withKafkaViolently $ writeIndexEvents (RanBlock <$> blocks')
                  (_, nbb) <- replaceBestIfBetter bestIfBetterCandidate True
                  void . withKafkaViolently $ writeIndexEvents [NewBestBlock nbb]


          addBlocks_new = do
              let blocks' = filter ((/= 0) . blockDataNumber . obBlockData) blocks
              lift $ $logInfoS "addBlocks_new" $ T.pack ("Inserting " ++ show (length blocks) ++ " block starting with " ++
                                                     (show . blockDataNumber . obBlockData $ head blocks))
              ContextBestBlockInfo (_, oldHeader, _, _, _) <- getContextBestBlockInfo
              let oldStateRoot = blockDataStateRoot oldHeader
              didReplaceBest <- liftIO (newIORef False)
              replacedBest   <- liftIO (newIORef undefined)
              forM_ blocks' $ \block -> timeit "Block insertion" timerToUse $ do
                  addBlock isUnmined block
                  unless isUnmined $ do
                      (didReplaceThisTime, replacedBits) <- replaceBestIfBetter block False
                      when didReplaceThisTime . liftIO $ do
                          writeIORef didReplaceBest True
                          writeIORef replacedBest (block, replacedBits)
              didReplaceBest' <- liftIO (readIORef didReplaceBest)
              unless isUnmined $ do
                  void . withKafkaViolently $ writeIndexEvents (RanBlock <$> blocks')
                  when didReplaceBest' $ do
                      $logInfoS "addBlocks_new" "done inserting, now will emit stateDiff if necessary"
                      (theBlock, nbb) <- liftIO (readIORef replacedBest)
                      void . withKafkaViolently $ writeIndexEvents [NewBestBlock nbb]
                      calculateAndEmitStateDiffs theBlock oldStateRoot

          timerToUse = Just $ if isUnmined then time_vm_block_insertion_unmined else time_vm_block_insertion_mined

setTitle :: String -> IO()
setTitle value = putStr $ "\ESC]0;" ++ value ++ "\007"

addBlock::Bool->OutputBlock->ContextM () -- change Block to OutputBlock
addBlock isUnmined b@OutputBlock{obBlockData=bd, obReceiptTransactions = transactions, obBlockUncles=uncles} = do
    bSum <- BSDB.getBSum (blockDataParentHash bd)
    liftIO $ setTitle $ "Block #" ++ show (blockDataNumber bd)
    lift $ $logInfoS "addBlock" . T.pack $ "Inserting block #" ++ show (blockDataNumber bd) ++ " (" ++ format (outputBlockHash b) ++ ")."
    setStateDBStateRoot (bSumStateRoot bSum)
    when (blockDataNumber bd == 1920000) runTheDAOFork
    s1 <- addToBalance (blockDataCoinbase bd) (rewardBase flags_testnet)
    unless s1 $ error "addToBalance failed even after a check in addBlock"

    forM_ uncles $ \uncle -> do
        s2 <- addToBalance (blockDataCoinbase bd) (rewardBase flags_testnet `quot` 32)
        unless s2 $ error "addToBalance failed even after a check in addBlock"

        s3 <- addToBalance
              (blockDataCoinbase uncle)
            ((rewardBase flags_testnet * (8+blockDataNumber uncle - blockDataNumber bd )) `quot` 8)
        unless s3 $ error "addToBalance failed even after a check in addBlock"
    _ <- addTransactions isUnmined bd (blockDataGasLimit $ obBlockData b) transactions
      --when flags_debug $ liftIO $ putStrLn $ "Removing accounts in suicideList: " ++ intercalate ", " (show . pretty <$> S.toList fullSuicideList)
      --forM_ (S.toList fullSuicideList) deleteAddressState

    flushMemStorageDB
    flushMemAddressStateDB

    db <- getStateDB

    b' <- if isUnmined then do
            let newBlockData = (obBlockData b){blockDataStateRoot=MP.stateRoot db}
                newBlock = b{obBlockData = newBlockData}
            $logInfoS "addBlock/unmined" "Note: block is partial, instead of doing a stateRoot check, I will fill in the stateroot"
            produceUnminedBlocks [outputBlockToBlock newBlock]
            $logInfoS "addBlock/unmined" "stateRoot has been filled in"
            return newBlock
          else do
            when (blockDataStateRoot (obBlockData b) /= MP.stateRoot db) $ do
                $logInfoS "addBlock/mined" . T.pack $ "newStateRoot: " ++ format (MP.stateRoot db)
                error $ "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format (blockDataStateRoot $ obBlockData b)
            return b

    valid <- checkValidity isUnmined (blockIsHomestead $ blockDataNumber bd) bSum b'
    case valid of
        Right _ -> tick ctr_vm_blocks_valid
        Left  _ -> tick ctr_vm_blocks_invalid -- error err -- todo: i dont think we ACTUALLY need to error here

    tick $ if isUnmined
           then ctr_vm_blocks_unmined
           else ctr_vm_blocks_mined
    tick ctr_vm_blocks_processed
    $logInfoS "addBlock" .  T.pack $ "Inserted block became #" ++ show (blockDataNumber $ obBlockData b') ++ " (" ++ format (outputBlockHash b') ++ ")."
    return ()

addTransactions :: Bool -> BlockData -> Integer -> [OutputTx] -> ContextM Integer
addTransactions _ _ remGas [] = return remGas
addTransactions isUnmined b blockGas (t:rest) = do
  beforeMap <- getAddressStateDBMap
  !(deltaT, result) <- timeIt $ runEitherT $ addTransaction False b blockGas t
  afterMap <- getAddressStateDBMap

  printTransactionMessage t result deltaT
  time deltaT time_vm_tx_mined

  unless isUnmined $
    outputTransactionResult b t result deltaT beforeMap afterMap

  let remainingBlockGas =
        case result of
         Left _           -> blockGas
         Right execResult -> erRemainingBlockGas execResult

  addTransactions isUnmined b remainingBlockGas rest

data TxMiningResult = TxMiningResult { tmrFailure  :: Maybe TransactionFailureCause
                                     , tmrRanTxs   :: [OutputTx]
                                     , tmrUnranTxs :: [OutputTx]
                                     , tmrRemGas   :: Integer
                                     } deriving (Eq, Read, Show)

mineTransactions' :: BlockData -> Integer -> [OutputTx] -> [OutputTx] -> ContextM TxMiningResult
mineTransactions' _ remGas ran [] = return $ TxMiningResult Nothing (reverse ran) [] remGas
mineTransactions' header remGas ran unran@(tx:txs) = do
    (time', !result) <- timeIt . runEitherT $ addTransaction False header remGas tx
    time time' time_vm_tx_mining
    printTransactionMessage tx result time'
    case result of
        Right execResult -> mineTransactions' header (erRemainingBlockGas execResult) (tx:ran) txs
        Left  failure    -> return $ TxMiningResult (Just failure) (reverse ran) unran remGas

blockIsHomestead :: Integer -> Bool
blockIsHomestead blockNum = blockNum >= gHomesteadFirstBlock

addTransaction :: Bool -> BlockData -> Integer -> OutputTx -> EitherT TransactionFailureCause ContextM ExecResults
addTransaction isRunningTests' b remainingBlockGas t@OutputTx{otBaseTx=bt,otSigner=tAddr} = do
    nonceValid <- lift $ isNonceValid t

    let isHomestead   = blockIsHomestead $ blockDataNumber b
        intrinsicGas' = intrinsicGas isHomestead t

    when flags_debug . lift $ do
        $logDebugS "addTx" . T.pack $ "bytes cost: " ++ show (gTXDATAZERO * fromIntegral (zeroBytesLength t) + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - fromIntegral (zeroBytesLength t)))
        $logDebugS "addTx" . T.pack $ "transaction cost: " ++ show gTX
        $logDebugS "addTx" . T.pack $ "intrinsicGas: " ++ show intrinsicGas'

    addressState <- lift $ getAddressState tAddr

    let txCost      = transactionGasLimit bt * transactionGasPrice bt + transactionValue bt
        acctBalance = addressStateBalance addressState
    when (txCost > acctBalance) $ left $ TFInsufficientFunds txCost acctBalance t
    when (intrinsicGas' > transactionGasLimit bt) $ left $ TFIntrinsicGasExceedsTxLimit intrinsicGas' (transactionGasLimit bt) t
    when (transactionGasLimit bt > remainingBlockGas) $ left $ TFBlockGasLimitExceeded (transactionGasLimit bt) remainingBlockGas t
    unless nonceValid $ left $ TFNonceMismatch (transactionNonce bt) (addressStateNonce addressState) t

    let availableGas = transactionGasLimit bt - intrinsicGas'

    theAddress <- if isContractCreationTX bt
                  then lift $ getNewAddress tAddr
                  else do
                      lift $ incrementNonce tAddr
                      return (transactionTo bt)
    success <- lift $ addToBalance tAddr (-transactionGasLimit bt * transactionGasPrice bt)
    when flags_debug . lift $ $logDebugS "addTx" "running code"
    let txTypeCounter = if isContractCreationTX bt then ctr_vm_tx_creation else ctr_vm_tx_call
    lift $ tick txTypeCounter
    if success
        then do
            (result, newVMState') <- lift $ runCodeForTransaction isRunningTests' isHomestead b (transactionGasLimit bt - intrinsicGas') tAddr theAddress t
            s1 <- lift $ addToBalance (blockDataCoinbase b) (transactionGasLimit bt * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addBlock"
            lift $ tick ctr_vm_txs_processed
            case result of
                Left e -> do
                    when flags_debug . lift . $logDebugS "addTx" . T.pack . CL.red $ show e
                    lift $ tick ctr_vm_txs_unsuccessful
                    return ExecResults { erRemainingBlockGas  = remainingBlockGas - transactionGasLimit bt
                                       , erReturnVal          = returnVal newVMState'
                                       , erTrace              = theTrace newVMState'
                                       , erLogs               = logs newVMState'
                                       , erNewContractAddress = if isContractCreationTX bt then Just theAddress else Nothing
                                       }
                Right _ -> do
                    let realRefund = min (refund newVMState') ((transactionGasLimit bt - vmGasRemaining newVMState') `div` 2)
                    success' <- lift $ pay "VM refund fees" (blockDataCoinbase b) tAddr ((realRefund + vmGasRemaining newVMState') * transactionGasPrice bt)
                    unless success' $ error "oops, refund was too much"

                    when flags_debug . lift . $logDebugS "addTx" . T.pack $ "Removing accounts in suicideList: " ++ intercalate ", " (show . pretty <$> S.toList (suicideList newVMState'))
                    forM_ (S.toList $ suicideList newVMState') $ \address' -> do
                        lift $ purgeStorageMap address'
                        lift $ deleteAddressState address'
                    lift $ tick ctr_vm_txs_successful
                    return ExecResults { erRemainingBlockGas  = remainingBlockGas - (transactionGasLimit bt - realRefund - vmGasRemaining newVMState')
                                       , erReturnVal          = returnVal newVMState'
                                       , erTrace              = theTrace newVMState'
                                       , erLogs               = logs newVMState'
                                       , erNewContractAddress = if isContractCreationTX bt then Just theAddress else Nothing
                                       }
        else do
            s1 <- lift $ addToBalance (blockDataCoinbase b) (intrinsicGas' * transactionGasPrice bt)
            unless s1 $ error "addToBalance failed even after a check in addTransaction"
            addressState' <- lift $ getAddressState tAddr
            lift . $logInfoS "addTransaction/success=false" . T.pack $ "Insufficient funds to run the VM: need " ++ show (availableGas*transactionGasPrice bt) ++ ", have " ++ show (addressStateBalance addressState')
            return ExecResults { erRemainingBlockGas=remainingBlockGas
                               , erReturnVal=Nothing
                               , erTrace=error "theTrace not set" -- todo: seriously?
                               , erLogs=[]
                               , erNewContractAddress=Nothing
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
    create isRunningTests' isHomestead S.empty b 0 tAddr tAddr (transactionValue ut) (transactionGasPrice ut) availableGas newAddress (transactionInit ut)

  return (const B.empty <$> result, vmState)

runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr owner OutputTx{otBaseTx=ut} = do --MessageTX
  when flags_debug $ $logInfoS "runCodeForTransaction"  $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ show (pretty tAddr) ++ ", address: " ++ show (pretty $ transactionTo ut)

  call isRunningTests' isHomestead False S.empty b 0 owner owner tAddr
          (fromIntegral $ transactionValue ut) (fromIntegral $ transactionGasPrice ut)
          (transactionData ut) (fromIntegral availableGas) tAddr

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
outputTransactionResult::BlockData->OutputTx->Either TransactionFailureCause ExecResults->NominalDiffTime->
                         M.Map Address AddressStateModification->M.Map Address AddressStateModification->ContextM ()
outputTransactionResult b OutputTx{otHash=theHash, otBaseTx=t, otSigner=tAddr} result deltaT beforeMap afterMap = do
  let
    (txrStatus, message, gasRemaining) =
      case result of
        Left err -> let fmt = format err in (Failure "Execution" Nothing ExecutionFailure Nothing Nothing (Just fmt), fmt, 0) -- TODO Also include the trace
        Right r  -> (Success, "Success!", erRemainingBlockGas r)
    gasUsed = fromInteger $ transactionGasLimit t - gasRemaining
    etherUsed = gasUsed * fromInteger (transactionGasLimit t)

  when flags_createTransactionResults $ do
      let beforeAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList beforeMap ]
          beforeDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList beforeMap ]
          afterAddresses = S.fromList [ x | (x, ASModification _) <-  M.toList afterMap ]
          afterDeletes = S.fromList [ x | (x, ASDeleted) <-  M.toList afterMap ]
          modified = (afterAddresses S.\\ afterDeletes) S.\\ (beforeAddresses S.\\ beforeDeletes)

      --mpdb <- getStateDB
      --addrDiff <- addrDbDiff mpdb stateRootBefore stateRootAfter

      let (response, theTrace', theLogs) =
            case result of
              Left _ -> ("", [], []) --TODO keep the trace when the run fails
              Right r ->
                (BC.unpack $ B16.encode $ fromMaybe "" $ erReturnVal r, unlines $ reverse $ erTrace r, erLogs r)

      let defaultNewAddrs = S.toList modified
          moveToFront (Just thisAddress) | thisAddress `S.member` modified = thisAddress : S.toList (S.delete thisAddress modified)
          moveToFront _ = defaultNewAddrs

      newAddresses <-
          case result of
              Left _ -> return []
              Right erResult -> filterM (fmap not . NoCache.addressStateExists) $ moveToFront $ erNewContractAddress erResult

      forM_ theLogs $ \log' ->
        putLogDB $ LogDB theHash (address log') (topics log' `indexMaybe` 0) (topics log' `indexMaybe` 1) (topics log' `indexMaybe` 2) (topics log' `indexMaybe` 3) (logData log') (bloom log')

      void $ putTransactionResult
             TransactionResult { transactionResultBlockHash        = blockHeaderHash b
                               , transactionResultTransactionHash  = theHash
                               , transactionResultMessage          = message
                               , transactionResultResponse         = response
                               , transactionResultTrace            = theTrace'
                               , transactionResultGasUsed          = gasUsed
                               , transactionResultEtherUsed        = etherUsed
                               , transactionResultContractsCreated = intercalate "," $ map formatAddress newAddresses
                               , transactionResultContractsDeleted = intercalate "," $ map formatAddress $ S.toList $ (beforeAddresses S.\\ afterAddresses) `S.union` (afterDeletes S.\\ beforeDeletes)
                               , transactionResultStateDiff        = "" --BC.unpack $ BL.toStrict $ Aeson.encode addrDiff
                               , transactionResultTime             = realToFrac deltaT
                               , transactionResultNewStorage       = ""
                               , transactionResultDeletedStorage   = ""
                               , transactionResultStatus           = Just txrStatus
                               }

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

replaceBestIfBetter :: OutputBlock -> Bool -> ContextM (Bool, (SHA, Integer, Integer))
replaceBestIfBetter b@OutputBlock{obBlockData = bd, obTotalDifficulty = td, obReceiptTransactions=txs, obBlockUncles=uncles} emitStateDiff = do
    ContextBestBlockInfo(oldBestSha, oldBestBlock, oldBestDifficulty, oldTxCount, _) <- getContextBestBlockInfo

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
        putContextBestBlockInfo $ ContextBestBlockInfo (bH, bd, td, newTxCount, newUncleCount) -- this used to only happen `when flags_sqlDiff`... what the actual fuck?
        when emitStateDiff $ do
            $logInfoS "replaceBestIfBetter/emitStateDiff" "emitStateDiff = true, emitting StateDiff"
            calculateAndEmitStateDiffs b oldStateRoot

    -- we're replaying SeqEvents, and need to notify the mempool
    when (not shouldReplace && (newNumber == oldNumber) && (oldStateRoot == newStateRoot)) $
        Bagger.processNewBestBlock bH bd bTHs

    let bestBlockInfo = (bestSha, bestNum, bestTdiff)
        bestSha       = if shouldReplace then bH        else oldBestSha
        bestNum       = if shouldReplace then newNumber else oldNumber
        bestTdiff     = if shouldReplace then td        else oldBestDifficulty

    return (shouldReplace, bestBlockInfo)

calculateAndEmitStateDiffs :: (TransactionLike t, Format b, BlockLike BlockData t b) -- todo: generalize commitSqlDiffs etc. to take all BlockHeaderLikes
                           => b
                           -> MP.StateRoot
                           -> ContextM ()
calculateAndEmitStateDiffs newBlock oldStateRoot = when (flags_sqlDiff || flags_diffPublish) $ do
    let newHeader    = blockHeader newBlock
        newHash      = blockHash newBlock
        newStateRoot = MP.StateRoot (blockHeaderStateRoot newHeader)
        newNumber    = blockHeaderBlockNumber newHeader
    $logInfoS "calculateAndEmitStateDiffs" . T.pack $ "Calculating StateDiff from: " ++ show oldStateRoot ++ "\nto: " ++ format newBlock
    diffs <- stateDiff newNumber newHash oldStateRoot newStateRoot
    when flags_sqlDiff $ commitSqlDiffs diffs
    when flags_diffPublish $
        let (deletionEvents, creationEvents, updateEvents) = destructStateDiff diffs
         in withKafkaViolently $ do
             void $ writeStateDiffEvents deletionEvents
             void $ writeStateDiffEvents creationEvents
             void $ writeStateDiffEvents updateEvents
