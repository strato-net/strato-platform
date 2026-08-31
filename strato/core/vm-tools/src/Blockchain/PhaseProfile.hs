{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.PhaseProfile
  ( Phase (..),
    phaseProfileEnabled,
    runCodeDetailEnabled,
    beginProfileBlock,
    endProfileBlock,
    profilePhase,
    profileRunCodeTransaction,
    profileRunCodeChild,
    profileRunCodeChildForced,
    profileRunCodeFunction,
    profileRunCodeStatement,
    profileRunCodeStatementChild,
    noteRunCodeStorageRead,
    profileDetachedPhase,
    noteProfileOutput,
    finalizePhaseProfile,
  )
where

import Blockchain.Database.MerklePatricia.Profile
import Control.Concurrent.MVar
import Control.DeepSeq (NFData, force)
import Control.Exception (bracket, evaluate)
import Control.Monad (forM_, when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Crypto.Hash (Context, Digest, SHA256, hashFinalize, hashInit, hashUpdate)
import Data.Aeson ((.=))
import qualified Data.Aeson as JSON
import qualified Data.Aeson.Key as Key
import Data.Binary.Put (putWord64be, runPut)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Lazy.Char8 as BL8
import Data.Int (Int64)
import Data.IORef
import Data.List (foldl', sort)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe, isJust)
import qualified Data.Vector.Unboxed.Mutable as MV
import Data.Word (Word64)
import GHC.Clock (getMonotonicTimeNSec)
import GHC.Conc.Sync (getAllocationCounter)
import System.CPUTime (getCPUTime)
import System.Environment (lookupEnv)
import System.IO
import System.IO.Unsafe (unsafePerformIO)
import UnliftIO (MonadUnliftIO, withRunInIO)

data Phase
  = BlockSetupHeaderParentProposer
  | PayBlockRewards
  | TransactionValidationDecidePayFees
  | TransactionPrecheckNonceSize
  | TransactionPayFeesDecide
  | TransactionResultAccounting
  | RunCodeCall
  | RunCodeCallFunctionResolution
  | RunCodeCallCodeCollectionLookupCompile
  | RunCodeCallCodeCacheLookup
  | RunCodeCallColdCodeLoadCompileTypecheck
  | RunCodeCallColdCodeDatabaseIO
  | RunCodeCallColdParseImportCollection
  | RunCodeCallColdInheritanceTypecheckOptimize
  | RunCodeCallColdFunctionInheritance
  | RunCodeCallArgumentReferencePreparation
  | RunCodeCallContractDispatchFrameSetup
  | RunCodeCallOnlyOwnerGuard
  | RunCodeCallFastIRGateExecution
  | RunCodeCallFastIRArgumentConversion
  | RunCodeCallFastIRScalarExecution
  | RunCodeCallFastIRStorageExecution
  | RunCodeCallFastIRFallbackProbe
  | RunCodeCallInterpretedFrame
  | RunCodeCallStatementExecution
  | RunCodeCallStatementAssignment
  | RunCodeCallStatementVariableDefinition
  | RunCodeCallStatementExpression
  | RunCodeCallStatementControlFlow
  | RunCodeCallStatementOther
  | RunCodeCallExpressionVariable
  | RunCodeCallExpressionLiteral
  | RunCodeCallExpressionIndexMember
  | RunCodeCallExpressionFunctionCall
  | RunCodeCallExpressionOperator
  | RunCodeCallExpressionAggregateOther
  | RunCodeCallStatementStorageRead
  | RunCodeCallStatementStorageWrite
  | RunCodeCallStatementCryptoBuiltin
  | RunCodeCallStatementOtherBuiltin
  | RunCodeCallFrameOverlayMaterialization
  | RunCodeCallResultActionEventCollection
  | RunCodeCreation
  | RunCodeCreationCodeCollectionLookupCompile
  | RunCodeCreationCodeCacheLookup
  | RunCodeCreationColdCodeLoadCompileTypecheck
  | RunCodeCreationColdCodeDatabaseIO
  | RunCodeCreationColdParseImportCollection
  | RunCodeCreationColdInheritanceTypecheckOptimize
  | RunCodeCreationColdFunctionInheritance
  | RunCodeCreationArgumentReferencePreparation
  | RunCodeCreationContractDispatchFrameSetup
  | RunCodeCreationOnlyOwnerGuard
  | RunCodeCreationFastIRGateExecution
  | RunCodeCreationFastIRArgumentConversion
  | RunCodeCreationFastIRScalarExecution
  | RunCodeCreationFastIRStorageExecution
  | RunCodeCreationFastIRFallbackProbe
  | RunCodeCreationInterpretedFrame
  | RunCodeCreationStatementExecution
  | RunCodeCreationStatementAssignment
  | RunCodeCreationStatementVariableDefinition
  | RunCodeCreationStatementExpression
  | RunCodeCreationStatementControlFlow
  | RunCodeCreationStatementOther
  | RunCodeCreationExpressionVariable
  | RunCodeCreationExpressionLiteral
  | RunCodeCreationExpressionIndexMember
  | RunCodeCreationExpressionFunctionCall
  | RunCodeCreationExpressionOperator
  | RunCodeCreationExpressionAggregateOther
  | RunCodeCreationStatementStorageRead
  | RunCodeCreationStatementStorageWrite
  | RunCodeCreationStatementCryptoBuiltin
  | RunCodeCreationStatementOtherBuiltin
  | RunCodeCreationFrameOverlayMaterialization
  | RunCodeCreationResultActionEventCollection
  | TransactionOverlayToBlockOverlay
  | SolidVMDiffActionConstructionSerialization
  | StorageTrieFlush
  | AddressStateTrieFlush
  | StateReceiptValidatorStakingVerification
  | PendingMerkleNodesLevelDBCommit
  | EventKafkaEnqueue
  deriving (Bounded, Enum, Eq, Ord, Show)

phaseName :: Phase -> String
phaseName BlockSetupHeaderParentProposer = "01_block_setup_header_parent_proposer"
phaseName PayBlockRewards = "02_pay_block_rewards"
phaseName TransactionValidationDecidePayFees = "03_transaction_validation_decide_pay_fees"
phaseName TransactionPrecheckNonceSize = "03a_transaction_precheck_nonce_size"
phaseName TransactionPayFeesDecide = "03b_transaction_pay_fees_decide"
phaseName TransactionResultAccounting = "03c_transaction_result_accounting"
phaseName RunCodeCall = "04_run_code.call.wrapper_residual"
phaseName RunCodeCallFunctionResolution = "04_run_code.call.function_resolution"
phaseName RunCodeCallCodeCollectionLookupCompile = "04_run_code.call.code_address_collection_residual"
phaseName RunCodeCallCodeCacheLookup = "04_run_code.call.code_cache_lookup"
phaseName RunCodeCallColdCodeLoadCompileTypecheck = "04_run_code.call.cold_code_residual"
phaseName RunCodeCallColdCodeDatabaseIO = "04_run_code.call.cold_code_database_io"
phaseName RunCodeCallColdParseImportCollection = "04_run_code.call.cold_parse_import_collection"
phaseName RunCodeCallColdInheritanceTypecheckOptimize = "04_run_code.call.cold_inheritance_typecheck_optimize"
phaseName RunCodeCallColdFunctionInheritance = "04_run_code.call.cold_function_inheritance"
phaseName RunCodeCallArgumentReferencePreparation = "04_run_code.call.argument_reference_preparation"
phaseName RunCodeCallContractDispatchFrameSetup = "04_run_code.call.contract_dispatch_frame_setup"
phaseName RunCodeCallOnlyOwnerGuard = "04_run_code.call.only_owner_guard"
phaseName RunCodeCallFastIRGateExecution = "04_run_code.call.fast_ir_gate_execution"
phaseName RunCodeCallFastIRArgumentConversion = "04_run_code.call.fast_ir.argument_conversion"
phaseName RunCodeCallFastIRScalarExecution = "04_run_code.call.fast_ir.scalar_execution"
phaseName RunCodeCallFastIRStorageExecution = "04_run_code.call.fast_ir.storage_execution"
phaseName RunCodeCallFastIRFallbackProbe = "04_run_code.call.fast_ir.fallback_probe"
phaseName RunCodeCallInterpretedFrame = "04_run_code.call.interpreted_frame_residual"
phaseName RunCodeCallStatementExecution = "04_run_code.call.statement_interpreter_expression_residual"
phaseName RunCodeCallStatementAssignment = "04_run_code.call.statement.assignment"
phaseName RunCodeCallStatementVariableDefinition = "04_run_code.call.statement.variable_definition"
phaseName RunCodeCallStatementExpression = "04_run_code.call.statement.expression"
phaseName RunCodeCallStatementControlFlow = "04_run_code.call.statement.control_flow"
phaseName RunCodeCallStatementOther = "04_run_code.call.statement.other"
phaseName RunCodeCallExpressionVariable = "04_run_code.call.expression.variable"
phaseName RunCodeCallExpressionLiteral = "04_run_code.call.expression.literal"
phaseName RunCodeCallExpressionIndexMember = "04_run_code.call.expression.index_member"
phaseName RunCodeCallExpressionFunctionCall = "04_run_code.call.expression.function_call"
phaseName RunCodeCallExpressionOperator = "04_run_code.call.expression.operator"
phaseName RunCodeCallExpressionAggregateOther = "04_run_code.call.expression.aggregate_other"
phaseName RunCodeCallStatementStorageRead = "04_run_code.call.statement_storage_read"
phaseName RunCodeCallStatementStorageWrite = "04_run_code.call.statement_storage_write"
phaseName RunCodeCallStatementCryptoBuiltin = "04_run_code.call.statement_crypto_builtin"
phaseName RunCodeCallStatementOtherBuiltin = "04_run_code.call.statement_other_builtin"
phaseName RunCodeCallFrameOverlayMaterialization = "04_run_code.call.frame_overlay_materialization"
phaseName RunCodeCallResultActionEventCollection = "04_run_code.call.result_action_event_collection"
phaseName RunCodeCreation = "04_run_code.creation.wrapper_residual"
phaseName RunCodeCreationCodeCollectionLookupCompile = "04_run_code.creation.code_address_collection_residual"
phaseName RunCodeCreationCodeCacheLookup = "04_run_code.creation.code_cache_lookup"
phaseName RunCodeCreationColdCodeLoadCompileTypecheck = "04_run_code.creation.cold_code_residual"
phaseName RunCodeCreationColdCodeDatabaseIO = "04_run_code.creation.cold_code_database_io"
phaseName RunCodeCreationColdParseImportCollection = "04_run_code.creation.cold_parse_import_collection"
phaseName RunCodeCreationColdInheritanceTypecheckOptimize = "04_run_code.creation.cold_inheritance_typecheck_optimize"
phaseName RunCodeCreationColdFunctionInheritance = "04_run_code.creation.cold_function_inheritance"
phaseName RunCodeCreationArgumentReferencePreparation = "04_run_code.creation.argument_reference_preparation"
phaseName RunCodeCreationContractDispatchFrameSetup = "04_run_code.creation.contract_dispatch_frame_setup"
phaseName RunCodeCreationOnlyOwnerGuard = "04_run_code.creation.only_owner_guard"
phaseName RunCodeCreationFastIRGateExecution = "04_run_code.creation.fast_ir_gate_execution"
phaseName RunCodeCreationFastIRArgumentConversion = "04_run_code.creation.fast_ir.argument_conversion"
phaseName RunCodeCreationFastIRScalarExecution = "04_run_code.creation.fast_ir.scalar_execution"
phaseName RunCodeCreationFastIRStorageExecution = "04_run_code.creation.fast_ir.storage_execution"
phaseName RunCodeCreationFastIRFallbackProbe = "04_run_code.creation.fast_ir.fallback_probe"
phaseName RunCodeCreationInterpretedFrame = "04_run_code.creation.interpreted_frame_residual"
phaseName RunCodeCreationStatementExecution = "04_run_code.creation.statement_interpreter_expression_residual"
phaseName RunCodeCreationStatementAssignment = "04_run_code.creation.statement.assignment"
phaseName RunCodeCreationStatementVariableDefinition = "04_run_code.creation.statement.variable_definition"
phaseName RunCodeCreationStatementExpression = "04_run_code.creation.statement.expression"
phaseName RunCodeCreationStatementControlFlow = "04_run_code.creation.statement.control_flow"
phaseName RunCodeCreationStatementOther = "04_run_code.creation.statement.other"
phaseName RunCodeCreationExpressionVariable = "04_run_code.creation.expression.variable"
phaseName RunCodeCreationExpressionLiteral = "04_run_code.creation.expression.literal"
phaseName RunCodeCreationExpressionIndexMember = "04_run_code.creation.expression.index_member"
phaseName RunCodeCreationExpressionFunctionCall = "04_run_code.creation.expression.function_call"
phaseName RunCodeCreationExpressionOperator = "04_run_code.creation.expression.operator"
phaseName RunCodeCreationExpressionAggregateOther = "04_run_code.creation.expression.aggregate_other"
phaseName RunCodeCreationStatementStorageRead = "04_run_code.creation.statement_storage_read"
phaseName RunCodeCreationStatementStorageWrite = "04_run_code.creation.statement_storage_write"
phaseName RunCodeCreationStatementCryptoBuiltin = "04_run_code.creation.statement_crypto_builtin"
phaseName RunCodeCreationStatementOtherBuiltin = "04_run_code.creation.statement_other_builtin"
phaseName RunCodeCreationFrameOverlayMaterialization = "04_run_code.creation.frame_overlay_materialization"
phaseName RunCodeCreationResultActionEventCollection = "04_run_code.creation.result_action_event_collection"
phaseName TransactionOverlayToBlockOverlay = "05_transaction_overlay_to_block_overlay"
phaseName SolidVMDiffActionConstructionSerialization = "06_solidvm_diff_action_construction_serialization"
phaseName StorageTrieFlush = "07_storage_trie_flush"
phaseName AddressStateTrieFlush = "08_address_state_trie_flush"
phaseName StateReceiptValidatorStakingVerification = "09_state_receipt_validator_staking_verification"
phaseName PendingMerkleNodesLevelDBCommit = "10_pending_merkle_nodes_leveldb_commit"
phaseName EventKafkaEnqueue = "11_event_kafka_enqueue"

allPhases :: [Phase]
allPhases = [minBound .. maxBound]

data Sample = Sample
  { sampleWallNS :: !Word64,
    sampleCPUNS :: !Word64,
    sampleAllocatedBytes :: !Word64,
    sampleCount :: !Word64
  }
  deriving (Eq, Show)

instance Semigroup Sample where
  Sample w1 c1 a1 n1 <> Sample w2 c2 a2 n2 =
    Sample (w1 + w2) (c1 + c2) (a1 + a2) (n1 + n2)

instance Monoid Sample where
  mempty = Sample 0 0 0 0

data Snapshot = Snapshot
  { snapshotWallNS :: !Word64,
    snapshotCPUNS :: !Word64,
    snapshotAllocationCounter :: !Int64
  }

data ActiveBlock = ActiveBlock
  { activeBlockNumber :: !Integer,
    activeTransactionCount :: !Int,
    activeStart :: !Snapshot,
    activeDetached :: !Sample,
    activeDetachedDB :: !(M.Map String Word64)
  }

-- Block application is single-threaded. Keep hot, nested phase bookkeeping
-- block-local and merge it into the concurrency-safe run summary once per
-- block. Detached publisher measurements continue to use runtimeState.
data ActiveMeasurements = ActiveMeasurements
  { activeMeasurementMeasured :: !(IORef Sample),
    activeMeasurementPhases :: !(MV.IOVector Word64),
    activeMeasurementSpans :: !(IORef (M.Map Phase [Sample]))
  }

data RuntimeState = RuntimeState
  { runtimeActive :: !(Maybe ActiveBlock),
    runtimeDetached :: !(M.Map Integer (M.Map Phase Sample)),
    runtimeDetachedDB :: !(M.Map Integer (M.Map String Word64)),
    runtimePhaseSamples :: !(M.Map Phase [Sample]),
    runtimePhaseSpans :: !(M.Map Phase [Sample]),
    runtimeResidualSamples :: ![Sample],
    runtimeBlockSamples :: ![Sample],
    runtimeDBTotals :: !(M.Map String Word64),
    runtimeAccountsTouched :: !Word64,
    runtimeStorageKeysTouched :: !Word64,
    runtimeFinalized :: !Bool
  }

emptyRuntimeState :: RuntimeState
emptyRuntimeState = RuntimeState Nothing M.empty M.empty M.empty M.empty [] [] M.empty 0 0 False

{-# NOINLINE profilePath #-}
profilePath :: Maybe FilePath
profilePath = unsafePerformIO $ do
  value <- lookupEnv "VM_PROFILE_PHASES"
  pure $ case value of
    Nothing -> Nothing
    Just "" -> Nothing
    Just "0" -> Nothing
    Just "false" -> Nothing
    Just "False" -> Nothing
    Just "1" -> Just "vm-profile-phases.jsonl"
    Just "true" -> Just "vm-profile-phases.jsonl"
    Just "True" -> Just "vm-profile-phases.jsonl"
    Just path -> Just path

phaseProfileEnabled :: Bool
phaseProfileEnabled = maybe False (const True) profilePath

{-# NOINLINE phaseSpanProfileEnabled #-}
phaseSpanProfileEnabled :: Bool
phaseSpanProfileEnabled = unsafePerformIO $ do
  value <- lookupEnv "VM_PROFILE_PHASE_SPANS"
  pure $ case value of
    Just "1" -> True
    Just "true" -> True
    Just "True" -> True
    _ -> False

{-# NOINLINE runCodeDetailEnabled #-}
runCodeDetailEnabled :: Bool
runCodeDetailEnabled = unsafePerformIO $ do
  value <- lookupEnv "VM_PROFILE_RUN_CODE_DETAIL"
  pure $ phaseSpanProfileEnabled || case value of
    Just "1" -> True
    Just "true" -> True
    Just "True" -> True
    _ -> False

{-# NOINLINE outputHashEnabled #-}
outputHashEnabled :: Bool
outputHashEnabled = unsafePerformIO $ do
  value <- lookupEnv "VM_PROFILE_OUTPUT_HASH"
  pure $ case value of
    Just "1" -> True
    Just "true" -> True
    Just "True" -> True
    _ -> False

data OutputHashState = OutputHashState !(Context SHA256) !Word64 !Word64

data OutputHashSnapshot = OutputHashSnapshot
  { outputHashDigest :: !(Digest SHA256),
    outputSnapshotCount :: !Word64,
    outputSnapshotBytes :: !Word64
  }

{-# NOINLINE outputHashState #-}
outputHashState :: MVar (M.Map String OutputHashState)
outputHashState = unsafePerformIO $ newMVar M.empty

noteProfileOutput :: String -> [B.ByteString] -> IO ()
noteProfileOutput _ _ | not outputHashEnabled = pure ()
noteProfileOutput channel payloads = modifyMVar_ outputHashState $ \states -> do
  let initial = M.findWithDefault (OutputHashState hashInit 0 0) channel states
      updated = foldl' update initial payloads
  pure $ M.insert channel updated states
  where
    update (OutputHashState context count byteCount) payload =
      let frame = BL.toStrict . runPut . putWord64be . fromIntegral $ B.length payload
          context' = hashUpdate (hashUpdate context frame) payload
       in OutputHashState context' (count + 1) (byteCount + fromIntegral (B.length payload))

snapshotOutputHashes :: IO (M.Map String OutputHashSnapshot)
snapshotOutputHashes = withMVar outputHashState $ \states ->
  pure $
    fmap
      (\(OutputHashState context count byteCount) -> OutputHashSnapshot (hashFinalize context) count byteCount)
      states

{-# NOINLINE runtimeState #-}
runtimeState :: MVar RuntimeState
runtimeState = unsafePerformIO $ newMVar emptyRuntimeState

{-# NOINLINE activeMeasurements #-}
activeMeasurements :: IORef (Maybe ActiveMeasurements)
activeMeasurements = unsafePerformIO $ newIORef Nothing

{-# NOINLINE profileHandle #-}
profileHandle :: Maybe Handle
profileHandle = unsafePerformIO $ traverse open profilePath
  where
    open path = do
      handle <- openFile path WriteMode
      hSetBuffering handle $ BlockBuffering (Just $ 1024 * 1024)
      pure handle

readSnapshot :: IO Snapshot
readSnapshot = do
  !wall <- getMonotonicTimeNSec
  !cpuPS <- getCPUTime
  !allocationCounter <- getAllocationCounter
  pure $ Snapshot wall (fromInteger cpuPS `div` 1000) allocationCounter

-- Hot SolidVM child scopes need exact wall/allocation accounting, but reading
-- the process CPU clock at every nested call materially perturbs replay. In
-- low-overhead mode their CPU is intentionally retained by the enclosing
-- call/creation root. Deep-span mode uses readSnapshot for every child.
readWallAllocationSnapshot :: IO Snapshot
readWallAllocationSnapshot = do
  !wall <- getMonotonicTimeNSec
  !allocationCounter <- getAllocationCounter
  pure $ Snapshot wall 0 allocationCounter

snapshotDifference :: Snapshot -> Snapshot -> Sample
snapshotDifference before after =
  Sample
    (differenceWord64 snapshotWallNS)
    (differenceWord64 snapshotCPUNS)
    allocationDifference
    1
  where
    differenceWord64 field =
      let !start = field before
          !end = field after
       in if end >= start then end - start else 0
    allocationDifference =
      let !start = snapshotAllocationCounter before
          !end = snapshotAllocationCounter after
       in if start >= end then fromIntegral (start - end) else 0

boundedSampleDifference :: Sample -> Sample -> Sample
boundedSampleDifference total nested =
  Sample
    (bounded sampleWallNS)
    (bounded sampleCPUNS)
    (bounded sampleAllocatedBytes)
    1
  where
    bounded field =
      let !totalValue = field total
          !nestedValue = field nested
       in if totalValue >= nestedValue then totalValue - nestedValue else 0

data RunCodeKind = ProfileCall | ProfileCreation

{-# NOINLINE activeRunCodeKind #-}
activeRunCodeKind :: IORef (Maybe RunCodeKind)
activeRunCodeKind = unsafePerformIO $ newIORef Nothing

data FunctionSample = FunctionSample
  { functionCalls :: !Word64,
    functionWallNS :: !Word64,
    functionSelfWallNS :: !Word64,
    functionAllocatedBytes :: !Word64,
    functionSelfAllocatedBytes :: !Word64,
    functionStorageReads :: !Word64
  }

instance Semigroup FunctionSample where
  FunctionSample c1 w1 s1 a1 sa1 r1 <> FunctionSample c2 w2 s2 a2 sa2 r2 =
    FunctionSample (c1 + c2) (w1 + w2) (s1 + s2) (a1 + a2) (sa1 + sa2) (r1 + r2)

instance Monoid FunctionSample where
  mempty = FunctionSample 0 0 0 0 0 0

{-# NOINLINE functionProfileEnabled #-}
functionProfileEnabled :: Bool
functionProfileEnabled = unsafePerformIO $ do
  value <- lookupEnv "VM_PROFILE_FUNCTION_DETAIL"
  pure $ case value of
    Just "1" -> True
    Just "true" -> True
    Just "True" -> True
    _ -> False

{-# NOINLINE activeFunctionStack #-}
activeFunctionStack :: IORef [(String, Word64, Word64)]
activeFunctionStack = unsafePerformIO $ newIORef []

{-# NOINLINE functionProfileTotals #-}
functionProfileTotals :: IORef (M.Map String FunctionSample)
functionProfileTotals = unsafePerformIO $ newIORef M.empty

-- | Diagnostic-only inclusive timing by SolidVM contract/function. This is
-- separate from mutually-exclusive phase accounting: nested function times
-- overlap, while reads are attributed to the innermost active function.
profileRunCodeFunction :: MonadUnliftIO m => String -> m a -> m a
profileRunCodeFunction _ action | not functionProfileEnabled = action
profileRunCodeFunction label action = withRunInIO $ \runInIO ->
  bracket
    (do
      startWall <- getMonotonicTimeNSec
      startAllocation <- getAllocationCounter
      modifyIORef' activeFunctionStack ((label, 0, 0) :)
      pure (startWall, startAllocation))
    (\(startWall, startAllocation) -> do
      end <- getMonotonicTimeNSec
      endAllocation <- getAllocationCounter
      let !elapsed = end - startWall
          !allocated =
            if startAllocation >= endAllocation
              then fromIntegral (startAllocation - endAllocation)
              else 0
      (childWall, childAllocated) <- atomicModifyIORef' activeFunctionStack $ \case
        [] -> ([], (0, 0))
        (_, childW, childA) : [] -> ([], (childW, childA))
        (_, childW, childA) : (parent, parentChildrenW, parentChildrenA) : rest ->
          ( (parent, parentChildrenW + elapsed, parentChildrenA + allocated) : rest,
            (childW, childA)
          )
      let !selfWall = elapsed - min elapsed childWall
          !selfAllocated = allocated - min allocated childAllocated
          !sample = FunctionSample 1 elapsed selfWall allocated selfAllocated 0
      modifyIORef' functionProfileTotals $ M.insertWith (<>) label sample)
    (const $ runInIO action)

noteRunCodeStorageRead :: MonadIO m => m ()
noteRunCodeStorageRead
  | not functionProfileEnabled = pure ()
  | otherwise = liftIO $ do
      stack <- readIORef activeFunctionStack
      case stack of
        [] -> pure ()
        (label, _, _) : _ ->
          modifyIORef' functionProfileTotals $
            M.insertWith (<>) label (FunctionSample 0 0 0 0 0 1)

-- | Establish the only scope in which SolidVM internals count as phase 4.
-- Rewards, decide/payFees, and JSON-RPC calls also enter SolidVM.call, but they
-- belong to their own top-level phases and must not leak into runCode totals.
profileRunCodeTransaction :: MonadUnliftIO m => Bool -> m a -> m a
profileRunCodeTransaction _ action | not phaseProfileEnabled = action
profileRunCodeTransaction isCreation action = withRunInIO $ \runInIO ->
  bracket
    (atomicModifyIORef' activeRunCodeKind $ \old -> (Just kind, old))
    (writeIORef activeRunCodeKind)
    (\_ -> runInIO $ profilePhase rootPhase action)
  where
    kind = if isCreation then ProfileCreation else ProfileCall
    rootPhase = if isCreation then RunCodeCreation else RunCodeCall

-- | Measure a mutually-exclusive child of the active runCode transaction.
-- Outside that scope this is deliberately a no-op.
profileRunCodeChild :: MonadIO m => Phase -> Phase -> m a -> m a
profileRunCodeChild _ _ action | not phaseProfileEnabled = action
profileRunCodeChild _ _ action | not runCodeDetailEnabled = action
profileRunCodeChild callPhase creationPhase action = do
  kind <- liftIO $ readIORef activeRunCodeKind
  case kind of
    Nothing -> action
    Just ProfileCall -> profileChild callPhase action
    Just ProfileCreation -> profileChild creationPhase action
  where
    profileChild =
      if phaseSpanProfileEnabled
        then profilePhase
        else profilePhaseWith readWallAllocationSnapshot

-- | Diagnostic variant that evaluates the returned value completely while
-- the child timer is active. The ordinary production path preserves its
-- existing laziness when detailed profiling is disabled.
profileRunCodeChildForced :: (MonadIO m, NFData a) => Phase -> Phase -> m a -> m a
profileRunCodeChildForced _ _ action | not phaseProfileEnabled = action
profileRunCodeChildForced _ _ action | not runCodeDetailEnabled = action
profileRunCodeChildForced callPhase creationPhase action = do
  kind <- liftIO $ readIORef activeRunCodeKind
  case kind of
    Nothing -> action
    Just ProfileCall -> profileChild callPhase action
    Just ProfileCreation -> profileChild creationPhase action
  where
    profileChild phase action' =
      (if phaseSpanProfileEnabled then profilePhase else profilePhaseWith readWallAllocationSnapshot) phase $ do
        result <- action'
        liftIO $ evaluate $ force result

{-# NOINLINE activeStatementDepth #-}
activeStatementDepth :: IORef Int
activeStatementDepth = unsafePerformIO $ newIORef 0

-- | Establish the scope in which storage and builtin work belongs to contract
-- statement execution. Nested calls increment the depth, so their exclusive
-- children still reconcile under the outer runCode transaction.
profileRunCodeStatement :: MonadUnliftIO m => Phase -> Phase -> m a -> m a
profileRunCodeStatement _ _ action | not phaseProfileEnabled = action
profileRunCodeStatement _ _ action | not runCodeDetailEnabled = action
profileRunCodeStatement callPhase creationPhase action = withRunInIO $ \runInIO ->
  bracket
    (atomicModifyIORef' activeStatementDepth $ \depth -> (depth + 1, ()))
    (const $ atomicModifyIORef' activeStatementDepth $ \depth -> (max 0 (depth - 1), ()))
    (const $ runInIO $ profileRunCodeChild callPhase creationPhase action)

-- | Attribute a mutually-exclusive child only while executing statements.
-- This avoids labeling storage used by argument preparation or dispatch as
-- statement work.
profileRunCodeStatementChild :: MonadIO m => Phase -> Phase -> m a -> m a
profileRunCodeStatementChild _ _ action | not phaseProfileEnabled = action
profileRunCodeStatementChild _ _ action | not runCodeDetailEnabled = action
profileRunCodeStatementChild callPhase creationPhase action = do
  depth <- liftIO $ readIORef activeStatementDepth
  if depth > 0
    then profileRunCodeChild callPhase creationPhase action
    else action

addPhase :: Phase -> Sample -> M.Map Phase Sample -> M.Map Phase Sample
addPhase phase sample = M.insertWith (<>) phase sample

phaseCounterStride :: Int
phaseCounterStride = 4

phaseCounterLength :: Int
phaseCounterLength = length allPhases * phaseCounterStride

phaseCounterBase :: Phase -> Int
phaseCounterBase phase = fromEnum phase * phaseCounterStride

newActiveMeasurements :: Sample -> M.Map Phase Sample -> IO ActiveMeasurements
newActiveMeasurements measured phases = do
  measuredRef <- newIORef measured
  counters <- MV.replicate phaseCounterLength 0
  forM_ (M.toList phases) $ uncurry (addPhaseCounters counters)
  spansRef <- newIORef $
    if phaseSpanProfileEnabled then M.map (: []) phases else M.empty
  pure $ ActiveMeasurements measuredRef counters spansRef

addPhaseCounters :: MV.IOVector Word64 -> Phase -> Sample -> IO ()
addPhaseCounters counters phase sample = do
  add 0 $ sampleWallNS sample
  add 1 $ sampleCPUNS sample
  add 2 $ sampleAllocatedBytes sample
  add 3 $ sampleCount sample
  where
    base = phaseCounterBase phase
    add offset value = do
      old <- MV.unsafeRead counters (base + offset)
      MV.unsafeWrite counters (base + offset) $! old + value

readPhaseCounters :: MV.IOVector Word64 -> Phase -> IO Sample
readPhaseCounters counters phase = do
  wall <- MV.unsafeRead counters base
  cpu <- MV.unsafeRead counters (base + 1)
  allocated <- MV.unsafeRead counters (base + 2)
  count <- MV.unsafeRead counters (base + 3)
  pure $ Sample wall cpu allocated count
  where
    base = phaseCounterBase phase

readAllPhaseCounters :: MV.IOVector Word64 -> IO (M.Map Phase Sample)
readAllPhaseCounters counters =
  M.fromList <$> mapM readOne allPhases
  where
    readOne phase = do
      sample <- readPhaseCounters counters phase
      pure (phase, sample)

profilePhase :: MonadIO m => Phase -> m a -> m a
profilePhase _ action | not phaseProfileEnabled = action
profilePhase phase action = profilePhaseWith readSnapshot phase action

profilePhaseWith :: MonadIO m => IO Snapshot -> Phase -> m a -> m a
profilePhaseWith readPhaseSnapshot phase action = do
  activeBefore <- liftIO $ readIORef activeMeasurements
  case activeBefore of
    Nothing -> action
    Just measurements -> do
      measuredBefore <- liftIO $ readIORef (activeMeasurementMeasured measurements)
      before <- liftIO readPhaseSnapshot
      result <- action
      after <- liftIO readPhaseSnapshot
      measuredAfter <- liftIO $ readIORef (activeMeasurementMeasured measurements)
      let !inclusive = snapshotDifference before after
          !nested = boundedSampleDifference measuredAfter measuredBefore
          !sample = boundedSampleDifference inclusive nested
      liftIO $ do
        modifyIORef' (activeMeasurementMeasured measurements) (<> sample)
        addPhaseCounters (activeMeasurementPhases measurements) phase sample
        when phaseSpanProfileEnabled $
          modifyIORef' (activeMeasurementSpans measurements) $
            M.insertWith (++) phase [sample]
      pure result

profileDetachedPhase :: MonadIO m => Integer -> Phase -> m a -> m a
profileDetachedPhase _ _ action | not phaseProfileEnabled = action
profileDetachedPhase blockNumber phase action = do
  before <- liftIO readSnapshot
  dbBefore <- liftIO snapshotDBProfile
  result <- action
  after <- liftIO readSnapshot
  dbAfter <- liftIO snapshotDBProfile
  let !sample = snapshotDifference before after
      !dbDelta =
        M.mergeWithKey
          (\_ end start -> Just $ end - start)
          id
          (const M.empty)
          (dbProfileCounters dbAfter)
          (dbProfileCounters dbBefore)
  liftIO . modifyMVar_ runtimeState $ \s ->
    let phases = M.findWithDefault M.empty blockNumber (runtimeDetached s)
        detached' = M.insert blockNumber (addPhase phase sample phases) (runtimeDetached s)
        counters = M.findWithDefault M.empty blockNumber (runtimeDetachedDB s)
        detachedDB' = M.insert blockNumber (M.unionWith (+) counters dbDelta) (runtimeDetachedDB s)
     in pure s {runtimeDetached = detached', runtimeDetachedDB = detachedDB'}
  pure result

beginProfileBlock :: MonadIO m => Integer -> Int -> m ()
beginProfileBlock _ _ | not phaseProfileEnabled = pure ()
beginProfileBlock blockNumber txCount = liftIO $ do
  resetDBProfile
  start <- readSnapshot
  modifyMVar_ runtimeState $ \s -> do
    when (isJust $ runtimeActive s) $
      ioError $ userError "VM phase profiler: attempted to begin a block while another block is active"
    let detachedPhases = M.findWithDefault M.empty blockNumber (runtimeDetached s)
        detachedTotal = mconcat $ M.elems detachedPhases
        detachedDB = M.findWithDefault M.empty blockNumber (runtimeDetachedDB s)
        active =
          ActiveBlock
            { activeBlockNumber = blockNumber,
              activeTransactionCount = txCount,
              activeStart = start,
              activeDetached = detachedTotal,
              activeDetachedDB = detachedDB
            }
    measurements <- newActiveMeasurements detachedTotal detachedPhases
    writeIORef activeMeasurements $ Just measurements
    pure
      s
        { runtimeActive = Just active,
          runtimeDetached = M.delete blockNumber (runtimeDetached s),
          runtimeDetachedDB = M.delete blockNumber (runtimeDetachedDB s)
        }

endProfileBlock :: MonadIO m => m ()
endProfileBlock =
  if not phaseProfileEnabled
    then pure ()
    else liftIO $ do
      end <- readSnapshot
      dbSnapshot <- snapshotDBProfile
      measurementsMaybe <- readIORef activeMeasurements
      measurements <- case measurementsMaybe of
        Nothing -> ioError $ userError "VM phase profiler: active block has no measurements"
        Just value -> pure value
      measured <- readIORef $ activeMeasurementMeasured measurements
      phases <- readAllPhaseCounters $ activeMeasurementPhases measurements
      phaseSpans <- readIORef $ activeMeasurementSpans measurements
      blockValue <- modifyMVar runtimeState $ \s ->
        case runtimeActive s of
          Nothing -> ioError $ userError "VM phase profiler: attempted to end a block with none active"
          Just active -> do
            let activeSample = snapshotDifference (activeStart active) end
                detached = activeDetached active
                total =
                  Sample
                    (sampleWallNS activeSample + sampleWallNS detached)
                    (sampleCPUNS activeSample + sampleCPUNS detached)
                    (sampleAllocatedBytes activeSample + sampleAllocatedBytes detached)
                    1
                residual =
                  Sample
                    (boundedResidual sampleWallNS total measured)
                    (boundedResidual sampleCPUNS total measured)
                    (boundedResidual sampleAllocatedBytes total measured)
                    0
                accounted = measured <> residual
                phaseSamples' =
                  foldr
                    (\phase -> M.insertWith (++) phase [M.findWithDefault mempty phase phases])
                    (runtimePhaseSamples s)
                    allPhases
                phaseSpans' =
                  if phaseSpanProfileEnabled
                    then M.unionWith (++) phaseSpans (runtimePhaseSpans s)
                    else runtimePhaseSpans s
                blockDB = M.unionWith (+) (activeDetachedDB active) (dbProfileCounters dbSnapshot)
                dbTotals' = M.unionWith (+) (runtimeDBTotals s) blockDB
                state' =
                  s
                    { runtimeActive = Nothing,
                      runtimePhaseSamples = phaseSamples',
                      runtimePhaseSpans = phaseSpans',
                      runtimeResidualSamples = residual : runtimeResidualSamples s,
                      runtimeBlockSamples = total : runtimeBlockSamples s,
                      runtimeDBTotals = dbTotals',
                      runtimeAccountsTouched = runtimeAccountsTouched s + fromIntegral (dbProfileAccountsTouched dbSnapshot),
                      runtimeStorageKeysTouched = runtimeStorageKeysTouched s + fromIntegral (dbProfileStorageKeysTouched dbSnapshot)
                    }
                value = blockJSON active total measured accounted residual phases blockDB dbSnapshot
            pure (state', value)
      writeIORef activeMeasurements Nothing
      writeJSONLine blockValue
  where
    boundedResidual field total measured =
      let !totalValue = field total
          !measuredValue = field measured
       in if totalValue >= measuredValue then totalValue - measuredValue else 0

blockJSON :: ActiveBlock -> Sample -> Sample -> Sample -> Sample -> M.Map Phase Sample -> M.Map String Word64 -> DBProfileSnapshot -> JSON.Value
blockJSON active total measured accounted residual phases blockDB dbSnapshot =
  JSON.object
    [ "type" .= ("block" :: String),
      "block" .= activeBlockNumber active,
      "transactions" .= activeTransactionCount active,
      "wall_ns" .= sampleWallNS total,
      "cpu_ns" .= sampleCPUNS total,
      "allocated_bytes" .= sampleAllocatedBytes total,
      "phase_wall_ns" .= phaseObject sampleWallNS phases,
      "phase_cpu_ns" .= phaseObject sampleCPUNS phases,
      "phase_allocated_bytes" .= phaseObject sampleAllocatedBytes phases,
      "phase_counts" .= phaseObject sampleCount phases,
      "unattributed_residual" .= sampleJSON residual,
      "reconciliation" .=
        JSON.object
          [ "measured_wall_ns_before_residual" .= sampleWallNS measured,
            "accounted_wall_ns" .= sampleWallNS accounted,
            "wall_error_ns" .= signedDifference (sampleWallNS total) (sampleWallNS accounted),
            "measured_cpu_ns_before_residual" .= sampleCPUNS measured,
            "accounted_cpu_ns" .= sampleCPUNS accounted,
            "cpu_error_ns" .= signedDifference (sampleCPUNS total) (sampleCPUNS accounted),
            "measured_allocated_bytes_before_residual" .= sampleAllocatedBytes measured,
            "accounted_allocated_bytes" .= sampleAllocatedBytes accounted,
            "allocated_bytes_error" .= signedDifference (sampleAllocatedBytes total) (sampleAllocatedBytes accounted)
          ],
      "accounts_touched" .= dbProfileAccountsTouched dbSnapshot,
      "storage_keys_touched" .= dbProfileStorageKeysTouched dbSnapshot,
      "db" .= stringMapObject blockDB
    ]

sampleJSON :: Sample -> JSON.Value
sampleJSON sample =
  JSON.object
    [ "wall_ns" .= sampleWallNS sample,
      "cpu_ns" .= sampleCPUNS sample,
      "allocated_bytes" .= sampleAllocatedBytes sample,
      "count" .= sampleCount sample
    ]

signedDifference :: Word64 -> Word64 -> Integer
signedDifference left right = toInteger left - toInteger right

phaseObject :: (Sample -> Word64) -> M.Map Phase Sample -> JSON.Value
phaseObject field samples =
  JSON.object
    [ Key.fromString (phaseName phase) .= field (M.findWithDefault mempty phase samples)
    | phase <- allPhases
    ]

stringMapObject :: M.Map String Word64 -> JSON.Value
stringMapObject values =
  JSON.object [Key.fromString key .= value | (key, value) <- M.toAscList values]

writeJSONLine :: JSON.Value -> IO ()
writeJSONLine value = forMHandle $ \handle -> do
  BL8.hPutStr handle $ JSON.encode value
  BL8.hPutStr handle "\n"

forMHandle :: (Handle -> IO ()) -> IO ()
forMHandle action = maybe (pure ()) action profileHandle

finalizePhaseProfile :: IO ()
finalizePhaseProfile =
  if not phaseProfileEnabled
    then pure ()
    else do
      outputHashes <- snapshotOutputHashes
      functionTotals <- readIORef functionProfileTotals
      summary <- modifyMVar runtimeState $ \s -> do
        when (isJust $ runtimeActive s) $
          ioError $ userError "VM phase profiler: finalizing while a block is active"
        if runtimeFinalized s
          then pure (s, Nothing)
          else pure (s {runtimeFinalized = True}, Just $ summaryJSON outputHashes functionTotals s)
      traverseMaybe_ writeJSONLine summary
      forMHandle $ \handle -> hFlush handle >> hClose handle

summaryJSON :: M.Map String OutputHashSnapshot -> M.Map String FunctionSample -> RuntimeState -> JSON.Value
summaryJSON outputHashes functionTotals s =
  JSON.object
    [ "type" .= ("summary" :: String),
      "phase_spans_enabled" .= phaseSpanProfileEnabled,
      "run_code_detail_enabled" .= runCodeDetailEnabled,
      "function_detail_enabled" .= functionProfileEnabled,
      "run_code_child_cpu_enabled" .= phaseSpanProfileEnabled,
      "blocks" .= length (runtimeBlockSamples s),
      "total" .= distributionJSON (runtimeBlockSamples s),
      "unattributed_residual" .= distributionJSON (runtimeResidualSamples s),
      "phases" .=
        JSON.object
          [ Key.fromString (phaseName phase)
              .= distributionJSON (M.findWithDefault [] phase $ runtimePhaseSamples s)
          | phase <- allPhases
          ],
      "phase_spans" .=
        JSON.object
          [ Key.fromString (phaseName phase)
              .= distributionJSON (M.findWithDefault [] phase $ runtimePhaseSpans s)
          | phase <- allPhases
          ],
      "db" .= stringMapObject (runtimeDBTotals s),
      "output_hashes" .= outputHashesJSON outputHashes,
      "functions" .= functionTotalsJSON functionTotals,
      "accounts_touched_sum" .= runtimeAccountsTouched s,
      "storage_keys_touched_sum" .= runtimeStorageKeysTouched s
    ]

functionTotalsJSON :: M.Map String FunctionSample -> JSON.Value
functionTotalsJSON totals =
  JSON.object
    [ Key.fromString label
        .= JSON.object
          [ "calls" .= functionCalls sample,
            "inclusive_wall_ns" .= functionWallNS sample,
            "self_wall_ns" .= functionSelfWallNS sample,
            "inclusive_allocated_bytes" .= functionAllocatedBytes sample,
            "self_allocated_bytes" .= functionSelfAllocatedBytes sample,
            "storage_reads" .= functionStorageReads sample
          ]
    | (label, sample) <- M.toAscList totals
    ]

outputHashesJSON :: M.Map String OutputHashSnapshot -> JSON.Value
outputHashesJSON hashes =
  JSON.object
    [ Key.fromString channel
        .= JSON.object
          [ "sha256" .= show (outputHashDigest snapshot),
            "messages" .= outputSnapshotCount snapshot,
            "bytes" .= outputSnapshotBytes snapshot
          ]
    | (channel, snapshot) <- M.toAscList hashes
    ]

distributionJSON :: [Sample] -> JSON.Value
distributionJSON samples =
  JSON.object
    [ "count" .= length samples,
      "span_count" .= sum (map sampleCount samples),
      "wall_ns" .= percentiles sampleWallNS samples,
      "cpu_ns" .= percentiles sampleCPUNS samples,
      "allocated_bytes" .= percentiles sampleAllocatedBytes samples
    ]

percentiles :: (Sample -> Word64) -> [Sample] -> JSON.Value
percentiles field samples =
  let values = sort $ map field samples
   in JSON.object
        [ "p50" .= quantile 0.50 values,
          "p90" .= quantile 0.90 values,
          "p99" .= quantile 0.99 values,
          "max" .= fromMaybe 0 (safeLast values),
          "sum" .= sum values
        ]

quantile :: Double -> [Word64] -> Word64
quantile _ [] = 0
quantile probability values =
  let !count = length values
      !index = max 0 $ min (count - 1) (ceiling (probability * fromIntegral count) - 1)
   in values !! index

safeLast :: [a] -> Maybe a
safeLast [] = Nothing
safeLast values = Just $ last values

traverseMaybe_ :: Applicative f => (a -> f b) -> Maybe a -> f ()
traverseMaybe_ _ Nothing = pure ()
traverseMaybe_ f (Just value) = () <$ f value
