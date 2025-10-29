{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE NamedFieldPuns #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}

{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.BlockChain
  ( addBlocks,
    verifyBlock,
    mineTransactions,
--    calculateIntrinsicGas',
  )
where

import BlockApps.Logging
import qualified Blockchain.Bagger as Bagger
import Blockchain.Bagger.Transactions
import qualified Blockchain.DB.AddressStateDB as NoCache
import qualified Blockchain.DB.BlockSummaryDB as BSDB
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.ModifyStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.DataDefs
import Blockchain.Data.ExecResults
import Blockchain.Data.Log
import Blockchain.Data.Transaction
import Blockchain.Data.TransactionResultStatus
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.StateDB
import Blockchain.Event
import Blockchain.Model.WrappedBlock
import qualified Blockchain.SolidVM as SolidVM
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Delta
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Options (computeNetworkID)
import qualified Blockchain.Strato.StateDiff as SD
import Blockchain.Stream.Action hiding (blockHash)
import qualified Blockchain.Stream.Action as Action
import Blockchain.Stream.VMEvent
import Blockchain.TheDAOFork
import Blockchain.Timing
import Blockchain.VM.SolidException (SolidException(PaymentError, TooMuchGas))
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.VMOptions
import Blockchain.Verifier
import Conduit
import Control.Applicative ((<|>))
import Control.Lens hiding (filtered)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base ()
import Control.Monad.Trans.Except
import qualified Control.Monad.Trans.State.Strict as State
import qualified Data.Binary as Bin
import Data.Bool (bool)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.DList as DL
import Data.List
import Data.Map (Map)
import qualified Data.Map as M
import qualified Data.Map.Ordered as O
import Data.Maybe
import Data.Proxy
import qualified Data.Sequence as Seq
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Time.Clock
import Prometheus as P
import SolidVM.Model.CodeCollection hiding (Event, Block, events, _events)
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.ShortDescription
import Text.Tools
import UnliftIO.IORef

instance (Monad m, Mod.Accessible a m) => Mod.Accessible a (ConduitT i o m) where
  access = lift . Mod.access

instance Mod.Modifiable a m => Mod.Modifiable a (ConduitT i o m) where
  get = lift . Mod.get
  put p = lift . Mod.put p

instance A.Selectable k v m => A.Selectable k v (ConduitT i o m) where
  select p k = lift $ A.select p k
  selectMany p ks = lift $ A.selectMany p ks
  selectWithDefault p k = lift $ A.selectWithDefault p k

instance (k `A.Alters` v) m => (k `A.Alters` v) (ConduitT i o m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k
  lookupWithDefault p k = lift $ A.lookupWithDefault p k

instance (Monad m, HasMemAddressStateDB m) => HasMemAddressStateDB (ConduitT i o m) where
  getAddressStateTxDBMap = lift getAddressStateTxDBMap
  putAddressStateTxDBMap = lift . putAddressStateTxDBMap
  getAddressStateBlockDBMap = lift getAddressStateBlockDBMap
  putAddressStateBlockDBMap = lift . putAddressStateBlockDBMap

instance (HasMemRawStorageDB m) => HasMemRawStorageDB (ConduitT i o m) where
  getMemRawStorageTxDB = lift getMemRawStorageTxDB
  putMemRawStorageTxMap = lift . putMemRawStorageTxMap
  getMemRawStorageBlockDB = lift getMemRawStorageBlockDB
  putMemRawStorageBlockMap = lift . putMemRawStorageBlockMap

-- todo: lovely!

addBlocks :: (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) => [OutputBlock] -> ConduitT a VmOutEvent m ()
addBlocks unfiltered = do
  let filtered = filter ((/= 0) . number . obBlockData) unfiltered
      timerToUse = Just vmBlockInsertionMined
  unless (null unfiltered) $ yieldMany $ OutIndexEvent . RanBlock <$> unfiltered
  bbi <- getContextBestBlockInfo
  $logInfoS "addBlocks" $ T.pack ("Unfiltered count: " ++ show (length unfiltered))
  $logInfoS "addBlocks" $ T.pack ("Filtered count: " ++ show (length filtered))
  case (filtered, bbi) of
    ([], _) -> return ()
    (_, Unspecified) -> return ()
    (firstBlock : _, ContextBestBlockInfo _ oldHeader _) -> do
      $logInfoS "addBlocks" $
        T.pack
          ( "Inserting " ++ show (length filtered) ++ " blocks(s) starting with "
              ++ (show . number . obBlockData $ firstBlock)
          )
      didReplaceBest <- newIORef False
      replacedBest <- newIORef (error "addBlocks.replacedBest: evaluating uninitialized BestBlockInfo!")
      let go block = do
            let !blockNo = number $ obBlockData block
                !txCount = length $ obReceiptTransactions block
            timeit (printf "Block #%d (%d TXs insertion)" blockNo txCount) timerToUse $ do
              failures <- lift $ addBlock block
              when (null failures) $ do
                (didReplaceThisTime, replacedBits@(hsh, num)) <- lift . lift $ replaceBestIfBetter block
                when didReplaceThisTime $ do
                  writeIORef didReplaceBest True
                  writeIORef replacedBest replacedBits
                  -- Gather a chain of better block stateroots. The last one found should be the best block,
                  -- and the intermediate ones increase the granularity at which we can compute a sequence
                  -- of diffs. The number of blocks to skip between stateroots is determined by the cost of
                  -- the diff between them, which is estimated by the number of transactions.
                  State.put $! Just (stateRoot $ obBlockData block, hsh, num)
              pure failures
          loop [] = pure []
          loop (b:bs) = go b >>= \case
            [] -> loop bs
            failures -> pure failures
      (failures, srLog) <- flip State.runStateT Nothing $ loop filtered
      case failures of
        (_:_) -> yield $ OutBlockVerificationFailure failures
        _ -> do
          $logDebugLS "addBlocks/srLog" srLog
          didReplaceBest' <- readIORef didReplaceBest
          when didReplaceBest' $ do
            $logInfoS "addBlocks" "done inserting, now will emit stateDiff if necessary"
            nbb <- readIORef replacedBest
            when flags_sqlDiff $
              timeit "calculateAndEmitStateDiffs" timerToUse $
                calculateAndEmitStateDiffs srLog oldHeader
            yield . OutIndexEvent $ NewBestBlock nbb

setParentStateRoot ::
  (MonadFail m, MonadIO m, BSDB.HasBlockSummaryDB m) =>
  OutputBlock ->
  m BlockSummary
setParentStateRoot OutputBlock {..} = do
  liftIO $ setTitle $ "Block #" ++ show (number obBlockData)
  BSDB.getBSum (parentHash obBlockData)

addBlock :: (MonadFail m, Bagger.MonadBagger m, MonadMonitor m) => OutputBlock -> ConduitT a VmOutEvent m [BlockVerificationFailure]
addBlock b@OutputBlock {obBlockData = bd, obReceiptTransactions = otxs} =
  let obh = outputBlockHash b
   in withCurrentBlockHash obh $ do
        $logInfoS "addBlocks" . T.pack $
          "Inserting Block #"
            ++ show (number . obBlockData $ b)
            ++ " ("
            ++ format obh
            ++ ", "
            ++ show (length otxs)
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
        -- TODO: PLEASE REMOVE THIS FORK WHEN MERCATA-HYDROGEN IS OBSOLETE
        when (computeNetworkID == 7596898649924658542 && number bd == 32624) runTheDAOFork -- Only run this if connected to mercata-hydrogen

        let pHash = proposalHash bd
            mSig = getProposerSeal bd  -- Signature is Maybe type
        proposer <- case mSig of
                        Just sig -> do
                            let (r, s, v) = getSigVals sig
                                proposerAddress = whoReallySignedThisTransactionEcrecover pHash r s (v - 0x1b)
                            case proposerAddress of
                              Just addr ->  return addr
                              Nothing -> error "no proposer"
                        Nothing -> error "no proposer"

        trrs <- addBlockTransactions b proposer

        postRewardSR <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
        verifyBlockResult <- verifyBlock (outputBlockToBlock b) (trrs, postRewardSR) bSum
        case verifyBlockResult of 
          failures@(_:_) -> do
            lift $ P.incCounter vmBlocksInvalid
            pure $ map (\r -> BlockVerificationFailure (bSumNumber bSum) (bSumParentHash bSum) r) failures
          _ -> do
            when flags_debug $ do
              bhr'' <- Mod.get (Proxy @BlockHashRoot)
              $logDebugS "addBlock" $ T.pack $ "New blockhash root after running block: " ++ format bhr''
              mcr'' <- getChainRoot $ blockHash b
              case mcr'' of
                Nothing -> $logDebugS "addBlock" $ T.pack $ "Could not locate new chain root after running block. Using emptyTriePtr"
                Just cr -> $logDebugS "addBlock" $ T.pack $ "New chain root after running block: " ++ format cr

            lift $ P.incCounter vmBlocksValid
            lift $ P.incCounter vmBlocksMined
            lift $ P.incCounter vmBlocksProcessed
            $logInfoS "addBlock" . T.pack $ "Inserted block became #" ++ show (number $ obBlockData b) ++ " (" ++ format obh ++ ")."
            pure []

-- TODO: If we add more verifications, refactor tuple into a proper data type
verifyBlock :: 
  HasStateDB m =>
  Block -> 
  ([TxRunResult], Maybe MP.StateRoot) -> 
  BlockSummary ->
  m [BlockVerificationFailureDetails]
verifyBlock b@Block{blockBlockData = bh} (trrs, derivedSR) parentBSum = do
  validity <- checkValidity parentBSum b
  let vDelt = getDeltasFromResults trrs
      blockSR = Just $ stateRoot bh
      bVd = toDelta (newValidators bh) (removedValidators bh)
      srCheck =  if derivedSR == blockSR
        then Nothing
        else Just . StateRootMismatch $
               BlockDelta (stateRoot bh)
                          (fromMaybe MP.emptyTriePtr derivedSR)
      validatorCheck = if eqDelta bVd vDelt
        then Nothing
        else Just . ValidatorMismatch $ BlockDelta (fromDelta bVd) (fromDelta vDelt)
   in return $ validity ++ case blockHeaderVersion bh of
        1 -> catMaybes [srCheck]
        2 -> catMaybes [srCheck, validatorCheck]
        v -> [VersionMismatch $ BlockDelta v 2]

addBlockTransactions :: (Bagger.MonadBagger m, MonadMonitor m) => OutputBlock -> Address -> ConduitT a VmOutEvent m [TxRunResult]
addBlockTransactions b@OutputBlock {obBlockData = bd, obReceiptTransactions = transactions} proposer = do
  $logDebugS "addBlockTransactions" . T.pack $ "All transactions: " ++ show transactions
  trrs <- addTransactions bd transactions proposer

  flushMemStorageTxDBToBlockDB

  sendNewActionMessage b trrs
  
  lift $ timeit "flushMemStorageDB" (Just vmBlockInsertionMined) flushMemStorageDB
  flushMemAddressStateTxToBlockDB
  flushMemAddressStateTxToBlockDB
  lift $ timeit "flushMemAddressStateDB" (Just vmBlockInsertionMined) flushMemAddressStateDB
  pure trrs

sendNewActionMessage :: (HasMemRawStorageDB m, MonadIO m) =>
                        OutputBlock -> [TxRunResult] -> m ()
sendNewActionMessage b trrs = do
  let bd = obBlockData b
  theMap <- getMemRawStorageBlockDB

  let recombined :: Map Address ActionData
      recombined =
        fmap (ActionData . SolidVMDiff)
        $ M.fromListWith M.union
        [ (addr, M.singleton path val)
        | ((addr, path), val) <- M.toList theMap
        ]

      action :: Action
      action = Action {
        _blockHash=blockHash b,
        _blockTimestamp=blockHeaderTimestamp bd,
        _blockNumber=blockHeaderBlockNumber bd,
        _transactionHash=emptyHash,
        _transactionSender=0x0,
        _actionData=O.fromList $ M.toList recombined,
        _src=Nothing,
        _name=Nothing,
        _newCodeCollections=[],
        _events=Seq.fromList $ concat $ map (either (const []) erEvents . trrResult) trrs,
        _delegatecalls=mconcat $ map (either (const Seq.empty) (fromMaybe Seq.empty . fmap _delegatecalls . erAction) . trrResult) trrs
        }

  _ <- produceVMEvents $ [NewAction action]

  return ()



addTransactions ::
  (VMBase m, MonadMonitor m) =>
  BlockHeader ->
  [OutputTx] ->
  Address ->
  ConduitT a VmOutEvent m [TxRunResult]
addTransactions blockData txs proposer =
  timeit ("addTransactions, " ++ show (length txs) ++ " TXs") (Just vmBlockInsertionMined) $ do
    trrs <- lift $ go (getBlockGasLimit blockData) txs DL.empty
    mapM_ (outputTransactionResult blockData blockHeaderHash) trrs
    yield . OutASM $ foldr (flip M.union) M.empty $ map trrAfterMap trrs
    pure trrs
  where
    go :: (VMBase m, MonadMonitor m) =>
          Integer -> [OutputTx] -> DL.DList TxRunResult -> m [TxRunResult]
    go _ [] trrs = return $ DL.toList trrs
    go blockGas (t : rest) trrs = do
      let bt = otBaseTx t
      beforeMap <- getAddressStateTxDBMap
      flushMemAddressStateTxToBlockDB
      flushMemStorageTxDBToBlockDB

      (!deltaT, !result) <- timeIt $ runExceptT $ addTransaction blockData blockGas t proposer

      afterMap <- getAddressStateTxDBMap

      printTransactionMessage t result deltaT
      P.setGauge vmTxMined (realToFrac deltaT)

      trr <- setNewAddresses $ TxRunResult t result deltaT beforeMap afterMap []

      let remainingBlockGas =
            case result of
              Left _ -> blockGas
              Right execResult -> blockGas - (transactionGasLimit bt - calculateReturned bt execResult)

      go remainingBlockGas rest (trrs `DL.snoc` trr)

mineTransactions :: (VMBase m, MonadMonitor m) => Bagger.MineTransactions m
mineTransactions bd remGas otxs mSelfAddress = mineTransactions' bd remGas DL.empty otxs mSelfAddress

mineTransactions' :: (VMBase m, MonadMonitor m) => BlockHeader -> Integer -> DL.DList TxRunResult -> [OutputTx] -> Address-> m Bagger.TxMiningResult
mineTransactions' _ remGas ran [] _ = return $ Bagger.TxMiningResult Nothing (DL.toList ran) [] remGas
mineTransactions' header remGas ran unran@(tx : txs) mSelfAddress = do
  let bt = otBaseTx tx
  beforeMap <- getAddressStateTxDBMap
  (!time', !result) <- timeIt . runExceptT $ addTransaction header remGas tx mSelfAddress
  afterMap <- getAddressStateTxDBMap
  P.setGauge vmTxMining (realToFrac time')
  printTransactionMessage tx result time'
  trr <- setNewAddresses $ TxRunResult tx result time' beforeMap afterMap []
  case result of
    Right execResult ->
      let invalidPragmas = invalidPragmasUsed $ erPragmas execResult
       in if not $ null invalidPragmas
            then do
              putAddressStateTxDBMap M.empty
              putMemRawStorageTxMap M.empty
              return $ Bagger.TxMiningResult (Just $ TFInvalidPragma invalidPragmas tx) (DL.toList ran) unran remGas -- use invalidPragmasUsed here
            else do 
              case erException execResult of
                Just (Left (TooMuchGas limit actual)) -> do
                  putAddressStateTxDBMap M.empty
                  putMemRawStorageTxMap M.empty
                  return $ Bagger.TxMiningResult (Just $ TFTransactionGasExceeded limit actual tx) (DL.toList ran) unran remGas
                Just (Left (PaymentError limit (_, actual))) -> do
                  putAddressStateTxDBMap M.empty
                  putMemRawStorageTxMap M.empty
                  return $ Bagger.TxMiningResult (Just $ TFInsufficientFunds limit actual tx) (DL.toList ran) unran remGas
                _ -> do
                  let nextRemGas = remGas - (transactionGasLimit bt - calculateReturned bt execResult)
                  flushMemAddressStateTxToBlockDB
                  flushMemStorageTxDBToBlockDB
                  mineTransactions' header nextRemGas (ran `DL.snoc` trr) txs mSelfAddress
    Left failure -> do
      return $ Bagger.TxMiningResult (Just failure) (DL.toList ran) unran remGas

addTransaction ::
  (VMBase m, MonadMonitor m) =>
  BlockHeader ->
  Integer ->
  OutputTx ->
  Address -> 
  ExceptT TransactionFailureCause m ExecResults
addTransaction b remainingBlockGas t@OutputTx {otSigner = tAddr} proposer = do
  nonceValid <- lift $ isNonceValid t

  let bt = otBaseTx t
  let maxGas = fromIntegral (maxBound :: Int)
  acctNonce <- lift $ addressStateNonce <$> A.lookupWithDefault (Proxy @AddressState) tAddr

  when (transactionGasLimit bt > min remainingBlockGas maxGas) $ throwE $ TFBlockGasLimitExceeded (transactionGasLimit bt) remainingBlockGas t
  unless nonceValid $ throwE $ TFNonceMismatch (transactionNonce bt) acctNonce t
  let txSize = toInteger $ B.length $ BL.toStrict $ Bin.encode $ otBaseTx t
  when (txSize >= toInteger flags_txSizeLimit)
    . throwE
    $ TFTXSizeLimitExceeded txSize (toInteger flags_txSizeLimit) t

  let isKnownToBeSlow = otHash t `S.member` knownExpensiveTxs
      adjustedTxGasLimit = bool (transactionGasLimit bt) (flags_strictGasLimit) (flags_strictGas && not isKnownToBeSlow)
      availableGas = fromInteger adjustedTxGasLimit

  feeResult <- payFees b availableGas tAddr t proposer
  let combineA f x y = liftA2 f x y <|> x <|> y
      attachFeeResult er = er
        { erAction = combineA (\era ->
              (actionData %~ (O.unionWithL (const $ flip mergeActionDataStorageDiffs) $ _actionData era))
            . (events %~ (_events era Seq.><))
          ) (erAction feeResult) $ erAction er
        , erTrace = erTrace feeResult ++ erTrace er
        , erLogs = erLogs feeResult ++ erLogs er
        , erEvents = erEvents feeResult ++ erEvents er
        }

  if (erException feeResult == Nothing) || (erReturnVal feeResult == Just "(true)")
    then do
      $logInfoS "runCodeForTransaction" "decide() function successful, running TX"

      lift $ incrementNonce tAddr

      when (otHash t `S.member` knownFailedTxs) $ do
        throwE $ TFKnownFailedTX t

      $logInfoS "addTx" . T.pack $ "gas is always off, so I'm giving the account enough balance for this TX"
      faucetSuccess <- lift $ addToBalance tAddr 10000000 -- txCost
      unless faucetSuccess $ error "failed to give balance to a gasOff account"

      when flags_debug $ $logDebugS "addTx" "running code"
      let txTypeCounter = if isContractCreationTX bt then vmTxsCreation else vmTxsCall
      lift $ P.incCounter txTypeCounter
      when flags_strictGas $ $logInfoS "addTx" . T.pack $ "Strict Gas Mode is on. Adjusted transaction gas limit is " ++ show adjustedTxGasLimit

      execResults <- runCodeForTransaction b availableGas tAddr t proposer
      lift $ P.incCounter vmTxsProcessed

      case erException execResults of
        Just e -> do
          when flags_debug $ $logDebugS "addTx" . T.pack . CL.red $ show e
          lift $ P.incCounter vmTxsUnsuccessful
        Nothing -> do
          when flags_debug $ $logDebugS "addTx" . T.pack $ "Removing accounts in suicideList: " ++ intercalate ", " (format <$> S.toList (erSuicideList execResults))
          forM_ (S.toList $ erSuicideList execResults) $ \address' -> do
            lift $ purgeStorageMap address'
            lift $ A.delete (Proxy @AddressState) address'
          lift $ P.incCounter vmTxsSuccessful
      return $ attachFeeResult execResults
    else case erException feeResult of
      Just (Left PaymentError{}) -> pure feeResult
      _ -> pure $ feeResult{ erException = Just . Left $ PaymentError 10_000_000_000_000_000 (show tAddr, 0) } -- TODO: Make Fee contract throw a PaymentError and remove this case

runCodeForTransaction ::
  (VMBase m) =>
  BlockHeader ->
  Gas ->
  Address ->
  OutputTx ->
  Address ->
  ExceptT TransactionFailureCause m ExecResults
runCodeForTransaction b availableGas tAddr t proposer =
  let ut = otBaseTx t
   in if isContractCreationTX ut
        then do
          when flags_debug $ $logInfoS "runCodeForTransaction" "runCodeForTransaction: ContractCreationTX"

          --TODO- The new address state should be created in the VM itself....  Currently the EVM doesn't do this (and could be cleaned up by doing so), SolidVM does do this.  I will calculate this value here, but then ignore the value in SolidVM (and recalculate it there).  Eventually this should be moved into the EVM also
          nonce <- lift $ addressStateNonce <$> A.lookupWithDefault (Proxy @AddressState) tAddr
          let newAddress = getNewAddress_unsafe (tAddr) (nonce - 1) --nonce has already been incremented, so subtract 1 here to get the proper value (this is directly specified in the yellowpaper)

          lift $
            SolidVM.create
              b
              tAddr
              tAddr
              proposer
              availableGas
              newAddress
              (transactionCode ut)
              (txHash ut)
              (fromJust $ txContractName ut)
              (txArgs ut)
        else do
          when flags_debug $ $logInfoS "runCodeForTransaction" $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ format tAddr ++ ", address: " ++ format (transactionTo ut)

          lift $
            SolidVM.call
                  b -- blockData
                  (transactionTo ut) -- codeAddress
                  tAddr -- sender
                  proposer -- proposer
                  (fromIntegral availableGas) -- availableGas
                  tAddr -- origin
                  (txHash ut) -- txHash
                  (transactionFuncName ut)
                  (transactionArgs ut)
                  Nothing

payFees ::
  VMBase m =>
  BlockHeader ->
  Gas ->
  Address ->
  OutputTx ->
  Address ->
  ExceptT TransactionFailureCause m ExecResults
payFees b availableGas tAddr t proposer = do
  -- BEGIN: Custom Validation Check
  -- Call validation contract at 0xDEC1DE. Require it returns True.

  lift $
    SolidVM.call
      b  -- blockData
      (Address 0xDEC1DE)  --codeAddress
      tAddr -- sender
      proposer  --proposer
      (fromIntegral availableGas) --availableGas
      tAddr -- origin
      (txHash $ otBaseTx t) -- txHash
      "decide"
      []
      (Just DelegateCall)

----------------
{-
codeOrDataLength :: OutputTx -> Int
codeOrDataLength t =
  let bt = otBaseTx t
   in if isMessageTX bt
        then B.length $ transactionData bt
        else codeLength $ transactionInit bt --is ContractCreationTX

codeLength :: Code -> Int
codeLength (Code bytes) = B.length bytes
codeLength (PtrToCode _) = 20

zeroBytesLength :: OutputTx -> Int
zeroBytesLength t =
  let bt = otBaseTx t
   in if isMessageTX bt
        then length $ filter (== 0) $ B.unpack $ transactionData bt
        else length $ filter (== 0) $ B.unpack $ codeBytes' bt --is ContractCreationTX
  where
    codeBytes' bt = case transactionCode bt of
      Code cb -> cb
      PtrToCode _ -> "" -- TODO: lookup code?

calculateIntrinsicGas' :: Integer -> OutputTx -> Gas
calculateIntrinsicGas' blockNum = intrinsicGas (blockIsHomestead blockNum)

intrinsicGas :: Bool -> OutputTx -> Gas
intrinsicGas isHomestead t =
  let bt = otBaseTx t
   in gTXDATAZERO * zeroLen + gTXDATANONZERO * (fromIntegral (codeOrDataLength t) - zeroLen) + txCost bt
  where
    zeroLen = fromIntegral $ zeroBytesLength t
    txCost t' | isMessageTX t' = gTX
    txCost _ = if isHomestead then gCREATETX else gTX
-}
setNewAddresses :: VMBase m => TxRunResult -> m TxRunResult
setNewAddresses trr@(TxRunResult _ result _ before after _) = do
  let isMod ASModification {} = True
      isMod ASDeleted = False

      split :: M.Map Address AddressStateModification -> (S.Set Address, S.Set Address)
      split = bimap (S.fromList . M.keys) (S.fromList . M.keys) . M.partition isMod
      (beforeAddresses, beforeDeletes) = split before
      (afterAddresses, afterDeletes) = split after
      modified = (afterAddresses S.\\ afterDeletes) S.\\ (beforeAddresses S.\\ beforeDeletes)
      moveToFront (Just thisAddress) | thisAddress `S.member` modified = thisAddress : S.toList (S.delete thisAddress modified)
      moveToFront _ = S.toList modified
  case result of
    Left {} -> return trr
    Right erResult -> do
      unseen <- filterM (fmap not . NoCache.addressStateExists) . moveToFront $ erNewContractAddress erResult
      return trr {trrNewAddresses = unseen}

mkLogEntry :: Keccak256 -> Keccak256 -> Log -> LogDB
mkLogEntry bHash tHash Log {..} = LogDB bHash tHash address (topics `indexMaybe` 0) (topics `indexMaybe` 1) (topics `indexMaybe` 2) (topics `indexMaybe` 3) logData bloom

mkEventEntry :: Event -> EventDB
mkEventEntry Event {..} = EventDB evBlockHash evContractAddress evName $ map (\(_,x,_) -> x) evArgs -- drop the field names, only slipstream needs them

outputTransactionResult ::
  VMBase m =>
  BlockHeader ->
  (BlockHeader -> Keccak256) ->
  TxRunResult ->
  ConduitT a VmOutEvent m ()
outputTransactionResult b hashFunction (TxRunResult ot@OutputTx {otHash = theHash} result deltaT beforeMap afterMap newAddresses) = do
  let t = otBaseTx ot
      (txrStatus, message, gasRemaining, creator, appName) =
        case result of
          Left err -> let fmt = format err in (Failure "Execution" Nothing (ExecutionFailure fmt) Nothing Nothing (Just fmt), fmt, 0, "", "") -- TODO Also include the trace
          Right r -> case erException r of
            Nothing -> (Success, "Success!", erRemainingTxGas r, erCreator r, erAppName r)
            Just ex ->
              let fmt = either show show ex
               in (Failure "Execution" Nothing (ExecutionFailure $ show ex) Nothing Nothing (Just fmt), fmt, 0, "", "")
      gasUsed = fromInteger $ transactionGasLimit t - gasRemaining
      etherUsed = gasUsed

      beforeAddresses = S.fromList [x | (x, ASModification _) <- M.toList beforeMap]
      beforeDeletes = S.fromList [x | (x, ASDeleted) <- M.toList beforeMap]
      afterAddresses = S.fromList [x | (x, ASModification _) <- M.toList afterMap]
      afterDeletes = S.fromList [x | (x, ASDeleted) <- M.toList afterMap]
      ranBlockHash = hashFunction b
      (!response, theTrace', theLogs, theEvents) =
        case result of
          Left _ -> ("", [], [], []) --TODO keep the trace when the run fails
          Right r ->
            (fromMaybe "" $ erReturnVal r, unlines $ reverse $ erTrace r, erLogs r, erEvents r)

  yieldMany $ OutLog . mkLogEntry ranBlockHash theHash <$> theLogs
  yield . OutEvent $ mkEventEntry <$> theEvents
  let txr = NewTransactionResult $ TransactionResult
        { transactionResultBlockHash = ranBlockHash,
          transactionResultTransactionHash = theHash,
          transactionResultMessage = message,
          transactionResultResponse = response,
          transactionResultTrace = theTrace',
          transactionResultGasUsed = gasUsed,
          transactionResultEtherUsed = etherUsed,
          transactionResultContractsCreated = newAddresses,
          transactionResultContractsDeleted = S.toList $ (beforeAddresses S.\\ afterAddresses) `S.union` (afterDeletes S.\\ beforeDeletes),
          transactionResultStateDiff = "",
          transactionResultTime = realToFrac deltaT,
          transactionResultNewStorage = "",
          transactionResultDeletedStorage = "",
          transactionResultStatus = Just txrStatus,
          transactionResultCreator = creator,
          transactionResultAppName = appName
        }
  yield . OutVMEvents . (txr:) $ if not flags_diffPublish
    then []
    else case erAction <$> result of
      Right (Just act) -> extractCodeCollectionAddedMessages act
      _ -> []

extractCodeCollectionAddedMessages :: Action.Action -> [VMEvent]
extractCodeCollectionAddedMessages a =
  let mkCCAnouncement (userName, cc) =
        CodeCollectionAdded
              { codeCollection = const () <$> cc,
                creator = userName
              }
  in map mkCCAnouncement $ _newCodeCollections a

printTransactionMessage ::
  MonadLogger m =>
  OutputTx ->
  Either TransactionFailureCause ExecResults ->
  NominalDiffTime ->
  m ()
printTransactionMessage ot@OutputTx {otSigner = tAddr, otHash = theHash} (Left errMsg) deltaT = do
  let tNonce = transactionNonce $ otBaseTx ot
  multilineLog "printTx/err" $
    boringBox
      [ "Adding transaction signed by: " ++ format tAddr,
        "Tx hash:  " ++ format theHash,
        "Tx nonce: " ++ show tNonce,
        CL.red "Transaction failure: " ++ CL.red (format errMsg),
        "t = " ++ printf "%.5f" (realToFrac deltaT :: Double) ++ "s"
      ]
printTransactionMessage ot@OutputTx {otSigner = tAddr, otHash = theHash} (Right results) deltaT = do
  let t = otBaseTx ot
      tNonce = transactionNonce t
      extra =
        if isMessageTX t
          then ""
          else fromMaybe (CL.blink "<failed>") $ fmap format $ erNewContractAddress results

  multilineLog "printTx/ok" $
    boringBox
      [ "Adding transaction signed by: " ++ format tAddr,
        "Tx hash:  " ++ format theHash,
        "Tx nonce: " ++ show tNonce,
        shortDescription t ++ " " ++ extra,
        "t = " ++ printf "%.5f" (realToFrac deltaT :: Double) ++ "s"
      ]

indexMaybe :: [a] -> Int -> Maybe a
indexMaybe _ i | i < 0 = error "indexMaybe called for i < 0"
indexMaybe [] _ = Nothing
indexMaybe (x : _) 0 = Just x
indexMaybe (_ : rest) i = indexMaybe rest (i - 1)

----------------

replaceBestIfBetter :: (Bagger.MonadBagger m) => OutputBlock -> m (Bool, (Keccak256, Integer))
replaceBestIfBetter b@OutputBlock {obBlockData = bd, obReceiptTransactions = txs} = do
  bbi <- getContextBestBlockInfo

  case bbi of
    Unspecified -> error $ "Trying to replace an Unspecified Best Block"
    ContextBestBlockInfo oldBestSha oldBestBlock oldTxCount -> do
      let !newNumber = number bd
          !newStateRoot = stateRoot bd
          !newTxCount = fromIntegral $ length txs
          !oldNumber = number oldBestBlock
          !oldStateRoot = stateRoot oldBestBlock
          !bH = outputBlockHash b
          !bTHs = otHash <$> txs

      let shouldReplace =
            newNumber == 0
              || (newNumber > oldNumber)
              || ((newNumber == oldNumber) && (newTxCount > oldTxCount))

      $logInfoS "replaceBestIfBetter" . T.pack $ "shouldReplace = " ++ show shouldReplace ++ ", newNumber = " ++ show newNumber ++ ", oldBestNumber = " ++ show (number oldBestBlock)

      when shouldReplace $ do
        Bagger.processNewBestBlock bH bd bTHs
        putContextBestBlockInfo $! ContextBestBlockInfo bH bd newTxCount
        cbbi <- getContextBestBlockInfo
        case cbbi of
          Unspecified -> $logInfoS "replaceBestIfBetter" "ContextBestBlockInfo is Unspecified"
          ContextBestBlockInfo h _ t ->
            $logInfoS "ContextBestBlockInfo" . T.pack $
              concat
                [ format h,
                  " ",
                  show t
                ]

      -- we're replaying SeqEvents, and need to notify the mempool
      when (not shouldReplace && (newNumber == oldNumber) && (oldStateRoot == newStateRoot)) $
        Bagger.processNewBestBlock bH bd bTHs

      let bbi' = (bestSha, bestNum)
          bestSha = if shouldReplace then bH else oldBestSha
          bestNum = if shouldReplace then newNumber else oldNumber

      return (shouldReplace, bbi')

calculateAndEmitStateDiffs ::
  VMBase m =>
  Maybe (MP.StateRoot, Keccak256, Integer) ->
  BlockHeader ->
  ConduitT a VmOutEvent m ()
calculateAndEmitStateDiffs Nothing _ = pure ()
calculateAndEmitStateDiffs (Just (next, hsh, num)) oldHeader =
  let base = MP.StateRoot $ blockHeaderStateRoot oldHeader
   in completeDiff base next hsh num

completeDiff ::
  ( MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    Mod.Modifiable MemDBs m,
    Mod.Modifiable CurrentBlockHash m,
    Mod.Modifiable BestBlockRoot m,
    HasMemAddressStateDB m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (Address `A.Alters` AddressState) m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    HasMemRawStorageDB m,
    (RawStorageKey `A.Alters` RawStorageValue) m
  ) =>
  MP.StateRoot ->
  MP.StateRoot ->
  Keccak256 ->
  Integer ->
  ConduitT a VmOutEvent m ()
completeDiff src' dst hsh num = withCurrentBlockHash hsh $ do
  multilineLog "calculateAndEmiteStateDiffs" $ boringBox ["Calculating StateDiff from", format src', "to", format dst]
  runConduit $
    SD.stateDiff Nothing num hsh src' dst
      .| mapM_C (yield . OutStateDiff)
