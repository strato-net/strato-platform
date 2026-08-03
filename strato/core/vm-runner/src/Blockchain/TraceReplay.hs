{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

-- | strato_traceTransaction / strato_traceBlock* execution: replay a block's
-- transactions against its parent state inside a sandbox, tracing the target
-- transaction (or all of them).
--
-- This lives outside Blockchain.JsonRpcCommand because the replay needs
-- Blockchain.BlockChain (addTransaction), which itself imports
-- Blockchain.JsonRpcCommand.
module Blockchain.TraceReplay
  ( runJsonRpcCommandTraced,
  )
where

import BlockApps.Logging
import Blockchain.BlockChain (addTransaction, recoverProposer)
import Blockchain.DB.ChainDB (getChainStateRoot, putBlockHeaderInChainDB)
import Blockchain.Data.BlockHeader (BlockHeader, getBlockGasLimit, parentHash)
import Blockchain.Data.VmTrace (cfTo, newVmTracer, takeTraceRoots, VmTracer)
import Blockchain.Data.ExecResults (calculateReturned)
import Blockchain.Data.TransactionDef (Transaction)
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.JsonRpcCommand (runJsonRpcCommandSandboxed, traceToJson)
import Blockchain.MemVMContext (MemContextM, VMType (..), evalSandboxedContextM)
import Blockchain.Model.WrappedBlock (OutputTx (..), wrapIngestBlockTransaction)
import Blockchain.Sequencer.CallSpec (TraceOptions (..))
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex)
import Blockchain.VMContext (CurrentBlockHash (..), VMBase)
import Control.Monad (when)
import Control.Monad.Trans.Except (runExceptT)
import qualified Control.Monad.Change.Modify as Mod
import qualified Data.Aeson as Aeson
import Data.Aeson ((.=))
import qualified Data.ByteString.Lazy as BL
import Data.Maybe (mapMaybe)
import qualified Data.Text as T
import Prelude hiding (id)
import Prometheus (MonadMonitor)
import Text.Format (format)

-- | Like runJsonRpcCommandSandboxed, but additionally handles the
-- block-replay trace command, which needs the block-processing machinery.
runJsonRpcCommandTraced :: forall m. (VMBase m, MonadMonitor m) => JsonRpcCommand -> m JsonRpcResponse
runJsonRpcCommandTraced (JRCTraceBlockTxs header txs mTarget opts id) =
  evalSandboxedContextM (traceBlockTxs header txs mTarget opts id :: MemContextM 'Sandboxed m JsonRpcResponse)
runJsonRpcCommandTraced c = runJsonRpcCommandSandboxed c

traceBlockTxs ::
  (VMBase m, MonadMonitor m) =>
  BlockHeader ->
  [Transaction] ->
  Maybe Keccak256 ->
  TraceOptions ->
  String ->
  m JsonRpcResponse
traceBlockTxs header txs mTarget opts id = do
  let bh = blockHeaderHash header
  case recoverProposer header of
    Left err -> return $ Error id err
    Right proposer ->
      getChainStateRoot Nothing (parentHash header) >>= \case
        Nothing ->
          return . Error id $
            "parent state not available for block " ++ format (parentHash header)
        Just _ -> do
          -- Anchor this block at its parent's post-state root; all writes stay
          -- in the sandbox overlay.
          putBlockHeaderInChainDB header
          Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash bh)
          let otxs = mapMaybe (wrapIngestBlockTransaction bh) txs
              dropped = length txs - length otxs
          when (dropped > 0) $
            $logWarnS "traceBlockTxs" . T.pack $
              "dropped " ++ show dropped ++ " tx(s) with unrecoverable signatures"
          results <- go proposer (getBlockGasLimit header) otxs []
          return $ case mTarget of
            Just target -> case lookup target results of
              Just v -> SuccessJson id . BL.toStrict $ Aeson.encode v
              Nothing -> Error id $ "transaction not found in block: " ++ format target
            Nothing ->
              SuccessJson id . BL.toStrict . Aeson.encode $
                [ Aeson.object ["txHash" .= ("0x" ++ keccak256ToHex h), "result" .= v]
                  | (h, v) <- results
                ]
  where
    go _ _ [] acc = pure (reverse acc)
    go proposer remGas (t : rest) acc = do
      let wantTrace = maybe True (== otHash t) mTarget
      mTracer <-
        if wantTrace
          then Just <$> newVmTracer (traceStatements opts)
          else pure Nothing
      Mod.put (Mod.Proxy @(Maybe VmTracer)) mTracer
      eRes <- runExceptT $ addTransaction header remGas t proposer
      Mod.put (Mod.Proxy @(Maybe VmTracer)) Nothing
      acc' <- case mTracer of
        Nothing -> pure acc
        Just tracer -> do
          (roots, truncated) <- takeTraceRoots tracer
          -- Drop the fee-payment frames (decide() on the 0xDEC1DE system
          -- contract) that precede every transaction's own execution.
          let mainRoots = filter ((/= Address 0xDEC1DE) . cfTo) roots
          pure $ (otHash t, traceToJson truncated mainRoots) : acc
      if mTarget == Just (otHash t)
        then pure (reverse acc')
        else do
          let remGas' = case eRes of
                Left _ -> remGas
                Right er -> remGas - (TD.gasLimit (otBaseTx t) - calculateReturned (otBaseTx t) er)
          go proposer remGas' rest acc'
