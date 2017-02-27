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
import           Control.Monad.Trans
import           Control.Monad.Trans.Either
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Char8              as BC
import qualified Data.ByteString.Lazy               as BL
import           Data.IORef                         (newIORef, readIORef,
                                                     writeIORef)
import           Data.List
import qualified Data.Map                           as M
import           Data.Maybe
import           Data.Ord                           (comparing)
import qualified Data.Set                           as S
import qualified Data.Text                          as T
import           Data.Time.Clock
import           Data.Time.Clock.POSIX
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>), lines)
import           Text.Printf

import qualified Data.Aeson                         as Aeson

import qualified Blockchain.Colors                  as CL
import           Blockchain.Constants
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.DiffDB
import           Blockchain.Data.ExecResults
import           Blockchain.Data.Log
import           Blockchain.Data.LogDB
import           Blockchain.Data.StateDiff          hiding
                                                     (StateDiff (blockHash))
import           Blockchain.Data.Transaction
import           Blockchain.Data.TransactionResult
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.DB.AddressStateDB       as NoCache
import qualified Blockchain.DB.BlockSummaryDB       as BSDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.Sequencer.Event
import           Blockchain.Stream.Raw
import           Blockchain.Stream.UnminedBlock
import           Blockchain.TheDAOFork
import           Blockchain.Verifier
import           Blockchain.VM
import           Blockchain.VM.Code
import           Blockchain.VM.OpcodePrices
import           Blockchain.VM.VMState
import           Blockchain.VMContext
import           Blockchain.VMOptions

import           Blockchain.Output                  (rightPad)

import qualified Blockchain.Bagger                  as Bagger
import           Blockchain.SHA                     (formatSHAWithoutColor)
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import qualified Control.Monad.State                as State

import           Blockchain.Strato.Indexer.Kafka    (writeIndexEvents)
import           Blockchain.Strato.Indexer.Model    (IndexEvent (..))

import           Network.Kafka                      (withKafkaViolently)

import           Executable.EVMFlags

data TransactionFailureCause = TFInsufficientFunds Integer Integer -- txCost, accountBalance
                             | TFIntrinsicGasExceedsTxLimit Integer Integer -- intrinsicGas, txGasLimit
                             | TFBlockGasLimitExceeded Integer Integer -- neededGas, actualGas
                             | TFNonceMismatch Integer Integer  -- expectedNonce, actualNonce

instance Show TransactionFailureCause where
    show (TFInsufficientFunds cost bal) = "Insufficient funds: cost " ++ show cost ++ " > balance " ++ show bal
    show (TFIntrinsicGasExceedsTxLimit intG txGL) = "Intrinsic gas exceeds TX gas limit: intrinsic gas " ++ show intG ++ " > tx gas limit " ++ show txGL
    show (TFBlockGasLimitExceeded txG blkG) = "Block gas limit exceeded: needed " ++ show txG ++ " > available " ++ show blkG
    show (TFNonceMismatch expected actual) = "Nonce mismatch: expecting " ++ show expected ++ ", actual " ++ show actual

-- has to be here unfortunately, or else BlockChain.hs puts a circular dependency on VMContext.hs
instance Bagger.MonadBagger ContextM where
    getBaggerState = contextBaggerState <$> State.get
    putBaggerState s = do
        ctx <- State.get
        State.put $ ctx { contextBaggerState = s }

    runFromStateRoot sr remainingGas blockHeader txs = do
        startingStateRoot <- getStateRoot
        setStateDBStateRoot sr
        (res, ranTxs, unranTxs, newGas) <- mineTransactions' blockHeader remainingGas [] txs
        flushMemStorageDB
        flushMemAddressStateDB
        newStateRoot <- getStateRoot
        setStateDBStateRoot startingStateRoot
        case res of -- currently only get GasLimit errors out of mineTransactions'
            Left (TFBlockGasLimitExceeded _ _) -> return $ Left (Bagger.GasLimitReached ranTxs unranTxs newStateRoot newGas)
            Left err -> error $ "mineTransactions' failed unexpectedly: " ++ show err
            Right _ -> return $ Right (newStateRoot, newGas)

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
        let (message, stage, queue, txHash) = baggerRejectionToTransactionResultBits rejection
        -- if a tx is dropped from Queued during demotion, it means it was likely culled during the demotion as the
        -- new best block we just mined came in
        let isRecentlyRan = txHash `elem` bestBlockShas
        when (flags_createTransactionResults && not isRecentlyRan) $ do
            $logInfoS "txsDroppedCallback" . T.pack $ "Transaction rejection :: " ++ format rejection
            _ <- putTransactionResult
                     TransactionResult {
                       transactionResultBlockHash=SHA 0,
                       transactionResultTransactionHash=txHash,
                       transactionResultMessage=message,
                       transactionResultResponse="",
                       transactionResultTrace="rejected",
                       transactionResultGasUsed=0,
                       transactionResultEtherUsed=0,
                       transactionResultContractsCreated="",
                       transactionResultContractsDeleted="",
                       transactionResultStateDiff="",
                       transactionResultTime=0,
                       transactionResultNewStorage="",
                       transactionResultDeletedStorage=""
                       }
            return ()

baggerRejectionToTransactionResultBits :: Bagger.BaggerTxRejection -> (String, Bagger.BaggerStage, Bagger.BaggerTxQueue, SHA) -- pretty, queue, txHash
baggerRejectionToTransactionResultBits rejection = case rejection of
    Bagger.NonceTooLow    stage queue _ OutputTx{otHash=hash} -> ("Rejected from mempool at "++ show stage ++ "/" ++ show queue ++ " due to low tx nonce", stage, queue, hash)
    Bagger.BalanceTooLow  stage queue _ OutputTx{otHash=hash} -> ("Rejected from mempool at "++ show stage ++ "/" ++ show queue ++ " due to low account balance", stage, queue, hash)
    Bagger.GasLimitTooLow stage queue _ OutputTx{otHash=hash} -> ("Rejected from mempool at "++ show stage ++ "/" ++ show queue ++ " due to low tx gas limit", stage, queue, hash)
    Bagger.LessLucrative  stage queue OutputTx{otHash=hashBetter} OutputTx{otHash=hashWorse} ->
        ("Rejected from mempool at "++ show stage ++ "/" ++ show queue ++ " due to " ++ formatSHAWithoutColor hashBetter ++
         " being a more lucrative transaction", stage, queue, hashWorse)

isNonceRejection :: Bagger.BaggerTxRejection -> Bool
isNonceRejection Bagger.NonceTooLow{} = True
isNonceRejection _                    = False

timeit::(MonadIO m, MonadLogger m)=>String->m a->m a
timeit message f = do
    before <- liftIO getPOSIXTime
    ret <- f
    after <- liftIO getPOSIXTime
    $logInfoS "timeit" . T.pack $ "#### " ++ message ++ " time = " ++ printf "%.4f" (realToFrac $ after - before::Double) ++ "s"
    return ret

addBlocks :: Bool -> [OutputBlock] -> ContextM ()
addBlocks _ [] = return ()
addBlocks isUnmined blocks = if flags_newRBIBBehavior then addBlocks_new else addBlocks_old
    where addBlocks_old, addBlocks_new :: ContextM ()
          addBlocks_old = do
              let blocks' = filter ((/= 0) . blockDataNumber . obBlockData) blocks
              lift $ $logInfoS "addBlocks_old" $ T.pack ("Inserting " ++ show (length blocks) ++ " block starting with " ++
                                                     (show . blockDataNumber . obBlockData $ head blocks))
              forM_ blocks' $ timeit "Block insertion" . addBlock isUnmined
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
              replacedBBI    <- liftIO (newIORef undefined)
              forM_ blocks' $ \block -> timeit "Block insertion" $ do
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
        Right () -> return ()
        Left err -> error err
    $logInfoS "addBlock" .  T.pack $ "Inserted block became #" ++ show (blockDataNumber $ obBlockData b') ++ " (" ++ format (outputBlockHash b') ++ ")."
    return ()

addTransactions::Bool->BlockData->Integer->[OutputTx]->ContextM Integer
addTransactions _ _ remGas [] = return remGas
addTransactions isUnmined b blockGas (t:rest) = do
  beforeMap <- getAddressStateDBMap
  !(deltaT, result) <- timeIt $ runEitherT $ addTransaction False b blockGas t
  afterMap <- getAddressStateDBMap

  printTransactionMessage t result deltaT

  unless isUnmined $
    outputTransactionResult b t result deltaT beforeMap afterMap

  let remainingBlockGas =
        case result of
         Left _           -> blockGas
         Right execResult -> erRemainingBlockGas execResult

  addTransactions isUnmined b remainingBlockGas rest

mineTransactions' :: BlockData -> Integer -> [OutputTx] -> [OutputTx] -> ContextM (Either TransactionFailureCause (), [OutputTx], [OutputTx], Integer)
mineTransactions' _ remGas ran [] = return (Right (), reverse ran, [], remGas)
mineTransactions' header remGas ran unran@(tx:txs) = do
    (time, !result) <- timeIt . runEitherT $ addTransaction False header remGas tx
    printTransactionMessage tx result time
    case result of
        Left f@(TFBlockGasLimitExceeded need have) -> return (Left f, reverse ran, unran, have)
        Left other       -> error $ "mineTransactions' unexpected failure: " ++ show other
        Right execResult -> mineTransactions' header (erRemainingBlockGas execResult) (tx:ran) txs

blockIsHomestead::Integer->Bool
blockIsHomestead blockNum = blockNum >= gHomesteadFirstBlock

addTransaction::Bool->BlockData->Integer->OutputTx->EitherT TransactionFailureCause ContextM ExecResults
addTransaction isRunningTests' b remainingBlockGas t@OutputTx{otBaseTx=bt,otSigner=tAddr} = do
  nonceValid <- lift $ isNonceValid t

  let isHomestead = blockIsHomestead $ blockDataNumber b
      intrinsicGas' = intrinsicGas isHomestead t

  when flags_debug $
    lift $ do
      $logDebugS "addTx" $ T.pack $ "bytes cost: " ++ show (gTXDATAZERO * fromIntegral (zeroBytesLength t) + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - fromIntegral (zeroBytesLength t)))
      $logDebugS "addTx" $ T.pack $ "transaction cost: " ++ show gTX
      $logDebugS "addTx" $ T.pack $ "intrinsicGas: " ++ show intrinsicGas'

  addressState <- lift $ getAddressState tAddr

  let txCost      = transactionGasLimit bt * transactionGasPrice bt + transactionValue bt
      acctBalance = addressStateBalance addressState
  when (txCost > acctBalance) $ left $ TFInsufficientFunds txCost acctBalance
  when (intrinsicGas' > transactionGasLimit bt) $ left $ TFIntrinsicGasExceedsTxLimit intrinsicGas' (transactionGasLimit bt)
  when (transactionGasLimit bt > remainingBlockGas) $ left $ TFBlockGasLimitExceeded (transactionGasLimit bt) remainingBlockGas
  unless nonceValid $ left $ TFNonceMismatch (transactionNonce bt) (addressStateNonce addressState)

  let availableGas = transactionGasLimit bt - intrinsicGas'

  theAddress <-
    if isContractCreationTX bt
    then lift $ getNewAddress tAddr
    else do
      lift $ incrementNonce tAddr
      return $ transactionTo bt

  success <- lift $ addToBalance tAddr (-transactionGasLimit bt * transactionGasPrice bt)

  when flags_debug $ lift $ $logDebugS "addTx" "running code"

  if success
      then do
        (result, newVMState') <- lift $ runCodeForTransaction isRunningTests' isHomestead b (transactionGasLimit bt - intrinsicGas') tAddr theAddress t

        s1 <- lift $ addToBalance (blockDataCoinbase b) (transactionGasLimit bt * transactionGasPrice bt)
        unless s1 $ error "addToBalance failed even after a check in addBlock"

        case result of
          Left e -> do
            when flags_debug $ lift $ $logDebugS "addTx" . T.pack $ CL.red $ show e
            return
              ExecResults {
                erRemainingBlockGas=remainingBlockGas - transactionGasLimit bt,
                erReturnVal=returnVal newVMState',
                erTrace=theTrace newVMState',
                erLogs=logs newVMState',
                erNewContractAddress=
                  if isContractCreationTX bt
                  then Just theAddress
                  else Nothing
                }
              -- (newVMState'{vmException = Just e},
          Right _ -> do
            let realRefund =
                  min (refund newVMState') ((transactionGasLimit bt - vmGasRemaining newVMState') `div` 2)

            success' <- lift $ pay "VM refund fees" (blockDataCoinbase b) tAddr ((realRefund + vmGasRemaining newVMState') * transactionGasPrice bt)

            unless success' $ error "oops, refund was too much"

            when flags_debug $ lift $ logInfoN $ T.pack $ "Removing accounts in suicideList: " ++ intercalate ", " (show . pretty <$> S.toList (suicideList newVMState'))
            forM_ (S.toList $ suicideList newVMState') $ \address' -> do
              lift $ purgeStorageMap address'
              lift $ deleteAddressState address'


            return
              ExecResults {
                erRemainingBlockGas=remainingBlockGas - (transactionGasLimit bt - realRefund - vmGasRemaining newVMState'),
                erReturnVal=returnVal newVMState',
                erTrace=theTrace newVMState',
                erLogs=logs newVMState',
                erNewContractAddress=
                  if isContractCreationTX bt
                  then Just theAddress
                  else Nothing
                }
      else do
        s1 <- lift $ addToBalance (blockDataCoinbase b) (intrinsicGas' * transactionGasPrice bt)
        unless s1 $ error "addToBalance failed even after a check in addTransaction"
        addressState' <- lift $ getAddressState tAddr
        lift $ logInfoN $ T.pack $ "Insufficient funds to run the VM: need " ++ show (availableGas*transactionGasPrice bt) ++ ", have " ++ show (addressStateBalance addressState')
        return
          ExecResults{
            erRemainingBlockGas=remainingBlockGas,
            erReturnVal=Nothing,
            erTrace=error "theTrace not set",
            erLogs=[],
            erNewContractAddress=Nothing
            }

runCodeForTransaction::Bool->Bool->BlockData->Integer->Address->Address->OutputTx->ContextM (Either VMException B.ByteString, VMState)
runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr newAddress OutputTx{otBaseTx=ut} | isContractCreationTX ut = do
  when flags_debug $ logInfoN "runCodeForTransaction: ContractCreationTX"

  !(result, vmState) <-
    create isRunningTests' isHomestead S.empty b 0 tAddr tAddr (transactionValue ut) (transactionGasPrice ut) availableGas newAddress (transactionInit ut)

  return (const B.empty <$> result, vmState)

runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr owner OutputTx{otBaseTx=ut} = do --MessageTX
  when flags_debug $ logInfoN $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ show (pretty tAddr) ++ ", address: " ++ show (pretty $ transactionTo ut)

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
outputTransactionResult b OutputTx{otHash=txHash, otBaseTx=t, otSigner=tAddr} result deltaT beforeMap afterMap = do
  let
    (message, gasRemaining) =
      case result of
        Left err -> (show err, 0) -- TODO Also include the trace
        Right r  -> ("Success!", erRemainingBlockGas r)
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
        putLogDB $ LogDB txHash tAddr (topics log' `indexMaybe` 0) (topics log' `indexMaybe` 1) (topics log' `indexMaybe` 2) (topics log' `indexMaybe` 3) (logData log') (bloom log')

      _ <- putTransactionResult
             TransactionResult {
               transactionResultBlockHash=blockHeaderHash b,
               transactionResultTransactionHash=txHash,
               transactionResultMessage=message,
               transactionResultResponse=response,
               transactionResultTrace=theTrace',
               transactionResultGasUsed=gasUsed,
               transactionResultEtherUsed=etherUsed,
               transactionResultContractsCreated=intercalate "," $ map formatAddress newAddresses,
               transactionResultContractsDeleted=intercalate "," $ map formatAddress $ S.toList $ (beforeAddresses S.\\ afterAddresses) `S.union` (afterDeletes S.\\ beforeDeletes),
               transactionResultStateDiff="", --BC.unpack $ BL.toStrict $ Aeson.encode addrDiff,
               transactionResultTime=realToFrac deltaT,
               transactionResultNewStorage="",
               transactionResultDeletedStorage=""
               }
      return ()


timeIt :: MonadIO m => m a -> m (NominalDiffTime, a)
timeIt f = do
    timeBefore <- liftIO getPOSIXTime
    result <- f
    timeAfter <- liftIO getPOSIXTime
    return (timeAfter - timeBefore, result)

data BoxMode = Pre | Ok | Err deriving (Eq)

modeToColor :: BoxMode -> (String -> String)
modeToColor Pre = CL.blue
modeToColor Ok  = CL.magenta
modeToColor Err = CL.red

logWithBox :: MonadLogger m => T.Text -> Int -> [String] -> m ()
logWithBox source headerSize lines = do
    let headerAndFooter = indent ++ CL.magenta (replicate headerSize '=')
        addBorder line  = indent ++ CL.magenta "|" ++ " " ++ line ++ " " ++ CL.magenta "|"
        indent          = "    "
    $logInfoS source $ T.pack headerAndFooter
    forM_ (addBorder <$> lines) ($logInfoS source . T.pack)
    $logInfoS source $ T.pack headerAndFooter

printTransactionMessage::MonadLogger m=>
                         OutputTx->Either TransactionFailureCause ExecResults->NominalDiffTime->m ()
printTransactionMessage OutputTx{otSigner=tAddr, otBaseTx=baseTx, otHash=txHash} (Left errMsg) deltaT = do
    let tNonce = transactionNonce baseTx
    logWithBox "printTx/err" 78 [ "Adding transaction signed by: " ++ show (pretty tAddr) ++ "    "
                                , "Tx hash:  " ++ format txHash
                                , rightPad 74 ' ' $ "Tx nonce: " ++ show tNonce
                                , CL.red "Transaction failure: " ++ CL.red (show errMsg)
                                , "t = " ++ printf "%.5f" (realToFrac deltaT::Double) ++ "s                                                              "
                                ]

printTransactionMessage OutputTx{otBaseTx=t, otSigner=tAddr, otHash=txHash} (Right results) deltaT = do
    let tNonce = transactionNonce t
        txPretty = if isMessageTX t
          then "MessageTX to " ++ show (pretty $ transactionTo t) ++ "                     "
          else "Create Contract "  ++ show (pretty $ fromJust $ erNewContractAddress results) ++ "                  "
    logWithBox "printTx/ok" 78 [ "Adding transaction signed by: " ++ show (pretty tAddr) ++ "    "
                               , "Tx hash:  " ++ format txHash
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
    ContextBestBlockInfo(oldBestSha, oldBestBlock, oldBestDifficulty, oldTxCount, oldUncleCount) <- getContextBestBlockInfo

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
    -- $logInfoS "calculateAndEmitStateDiffs" . T.pack $ "Here are StateDiffs " ++ show diffs 
    when flags_sqlDiff $ commitSqlDiffs diffs
    when flags_diffPublish $
        let diffBS = BL.toStrict $ Aeson.encode diffs
         in void . withKafkaViolently $ produceBytes' "statediff" [diffBS]
