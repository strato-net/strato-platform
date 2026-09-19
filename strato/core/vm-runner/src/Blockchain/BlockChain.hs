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
    addTransaction,
    recoverProposer,
    verifyBlock,
    mineTransactions,
--    calculateIntrinsicGas',
  )
where

import BlockApps.Logging
import BlockApps.Solidity.ABI (decodeABIArgs, valueToArgText, funcArgTypes)
import qualified Blockchain.Bagger as Bagger
import Blockchain.Bagger.Transactions
import qualified Blockchain.DB.AddressStateDB as NoCache
import qualified Blockchain.DB.BlockSummaryDB as BSDB
import Blockchain.DB.CodeDB ()
import Blockchain.DB.HashDB ()
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.ModifyStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.RLP (rlpEncode, rlpSerialize)
import Blockchain.Data.BlockSummary
import Blockchain.Data.ProposalFacts (ProposalFacts (..))
import Blockchain.Data.DataDefs
import Blockchain.Data.ExecResults
import Blockchain.Data.Log
import Blockchain.Data.Transaction
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Data.TransactionResultStatus
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.StateDB
import Blockchain.Event
import Blockchain.Forks (isReceiptsRootForkActive)
import qualified Blockchain.Verification as V
import Blockchain.JsonRpcCommand (resolveFunction)
import Blockchain.Model.WrappedBlock
import qualified Blockchain.SolidVM as SolidVM
import qualified SolidVM.Model.Storable as MS
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.SyncDB (updateVmBestBlockNumber)
import SolidVM.Model.Delta
import SolidVM.Model.Event
import SolidVM.Model.Value (Value (SAddress))
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.StateDiff as SD
import Blockchain.Stream.Action hiding (blockHash)
import qualified Blockchain.Stream.Action as Action
import Blockchain.Stream.VMEvent
import Blockchain.TheDAOFork
import Blockchain.Timing
import Blockchain.VM.SolidException (SolidException(MissingCodeCollection, RevertError))
import Blockchain.VMContext
import Blockchain.VMOut
import Blockchain.Wiring ()
import Blockchain.VMMetrics
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.VMOptions
import Blockchain.EthConf (ethConf, networkConfig, contractsConfig, nativeTokenAddress, vmConfig)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Verifier
import Control.Monad.IO.Class (MonadIO)
import Control.Applicative ((<|>))
import Control.Lens hiding (filtered)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base ()
import qualified Data.Binary as Bin
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
import SolidVM.Model.SolidString (labelToText)
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.ShortDescription
import Text.Tools
import UnliftIO.IORef

-- todo: lovely!

addBlocks :: [OutputBlock] -> ContextM [BlockVerificationFailure]
addBlocks unfiltered = do
  let filtered = filter ((/= 0) . number . obBlockData) unfiltered
      genesisOnly = filter ((== 0) . number . obBlockData) unfiltered
      timerToUse = Just vmBlockInsertionMined
  -- Genesis blocks don't go through addBlock (they're filtered out below),
  -- so emit them here with an empty receipt list. Non-genesis blocks emit
  -- their RanBlock from inside addBlock's success path so that receipts can
  -- be attached.
  unless (null genesisOnly) $
    mapM_ (emitOut . OutIndexEvent . flip RanBlock []) genesisOnly
  bbi <- getContextBestBlockInfo
  $logInfoS "addBlocks" $ T.pack ("Unfiltered count: " ++ show (length unfiltered))
  $logInfoS "addBlocks" $ T.pack ("Filtered count: " ++ show (length filtered))
  case (filtered, bbi) of
    ([], _) -> return []
    (_, Unspecified) -> return []
    (firstBlock : _, ContextBestBlockInfo _ oldHeader _) -> do
      $logInfoS "addBlocks" $
        T.pack
          ( "Inserting " ++ show (length filtered) ++ " blocks(s) starting with "
              ++ (show . number . obBlockData $ firstBlock)
          )
      -- Block-map entries retained past flushes live for one input batch.
      putAddressStateBlockDBMap emptyBlockMap
      putMemRawStorageBlockMap emptyBlockMap
      didReplaceBest <- newIORef False
      replacedBest <- newIORef (error "addBlocks.replacedBest: evaluating uninitialized BestBlockInfo!")
      -- srLog gathers a chain of better block stateroots. The last one found should be the best block,
      -- and the intermediate ones increase the granularity at which we can compute a sequence
      -- of diffs. The number of blocks to skip between stateroots is determined by the cost of
      -- the diff between them, which is estimated by the number of transactions.
      let go srLog block = do
            let !blockNo = number $ obBlockData block
                !txCount = length $ obReceiptTransactions block
            timeit (printf "Block #%d (%d TXs insertion)" blockNo txCount) timerToUse $ do
              failures <- addBlock block
              if null failures
                then do
                  RBDB.withRedisBlockDB $ updateVmBestBlockNumber blockNo
                  (didReplaceThisTime, replacedBits@(hsh, num)) <- replaceBestIfBetter block
                  if didReplaceThisTime
                    then do
                      writeIORef didReplaceBest True
                      writeIORef replacedBest replacedBits
                      pure (failures, Just (stateRoot $ obBlockData block, hsh, num))
                    else pure (failures, srLog)
                else pure (failures, srLog)
          loop srLog [] = pure ([], srLog)
          loop srLog (b:bs) = go srLog b >>= \case
            ([], srLog') -> loop srLog' bs
            (failures, srLog') -> pure (failures, srLog')
      (failures, srLog) <- loop Nothing filtered
      case failures of
        (_:_) -> pure failures
        _ -> do
          $logDebugLS "addBlocks/srLog" srLog
          didReplaceBest' <- readIORef didReplaceBest
          when didReplaceBest' $ do
            $logInfoS "addBlocks" "done inserting, now will emit stateDiff if necessary"
            nbb <- readIORef replacedBest
            when (Conf.sqlDiff $ vmConfig ethConf) $
              timeit "calculateAndEmitStateDiffs" timerToUse $
                calculateAndEmitStateDiffs srLog oldHeader
            emitOut . OutIndexEvent $ NewBestBlock nbb
          pure []

-- | Recover the proposer address from a block header's proposer seal.
recoverProposer :: BlockHeader -> Either String Address
recoverProposer bd = case getProposerSeal bd of
  Nothing -> Left "no proposer seal in block header"
  Just sig ->
    let (r, s, v) = getSigVals sig
     in case whoReallySignedThisTransactionEcrecover (proposalHash bd) r s (v - 0x1b) of
          Just addr -> Right addr
          Nothing -> Left "could not recover proposer from block seal"

setParentStateRoot ::
  (BSDB.HasBlockSummaryDB m) =>
  OutputBlock ->
  m BlockSummary
setParentStateRoot OutputBlock {..} = do
  -- setTitle every block is a TTY OSC write on the apply hot path; skip it.
  BSDB.getBSum (parentHash obBlockData)

addBlock :: OutputBlock -> ContextM [BlockVerificationFailure]
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

        bSum <- setParentStateRoot b
        A.insert (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256) (bSumStateRoot bSum)
        -- Retained block-map entries are only valid if this block starts from the root they were flushed into.
        startSR <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
        fr <- _flushedRoot <$> Mod.get (Mod.Proxy @MemDBs)
        when (startSR /= fr) $ do
          putAddressStateBlockDBMap emptyBlockMap
          putMemRawStorageBlockMap emptyBlockMap
        -- TODO: PLEASE REMOVE THIS FORK WHEN MERCATA-HYDROGEN IS OBSOLETE
        when (Conf.networkID (networkConfig ethConf) == 7596898649924658542 && number bd == 32624) runTheDAOFork -- Only run this if connected to mercata-hydrogen

        proposer <- either error pure $ recoverProposer bd

        trrs <- addBlockTransactions b proposer

        postRewardSR <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
        verifyBlockResult <- verifyBlock (outputBlockToBlock b) (trrs, postRewardSR) bSum
        case verifyBlockResult of
          failures@(_:_) -> do
            P.incCounter vmBlocksInvalid
            -- Identify the block that failed, not its parent. 'bSum' summarizes
            -- the *parent* (setParentStateRoot looks it up by parentHash), so
            -- bSumNumber/bSumParentHash name the parent and the grandparent.
            -- These values are what the mismatch logs print and what the
            -- StateRootMismatch handler passes to stateDiff', so getting them
            -- wrong sends whoever is debugging to the wrong block.
            pure $ map (BlockVerificationFailure (number bd) obh) failures
          _ -> do
            P.incCounter vmBlocksValid
            P.incCounter vmBlocksMined
            P.incCounter vmBlocksProcessed
            $logInfoS "addBlock" . T.pack $ "Inserted block became #" ++ show (number $ obBlockData b) ++ " (" ++ format obh ++ ")."
            -- Emit RanBlock with the per-tx receipt RLP bytes so the indexer
            -- can persist them to receipt_ref. Pre-fork blocks carry empty
            -- receipts (matching the empty-trie sentinel in the header);
            -- post-fork blocks carry the real receipts that combine to give
            -- the header's receiptsRoot.
            let blockNum = number $ obBlockData b
            receiptsBytes <-
              if isReceiptsRootForkActive blockNum
                then traverse (fmap (rlpSerialize . rlpEncode) . txRunResultToReceipt) trrs
                else pure []
            emitOut . OutIndexEvent $ RanBlock b receiptsBytes
            pure []

-- TODO: If we add more verifications, refactor tuple into a proper data type
verifyBlock ::
  (HasStateDB m, MonadIO m) =>
  Block ->
  ([TxRunResult], Maybe MP.StateRoot) ->
  BlockSummary ->
  m [BlockVerificationFailureDetails]
verifyBlock b@Block{blockBlockData = bh} (trrs, derivedSR) parentBSum = do
  validity <- checkValidity parentBSum b
  let vDelt = getDeltasFromResults trrs
      sDelt = getStakeDeltasFromResults trrs
      blockSR = Just $ stateRoot bh
      bVd = toDelta (getBlockNewValidators bh) (getBlockRemovedValidators bh)
      bSd = M.fromList $ getBlockStakeUpdates bh
      srCheck =  if derivedSR == blockSR
        then Nothing
        else Just . StateRootMismatch $
               BlockDelta (stateRoot bh)
                          (fromMaybe MP.emptyTriePtr derivedSR)
      validatorCheck = if eqDelta bVd vDelt
        then Nothing
        else Just . ValidatorMismatch $ BlockDelta (fromDelta bVd) (fromDelta vDelt)
      stakeCheck = if bSd == sDelt
        then Nothing
        else Just . StakeMismatch $ BlockDelta (M.toAscList bSd) (M.toAscList sDelt)
      -- PBFT rounds persist across heights: a block's round cannot precede its parent's
      parentRound = pfRound (bSumProposalFacts parentBSum)
      roundCheck = if getBlockRound bh >= parentRound
        then Nothing
        else Just . RoundMismatch $ BlockDelta (getBlockRound bh) parentRound
      stakingActive = Conf.stakingActiveAt (networkConfig ethConf) (number bh)
      expectedVersion = if stakingActive then 3 else 2
      -- Receipts-root check: post-fork, every node must arrive at the same
      -- root from the executed transactions. Pre-fork, the header carries
      -- the empty-trie sentinel and the check is skipped.
      blockNum = number bh
  receiptsForRoot <-
    if isReceiptsRootForkActive blockNum
      then traverse txRunResultToReceipt trrs
      else pure []
  let derivedReceiptsRoot = V.receiptsVerificationValue receiptsForRoot
      receiptsRootCheck =
        if derivedReceiptsRoot == receiptsRoot bh
          then Nothing
          else Just . ReceiptsRootMismatch $
                 BlockDelta (receiptsRoot bh) derivedReceiptsRoot
  return $ validity ++ case blockHeaderVersion bh of
    1 -> catMaybes [srCheck]
    2 | not stakingActive -> catMaybes [srCheck, validatorCheck, receiptsRootCheck]
    3 | stakingActive -> catMaybes [srCheck, validatorCheck, receiptsRootCheck, stakeCheck, roundCheck]
    v -> [VersionMismatch $ BlockDelta v expectedVersion]

addBlockTransactions :: OutputBlock -> Address -> ContextM [TxRunResult]
addBlockTransactions b@OutputBlock {obBlockData = bd, obReceiptTransactions = transactions} proposer = do
  $logDebugS "addBlockTransactions" . T.pack $ "All transactions: " ++ show transactions
  trrs <- addTransactions bd transactions proposer

  runPatches bd

  when (Conf.sqlDiff $ vmConfig ethConf) $
    emitOut . OutVMEvents =<< sendNewActionMessage b trrs

  timeit "flushMemStorageDB" (Just vmBlockInsertionMined) flushMemStorageDB
  resetAddressStateTxDBMap
  timeit "flushMemAddressStateDB" (Just vmBlockInsertionMined) flushMemAddressStateDB
  pure trrs

sendNewActionMessage :: (HasMemRawStorageDB m) =>
                        OutputBlock -> [TxRunResult] -> m [VMEvent]
sendNewActionMessage b trrs = do
  let bd = obBlockData b
  bm <- getMemRawStorageBlockDB

  -- Only this block's writes: the block map also retains reads from earlier blocks.
  let recombined :: Map Address ActionData
      recombined =
        fmap (ActionData . SolidVMDiff)
        $ M.fromListWith M.union
        [ (addr, M.singleton path val) | ((addr, path), val) <- dirtyBlockMap bm ]

      action :: Action
      action = Action {
        _blockHash=blockHash b,
        _blockTimestamp=blockHeaderTimestamp bd,
        _blockNumber=blockHeaderBlockNumber bd,
        _transactionSender=0x0,
        _actionData=O.fromList $ M.toList recombined,
        _newCodeCollections=O.empty,
        _events=Seq.fromList $ concat $ map (either (const []) erEvents . trrResult) trrs,
        _delegatecalls=mconcat $ map (either (const Seq.empty) (fromMaybe Seq.empty . fmap _delegatecalls . erAction) . trrResult) trrs
        }

  pure [NewAction action]



addTransactions ::
  BlockHeader ->
  [OutputTx] ->
  Address ->
  ContextM [TxRunResult]
addTransactions blockData txs proposer =
  timeit ("addTransactions, " ++ show (length txs) ++ " TXs") (Just vmBlockInsertionMined) $ do
    rewardResult <- payBlockRewards blockData proposer
    trrs <- Bagger.attachBlockRewards blockData rewardResult <$> go (getBlockGasLimit blockData) txs DL.empty
    when (Conf.sqlDiff $ vmConfig ethConf) $ do
      mapM_ (outputTransactionResult blockData blockHeaderHash) trrs
      emitOut . OutASM $ foldr (flip M.union) M.empty $ map trrAfterMap trrs
    pure trrs
  where
    go :: VMBase m =>
          Integer -> [OutputTx] -> DL.DList TxRunResult -> m [TxRunResult]
    go _ [] trrs = return $ DL.toList trrs
    go blockGas (t : rest) trrs = do
      let bt = otBaseTx t
      beforeMap <- getAddressStateTxDBMap
      resetAddressStateTxDBMap

      (!deltaT, !result) <- timeIt $ addTransaction blockData blockGas t proposer

      afterMap <- getAddressStateTxDBMap

      printTransactionMessage t result deltaT
      P.setGauge vmTxMined (realToFrac deltaT)

      trr <- setNewAddresses $ TxRunResult t result deltaT beforeMap afterMap []

      let remainingBlockGas =
            case result of
              Left _ -> blockGas
              Right execResult -> blockGas - (TD.gasLimit bt - calculateReturned bt execResult)

      go remainingBlockGas rest (trrs `DL.snoc` trr)

mineTransactions :: VMBase m => Bagger.MineTransactions m
mineTransactions bd remGas otxs mSelfAddress payRewards = do
  -- Must mirror addTransactions, or the block the proposer builds and the block
  -- the verifier replays end at different state roots. Bagger builds a block
  -- incrementally and only sets payRewards on the run that starts it, so this
  -- happens exactly once per block on this side too.
  rewardResult <- if payRewards then payBlockRewards bd mSelfAddress else pure Nothing
  res <- mineTransactions' bd remGas DL.empty otxs mSelfAddress
  -- Same fold as addTransactions, but this run need not be the one that carries
  -- the block's first transaction: when it ran none, hand the reward results
  -- back so an incremental build can attach them to the run that does.
  let (ranTxs, unattached) = Bagger.attachBlockRewards' bd rewardResult (Bagger.tmrRanTxs res)
  pure res {Bagger.tmrRanTxs = ranTxs, Bagger.tmrUnattachedRewards = unattached}

mineTransactions' :: VMBase m => BlockHeader -> Integer -> DL.DList TxRunResult -> [OutputTx] -> Address-> m Bagger.TxMiningResult
mineTransactions' _ remGas ran [] _ = return $ Bagger.TxMiningResult Nothing (DL.toList ran) [] remGas Nothing
mineTransactions' header remGas ran unran@(tx : txs) mSelfAddress = do
  let bt = otBaseTx tx
  beforeMap <- getAddressStateTxDBMap
  (!time', !result) <- timeIt $ addTransaction header remGas tx mSelfAddress
  afterMap <- getAddressStateTxDBMap
  P.setGauge vmTxMining (realToFrac time')
  printTransactionMessage tx result time'
  trr <- setNewAddresses $ TxRunResult tx result time' beforeMap afterMap []
  case result of
    Right execResult -> do
      let nextRemGas = remGas - (TD.gasLimit bt - calculateReturned bt execResult)
      resetAddressStateTxDBMap
      mineTransactions' header nextRemGas (ran `DL.snoc` trr) txs mSelfAddress
    Left failure -> do
      return $ Bagger.TxMiningResult (Just failure) (DL.toList ran) unran remGas Nothing

addTransaction ::
  BlockHeader ->
  Integer ->
  OutputTx ->
  Address ->
  ContextM (Either TransactionFailureCause ExecResults)
addTransaction b remainingBlockGas t@OutputTx {otSigner = tAddr} proposer = do
  nonceValid <- isNonceValid t

  let bt = otBaseTx t
  let maxGas = fromIntegral (maxBound :: Int)
  acctNonce <- addressStateNonce <$> A.lookupWithDefault (Proxy @AddressState) tAddr

  let txSize = toInteger $ B.length $ BL.toStrict $ Bin.encode $ otBaseTx t
      sizeLimit = toInteger (Conf.txSizeLimit (networkConfig ethConf))
      precheck
        | TD.gasLimit bt > min remainingBlockGas maxGas = Left $ TFBlockGasLimitExceeded (TD.gasLimit bt) remainingBlockGas t
        | not nonceValid = Left $ TFNonceMismatch (TD.nonce bt) acctNonce t
        | txSize >= sizeLimit = Left $ TFTXSizeLimitExceeded txSize sizeLimit t
        | otherwise = Right ()

  let availableGas = 400_000

  case precheck of
    Left failure -> pure (Left failure)
    Right () -> payFees b availableGas tAddr t proposer >>= \case
      Left failure -> pure (Left failure)
      Right feeResult -> do
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

        -- fee payment already succeeded, so nothing below may fail the transaction
        fmap (Right . attachFeeResult) $ do
          $logDebugS "runCodeForTransaction" "decide() function successful, running TX"

          incrementNonce tAddr

          if otHash t `S.member` knownFailedTxs
            then pure . solidvmErrorResults $ RevertError "Known failed tx" (format $ txHash t)
            else do
              $logDebugS "addTx" . T.pack $ "gas is always off, so I'm giving the account enough balance for this TX"
              faucetSuccess <- addToBalance tAddr 10000000 -- txCost
              unless faucetSuccess $ error "failed to give balance to a gasOff account"

              when flags_debug $ $logDebugS "addTx" "running code"
              let txTypeCounter = if isContractCreationTX bt then vmTxsCreation else vmTxsCall
              P.incCounter txTypeCounter

              execResults <- runCodeForTransaction b availableGas tAddr t proposer
              P.incCounter vmTxsProcessed

              case erException execResults of
                Just e -> do
                  when flags_debug $ $logDebugS "addTx" . T.pack . CL.red $ show e
                  P.incCounter vmTxsUnsuccessful
                Nothing -> do
                  when flags_debug $ $logDebugS "addTx" . T.pack $ "Removing accounts in suicideList: " ++ intercalate ", " (format <$> S.toList (erSuicideList execResults))
                  forM_ (S.toList $ erSuicideList execResults) $ \address' -> do
                    purgeStorageMap address'
                    A.delete (Proxy @AddressState) address'
                  P.incCounter vmTxsSuccessful
              pure execResults

runCodeForTransaction ::
  (VMBase m) =>
  BlockHeader ->
  Gas ->
  Address ->
  OutputTx ->
  Address ->
  m ExecResults
runCodeForTransaction b availableGas tAddr t proposer =
  let ut = otBaseTx t
   in case ut of
        TD.EthereumTX {TD.ethTo = Just toAddr, TD.value = val, TD.txData = callData}
          | B.null callData && val > 0 -> do
            let nativeAddr = nativeTokenAddress (contractsConfig ethConf)
                recipientArg = T.pack $ "0x" ++ formatAddressWithoutColor toAddr
                amountArg = T.pack $ show val
            $logInfoS "runCodeForTransaction" $ T.pack $
              "EthereumTX native transfer: " ++ show val ++ " to " ++ format toAddr ++ " -> nativeToken.transfer"
            SolidVM.call
              b
              nativeAddr
              tAddr
              proposer
              (fromIntegral availableGas)
              tAddr
              (txHash ut)
              "transfer"
              [recipientArg, amountArg]
              Nothing
          | otherwise -> do
            when flags_debug $ $logInfoS "runCodeForTransaction" $ T.pack $
              "runCodeForTransaction: EthereumTX caller: " ++ format tAddr ++ ", address: " ++ format toAddr
            let selector = B.take 4 callData
                argsBytes = B.drop 4 callData
            resolveFunction b tAddr toAddr selector >>= \case
              Nothing -> pure . solidvmErrorResults $ MissingCodeCollection (show toAddr)
                ("no matching function for selector 0x" ++ concatMap (printf "%02x") (B.unpack selector))
              Just (fName, func) -> do
                let argTexts = map valueToArgText $ decodeABIArgs argsBytes (funcArgTypes func)
                    fnStr = T.unpack (labelToText fName)
                $logInfoS "runCodeForTransaction" $ T.pack $
                  "EthereumTX resolved: " ++ fnStr ++ "(" ++ intercalate ", " (map T.unpack argTexts) ++ ") on " ++ format toAddr
                SolidVM.call
                  b
                  toAddr
                  tAddr
                  proposer
                  (fromIntegral availableGas)
                  tAddr
                  (txHash ut)
                  (labelToText fName)
                  argTexts
                  Nothing

        TD.EthereumTX {TD.ethTo = Nothing} ->
          pure . solidvmErrorResults $ MissingCodeCollection (show $ Address 0) "EthereumTX contract creation (raw EVM bytecode) not supported"

        _ | isContractCreationTX ut -> do
          when flags_debug $ $logInfoS "runCodeForTransaction" "runCodeForTransaction: ContractCreationTX"

          --TODO- The new address state should be created in the VM itself....  Currently the EVM doesn't do this (and could be cleaned up by doing so), SolidVM does do this.  I will calculate this value here, but then ignore the value in SolidVM (and recalculate it there).  Eventually this should be moved into the EVM also
          nonce <- addressStateNonce <$> A.lookupWithDefault (Proxy @AddressState) tAddr
          let newAddress = getNewAddress_unsafe (tAddr) (nonce - 1) --nonce has already been incremented, so subtract 1 here to get the proper value (this is directly specified in the yellowpaper)

          SolidVM.create
            b
            tAddr
            tAddr
            proposer
            availableGas
            newAddress
            (TD.code ut)
            (txHash ut)
            (fromJust $ txContractName ut)
            (txArgs ut)

        _ -> do
          when flags_debug $ $logInfoS "runCodeForTransaction" $ T.pack $ "runCodeForTransaction: MessageTX caller: " ++ format tAddr ++ ", address: " ++ format (TD.to ut)

          SolidVM.call
                b -- blockData
                (TD.to ut) -- codeAddress
                tAddr -- sender
                proposer -- proposer
                (fromIntegral availableGas) -- availableGas
                tAddr -- origin
                (txHash ut) -- txHash
                (TD.funcName ut)
                (TD.args ut)
                Nothing

payFees ::
  BlockHeader ->
  Gas ->
  Address ->
  OutputTx ->
  Address ->
  ContextM (Either TransactionFailureCause ExecResults)
payFees b availableGas tAddr t proposer = do
  -- BEGIN: Custom Validation Check
  -- Call validation contract at 0xDEC1DE. Require it returns True.

  feeResult <-
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
  
  pure $ case erException feeResult of
    Nothing -> Right feeResult
    Just _ -> Left $ TFInsufficientFunds 10_000_000_000_000_000 0 t

-- | Give the installed fee contract a chance to pay block rewards once per
-- block, before any of the block's transactions run. The implementation is
-- whatever DeciderState (0xDEC1DE02) currently points at, so this follows
-- updatePayFeeContract without needing a node change. A contract that defines
-- no payBlockRewards — or one whose call throws — leaves the block untouched.
--
-- Both the mining and the validation path call this, and they do not call it
-- the same number of times: Bagger mines incrementally, replaying only newly
-- promoted transactions against the previous state root, so a block can reach
-- this several times while being built but exactly once while being verified.
-- The contract must therefore latch on block.number and make repeat calls
-- no-ops, the way StratoStaking.processBlock already does. Without that latch
-- the proposer and the verifier derive different state roots and no block can
-- ever commit.
-- Returns the reward call's results so the caller can fold its events into the
-- block's receipts; 'Nothing' when no rewards were paid.
payBlockRewards ::
  VMBase m =>
  BlockHeader ->
  Address ->
  m (Maybe ExecResults)
payBlockRewards b proposer = do
  let bHash = blockHeaderHash b
      availableGas = 400_000
      callIt addr fn =
        SolidVM.call b addr proposer proposer availableGas proposer bHash fn [] Nothing
  implResult <- callIt (Address 0xDEC1DE02) "getImplContract"
  case (erException implResult, erReturnVal implResult) of
    (Just e, _) -> do
      $logInfoS "payBlockRewards" . T.pack $
        "could not read the fee contract, skipping block rewards: " ++ show e
      pure Nothing
    (Nothing, Just (SAddress impl _)) | impl /= Address 0 -> do
      rewardResult <- callIt impl "payBlockRewards"
      case erException rewardResult of
        Just e -> do
          $logInfoS "payBlockRewards" . T.pack $
            "no block rewards paid by " ++ format impl ++ ": " ++ show e
          pure Nothing
        Nothing -> pure $ Just rewardResult
    _ -> pure Nothing

-- (attachBlockRewards / attachBlockRewards' now live in Blockchain.Bagger, so
-- the miner and the verifier cannot drift apart on how rewards reach receipts.)

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
    codeBytes' bt = case TD.code bt of
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
mkEventEntry Event {..} = EventDB evBlockHash evTxHash evContractAddress evName $ map eventArgValueString evArgs -- drop everything but the rendered value string; only slipstream needs the rest

outputTransactionResult ::
  BlockHeader ->
  (BlockHeader -> Keccak256) ->
  TxRunResult ->
  ContextM ()
outputTransactionResult b hashFunction (TxRunResult ot@OutputTx {otHash = theHash} result deltaT beforeMap afterMap newAddresses) = do
  let t = otBaseTx ot
      (txrStatus, message, gasRemaining) =
        case result of
          Left err -> let fmt = format err in (Failure "Execution" Nothing (ExecutionFailure fmt) Nothing Nothing (Just fmt), fmt, 0) -- TODO Also include the trace
          Right r -> case erException r of
            Nothing -> (Success, "Success!", erRemainingTxGas r)
            Just ex ->
              let fmt = either show show ex
               in (Failure "Execution" Nothing (ExecutionFailure $ show ex) Nothing Nothing (Just fmt), fmt, 0)
      gasUsed = fromInteger $ TD.gasLimit t - gasRemaining
      etherUsed = gasUsed

      beforeAddresses = S.fromList [x | (x, ASModification _) <- M.toList beforeMap]
      beforeDeletes = S.fromList [x | (x, ASDeleted) <- M.toList beforeMap]
      afterAddresses = S.fromList [x | (x, ASModification _) <- M.toList afterMap]
      afterDeletes = S.fromList [x | (x, ASDeleted) <- M.toList afterMap]
      ranBlockHash = hashFunction b
      (!response, theTrace', theLogs, theEvents) =
        case result of
          Left _ -> (Nothing, [], [], [])
          Right r ->
            (erReturnVal r, unlines $ reverse $ erTrace r, erLogs r, erEvents r)

  mapM_ (emitOut . OutLog . mkLogEntry ranBlockHash theHash) theLogs
  emitOut . OutEvent $ mkEventEntry <$> theEvents
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
          transactionResultStatus = Just txrStatus
        }
  emitOut . OutVMEvents . (txr:) $ if not (Conf.diffPublish $ vmConfig ethConf)
    then []
    else case erAction <$> result of
      Right (Just act) -> extractCodeCollectionAddedMessages act
      _ -> []

extractCodeCollectionAddedMessages :: Action.Action -> [VMEvent]
extractCodeCollectionAddedMessages a =
  let mkCCAnouncement ((userName, ch), cc) =
        CodeCollectionAdded
              { codeCollection = const () <$> cc,
                creator = userName,
                codeHash = ch
              }
  in map mkCCAnouncement . O.assocs $ _newCodeCollections a

printTransactionMessage ::
  MonadLogger m =>
  OutputTx ->
  Either TransactionFailureCause ExecResults ->
  NominalDiffTime ->
  m ()
printTransactionMessage ot@OutputTx {otSigner = tAddr, otHash = theHash} (Left errMsg) deltaT = do
  let tNonce = TD.nonce $ otBaseTx ot
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
      tNonce = TD.nonce t
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

replaceBestIfBetter :: OutputBlock -> ContextM (Bool, (Keccak256, Integer))
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
            $logDebugS "ContextBestBlockInfo" . T.pack $
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
  Maybe (MP.StateRoot, Keccak256, Integer) ->
  BlockHeader ->
  ContextM ()
calculateAndEmitStateDiffs Nothing _ = pure ()
calculateAndEmitStateDiffs (Just (next, hsh, num)) oldHeader =
  let base = MP.StateRoot $ blockHeaderStateRoot oldHeader
   in completeDiff base next hsh num

completeDiff ::
  MP.StateRoot ->
  MP.StateRoot ->
  Keccak256 ->
  Integer ->
  ContextM ()
completeDiff src' dst hsh num = withCurrentBlockHash hsh $ do
  multilineLog "calculateAndEmiteStateDiffs" $ boringBox ["Calculating StateDiff from", format src', "to", format dst]
  SD.stateDiff Nothing num hsh src' dst >>= mapM_ (emitOut . OutStateDiff)

runPatches :: (MonadLogger m, HasRawStorageDB m) => BlockHeader -> m ()
runPatches bh = case Conf.networkID (networkConfig ethConf) of
  114784819836269 -> case blockHeaderBlockNumber bh of
    49820 -> do
      putRawStorageKeyVal' (0x1005, MS.StoragePath [MS.Field "userLoan", MS.Index "ac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7", MS.Field "lastUpdated"]) (MS.BInteger 1775496883)
      putRawStorageKeyVal' (0x1005, MS.StoragePath [MS.Field "userLoan", MS.Index "ac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7", MS.Field "scaledDebt"]) (MS.BInteger 1000000000000000000000000000000)
    49824 -> do
      putRawStorageKeyVal' (0x1005, MS.StoragePath [MS.Field "userLoan", MS.Index "ac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7", MS.Field "lastUpdated"]) (MS.BInteger 1775497158)
      putRawStorageKeyVal' (0x1005, MS.StoragePath [MS.Field "userLoan", MS.Index "ac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7", MS.Field "scaledDebt"]) MS.BDefault
    _ -> pure ()
  _ -> pure ()
