{-# LANGUAGE OverloadedStrings, FlexibleContexts, FlexibleInstances, TypeSynonymInstances, NamedFieldPuns #-}

module Blockchain.BlockChain (
  addBlock,
  addBlocks,
  addTransaction,
  addTransactions,
  runCodeForTransaction,
  calculateIntrinsicGas'
  ) where

import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.Trans
import Control.Monad.Trans.Either
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Data.Time.Clock
import Data.Time.Clock.POSIX
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>))
import Text.Printf

import qualified Data.Aeson as Aeson

import qualified Blockchain.Colors as CL
import Blockchain.Constants
import Blockchain.Data.Address
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockDB
import Blockchain.Data.BlockSummary
import Blockchain.Data.Code
import Blockchain.Data.DataDefs
import Blockchain.Data.DiffDB
import Blockchain.Data.ExecResults
import Blockchain.Data.Extra
import Blockchain.Data.Log
import Blockchain.Data.LogDB
import Blockchain.Data.StateDiff hiding (StateDiff(blockHash))
import Blockchain.Data.Transaction
import Blockchain.Data.TransactionResult
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.DB.AddressStateDB as NoCache
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.ModifyStateDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.Stream.UnminedBlock
import Blockchain.Stream.Raw
import Blockchain.Sequencer.Event
import Blockchain.TheDAOFork
import Blockchain.VMContext
import Blockchain.VMOptions
import Blockchain.Verifier
import Blockchain.VM
import Blockchain.VM.Code
import Blockchain.VM.OpcodePrices
import Blockchain.VM.VMState

import qualified Control.Monad.State as State
import qualified Blockchain.Bagger as Bagger

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

    rewardCoinbases sr us uncles = do
        startingStateRoot <- getStateRoot
        setStateDBStateRoot sr
        addToBalance us $ rewardBase flags_testnet
        -- todo dont be a ~rude individual~ and actually reward uncles
        --forM_ uncles $ \uncleCB -> addToBalance us $ rewardBase flags_testnet
        flushMemStorageDB
        flushMemAddressStateDB
        newStateRoot <- getStateRoot
        setStateDBStateRoot startingStateRoot
        return newStateRoot

timeit::(MonadIO m, MonadLogger m)=>String->m a->m a
timeit message f = do
  before <- liftIO $ getPOSIXTime 
  ret <- f
  after <- liftIO $ getPOSIXTime 
  logInfoN $ T.pack $ "#### " ++ message ++ " time = " ++ printf "%.4f" (realToFrac $ after - before::Double) ++ "s"
  return ret

addBlocks::Bool->[OutputBlock]->ContextM ()
addBlocks _ [] = return ()
addBlocks isUnmined blocks = do
  logInfoN . T.pack $ "Inserting " ++ (show . length $ blocks ) 
                                   ++ " block starting with " 
                                   ++ (show . blockDataNumber . obBlockData . head $ blocks)

  let blocks' = filter ((/= 0) . blockDataNumber . obBlockData) blocks
  _ <- forM blocks' $ timeit "Block insertion" . addBlock isUnmined 

  logInfoN "done inserting, now will replace best if best is among the list"

  when (not isUnmined) $ do
    let highestDifficulty = maximum $ map (blockDataDifficulty . obBlockData) blocks' --maximum OK, since I filtered out the empty list case in a funciton pattern match
    replaceBestIfBetter $ fromJust $ find ((highestDifficulty ==) . blockDataDifficulty . obBlockData) blocks' --fromJust is OK, because we just got this value from the list

{-
  when (not isUnmined) $ 
    replaceBestIfBetter $ last blocks --last is OK, because we filter out blocks=[] in the case
-}



setTitle::String->IO()
setTitle value = do
  putStr $ "\ESC]0;" ++ value ++ "\007"


addBlock::Bool->OutputBlock->ContextM () -- change Block to OutputBlock
addBlock isUnmined b@OutputBlock{obBlockData=bd, obReceiptTransactions = transactions, obBlockUncles=uncles} = do
--  when (blockDataNumber bd > 100000) $ error "you have hit 100,000"
--  liftIO $ putStrLn $ "in addBlock with parentHash: " ++ (format . blockDataParentHash $ bd)

  bSum <- getBSum $ blockDataParentHash bd
  liftIO $ setTitle $ "Block #" ++ show (blockDataNumber bd)
  logInfoN $ T.pack $ "Inserting block #" ++ show (blockDataNumber bd) ++ " (" ++ format (outputBlockHash b) ++ ")."
  setStateDBStateRoot $ bSumStateRoot bSum

  when (blockDataNumber bd == 1920000) $ runTheDAOFork
  

  s1 <- addToBalance (blockDataCoinbase bd) $ rewardBase flags_testnet
  when (not s1) $ error "addToBalance failed even after a check in addBlock"

  forM_ uncles $ \uncle -> do
    s2 <- addToBalance (blockDataCoinbase bd) (rewardBase flags_testnet `quot` 32)
    when (not s2) $ error "addToBalance failed even after a check in addBlock"
        
    s3 <- addToBalance
          (blockDataCoinbase uncle)
          ((rewardBase flags_testnet * (8+blockDataNumber uncle - blockDataNumber bd )) `quot` 8)
    when (not s3) $ error "addToBalance failed even after a check in addBlock"

  _ <- addTransactions isUnmined bd (blockDataGasLimit $ obBlockData b) transactions

      --when flags_debug $ liftIO $ putStrLn $ "Removing accounts in suicideList: " ++ intercalate ", " (show . pretty <$> S.toList fullSuicideList)
      --forM_ (S.toList fullSuicideList) deleteAddressState

  flushMemStorageDB
  flushMemAddressStateDB

  db <- getStateDB

  b' <-
    if isUnmined
    then do
      logInfoN "Note: block is partial, instead of doing a stateRoot check, I will fill in the stateroot"
      let newBlockData = (obBlockData b){blockDataStateRoot=MP.stateRoot db}
          newBlock = b{obBlockData = newBlockData}
      produceUnminedBlocks [(outputBlockToBlock newBlock)]
      logInfoN "stateRoot has been filled in"
      return newBlock
    else do
      when ((blockDataStateRoot (obBlockData b) /= MP.stateRoot db)) $ do
        logInfoN $ T.pack $ "newStateRoot: " ++ format (MP.stateRoot db)
        error $ "stateRoot mismatch!!  New stateRoot doesn't match block stateRoot: " ++ format (blockDataStateRoot $ obBlockData b)
      return b

  valid <- checkValidity isUnmined (blockIsHomestead $ blockDataNumber bd) bSum b'
  case valid of
    Right () -> return ()
    Left err -> error err

  logInfoN $ T.pack $ "Inserted block became #" ++ show (blockDataNumber $ obBlockData b') ++ " (" ++ format (outputBlockHash b') ++ ")."

  return ()

addTransactions::Bool->BlockData->Integer->[OutputTx]->ContextM Integer
addTransactions _ _ remGas [] = return remGas
addTransactions isUnmined b blockGas (t:rest) = do
  beforeMap <- getAddressStateDBMap
  (deltaT, result) <- timeIt $ runEitherT $ addTransaction False b blockGas t
  afterMap <- getAddressStateDBMap
  
  printTransactionMessage t result deltaT

  unless isUnmined $
    outputTransactionResult b t result deltaT beforeMap afterMap

  let remainingBlockGas =
        case result of
         Left _ -> blockGas
         Right execResult -> erRemainingBlockGas execResult

  addTransactions isUnmined b remainingBlockGas rest

mineTransactions' :: BlockData -> Integer -> [OutputTx] -> [OutputTx] -> ContextM (Either TransactionFailureCause (), [OutputTx], [OutputTx], Integer)
mineTransactions' _ remGas ran [] = return $ (Right (), reverse ran, [], remGas)
mineTransactions' header remGas ran unran@(tx:txs) = do
    (time, result) <- timeIt . runEitherT $ addTransaction False header remGas tx
    printTransactionMessage tx result time
    case result of
        Left f@(TFBlockGasLimitExceeded need have) -> return $ (Left f, reverse ran, unran, have)
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
      logInfoN $ T.pack $ "bytes cost: " ++ show (gTXDATAZERO * (fromIntegral $ zeroBytesLength t) + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - (fromIntegral $ zeroBytesLength t)))
      logInfoN $ T.pack $ "transaction cost: " ++ show gTX
      logInfoN $ T.pack $ "intrinsicGas: " ++ show (intrinsicGas')

  addressState <- lift $ getAddressState tAddr

  let txCost      = transactionGasLimit bt * transactionGasPrice bt + transactionValue bt
      acctBalance = addressStateBalance addressState
  when (txCost > acctBalance) $ left $ TFInsufficientFunds txCost acctBalance
  when (intrinsicGas' > transactionGasLimit bt) $ left $ TFIntrinsicGasExceedsTxLimit intrinsicGas' (transactionGasLimit bt)
  when (transactionGasLimit bt > remainingBlockGas) $ left $ TFBlockGasLimitExceeded (transactionGasLimit bt) remainingBlockGas
  when (not nonceValid) $ left $ TFNonceMismatch (transactionNonce bt) (addressStateNonce addressState)

  let availableGas = transactionGasLimit bt - intrinsicGas'

  theAddress <-
    if isContractCreationTX bt
    then lift $ getNewAddress tAddr
    else do
      lift $ incrementNonce tAddr
      return $ transactionTo bt
  
  success <- lift $ addToBalance tAddr (-transactionGasLimit bt * transactionGasPrice bt)

  when flags_debug $ lift $ logInfoN "running code"

  if success
      then do
        (result, newVMState') <- lift $ runCodeForTransaction isRunningTests' isHomestead b (transactionGasLimit bt - intrinsicGas') tAddr theAddress t

        s1 <- lift $ addToBalance (blockDataCoinbase b) (transactionGasLimit bt * transactionGasPrice bt)
        when (not s1) $ error "addToBalance failed even after a check in addBlock"
        
        case result of
          Left e -> do
            when flags_debug $ lift $ logInfoN $ T.pack $ CL.red $ show e
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

            when (not success') $ error "oops, refund was too much"

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
        when (not s1) $ error "addToBalance failed even after a check in addTransaction"
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

  (result, vmState) <-
    create isRunningTests' isHomestead S.empty b 0 tAddr tAddr (transactionValue ut) (transactionGasPrice ut) availableGas newAddress (transactionInit ut)

  return (const B.empty <$> result, vmState)

runCodeForTransaction isRunningTests' isHomestead b availableGas tAddr owner OutputTx{otBaseTx=ut} = do --MessageTX
  when flags_debug $ logInfoN $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ show (pretty $ tAddr) ++ ", address: " ++ show (pretty $ transactionTo ut)

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
intrinsicGas isHomestead t@OutputTx{otBaseTx=bt} = gTXDATAZERO * zeroLen + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - zeroLen) + (txCost bt)
    where
      zeroLen = fromIntegral $ zeroBytesLength t
      txCost t' | isMessageTX t' = gTX
      txCost _ = if isHomestead then gCREATETX else gTX

--outputTransactionMessage::IO ()
outputTransactionResult::BlockData->OutputTx->Either TransactionFailureCause ExecResults->NominalDiffTime->
                         M.Map Address AddressStateModification->M.Map Address AddressStateModification->ContextM ()
outputTransactionResult b OutputTx{otHash=txHash, otBaseTx=t, otSigner=tAddr} result deltaT beforeMap afterMap = do
  let 
    (message, gasRemaining) =
      case result of 
        Left err -> (show err, 0) -- TODO Also include the trace
        Right r -> ("Success!", erRemainingBlockGas r)
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

      forM_ theLogs $ \log' -> do
        putLogDB $ LogDB txHash tAddr (topics log' `indexMaybe` 0) (topics log' `indexMaybe` 1) (topics log' `indexMaybe` 2) (topics log' `indexMaybe` 3) (logData log') (bloom log')
                                   
      _ <- putTransactionResult $
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
               transactionResultTime=realToFrac $ deltaT,
               transactionResultNewStorage="",
               transactionResultDeletedStorage=""
               } 
      return ()


timeIt::MonadIO m=>m a->m (NominalDiffTime, a)
timeIt f = do
  timeBefore <- liftIO $ getPOSIXTime 

  result <- f

  timeAfter <- liftIO $ getPOSIXTime 

  return (timeAfter - timeBefore, result)


printTransactionMessage::MonadLogger m=>
                         OutputTx->Either TransactionFailureCause ExecResults->NominalDiffTime->m ()
printTransactionMessage OutputTx{otSigner=tAddr, otBaseTx=baseTx} (Left errMsg) deltaT = do
  let tNonce = transactionNonce baseTx
  logInfoN $ T.pack $ CL.magenta "    ============================================================================="
  logInfoN $ T.pack $ CL.magenta "    | Adding transaction signed by: " ++ show (pretty tAddr) ++ CL.magenta " //  " ++ (show tNonce) ++" |"
  logInfoN $ T.pack $ CL.magenta "    | " ++ CL.red "Transaction failure: " ++ CL.red (show errMsg) ++ CL.magenta "         |"
  logInfoN $ T.pack $ CL.magenta "    |" ++ " t = " ++ printf "%.2f" (realToFrac $ deltaT::Double) ++ "s                                                              " ++ CL.magenta "|"
  logInfoN $ T.pack $ CL.magenta "    =========================================================================="

printTransactionMessage OutputTx{otBaseTx=t, otSigner=tAddr} (Right results) deltaT = do
  let tNonce = transactionNonce t
  logInfoN $ T.pack $ CL.magenta "    =========================================================================="
  logInfoN $ T.pack $ CL.magenta "    | Adding transaction signed by: " ++ show (pretty tAddr) ++ CL.magenta " //  " ++ (show tNonce) ++" |"
  logInfoN $ T.pack $ CL.magenta "    |    " ++
    (
      if isMessageTX t
      then "MessageTX to " ++ show (pretty $ transactionTo t) ++ "              "
      else "Create Contract "  ++ show (pretty $ fromJust $ erNewContractAddress results)
    ) ++ CL.magenta " |"

  logInfoN $ T.pack $ CL.magenta "    |" ++ " t = " ++ printf "%.2f" (realToFrac $ deltaT::Double) ++ "s                                                              " ++ CL.magenta "|"
  logInfoN $ T.pack $ CL.magenta "    =========================================================================="

  return ()


indexMaybe::[a]->Int->Maybe a
indexMaybe _ i | i < 0 = error "indexMaybe called for i < 0"
indexMaybe [] _ = Nothing
indexMaybe (x:_) 0 = Just x
indexMaybe (_:rest) i = indexMaybe rest (i-1)



formatAddress::Address->String
formatAddress (Address x) = BC.unpack $ B16.encode $ B.pack $ word160ToBytes x

----------------

replaceBestIfBetter::OutputBlock->ContextM ()
replaceBestIfBetter b@OutputBlock{obBlockData = bd} = do
  (_, oldBestBlock) <- getBestBlockInfo

  let newNumber    = blockDataNumber bd
      newStateRoot = blockDataStateRoot bd
      oldStateRoot = blockDataStateRoot oldBestBlock
      bH           = outputBlockHash b

  logInfoN $ T.pack $ "newNumber = " ++ show newNumber ++ ", oldBestNumber = " ++ show (blockDataNumber oldBestBlock)

  when (newNumber > blockDataNumber oldBestBlock || newNumber == 0) $ do
    Bagger.processNewBestBlock bH bd
    diffs <- stateDiff newNumber bH oldStateRoot newStateRoot

    when flags_sqlDiff $ do
      commitSqlDiffs diffs
      putBestBlockInfo bH (obBlockData b)

    when flags_diffPublish $ do
      let diffBS = BL.toStrict $ Aeson.encode diffs
      --logInfoN $ T.decodeUtf8 diffBS
      produceBytes "statediff" [diffBS]

