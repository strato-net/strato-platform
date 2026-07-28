{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

-- | POST /transaction/simulate: dry-run transactions in the node's VM
-- sandbox. Accepts the same body as POST /transaction and marshals it with
-- the same helpers, so a simulation executes exactly what a post would —
-- but nothing is signed, nonced, or committed.
module Bloc.Server.Simulate
  ( postBlocTransactionSimulate,
  )
where

import Bloc.API.Transaction
import Bloc.API.Users (BlocTransactionData (..), BlocTransactionStatus (..), UploadContractDetails (..))
import Bloc.API.Utils (TxParams (..))
import Bloc.Database.Queries (getContractWithCodeCollectionByAddress, withCodeCollectionCache)
import Bloc.Monad (HasBlocEnv, getBlocEnv)
import qualified Bloc.Monad
import Bloc.Server.JsonRpc (jsonRpcCall)
import Bloc.Server.TransactionResult (getReturnTypes)
import Bloc.Server.Transaction
  ( checkIsSynced,
    marshalCreatePayload,
    marshalFunctionArgs,
    marshalInnerCallArgs,
    mergeTxParams,
    resolveUserWalletAddress,
    vaultGetPub,
    walletWrapCall,
    walletWrapCreate,
  )
import BlockApps.Logging
import BlockApps.Solidity.ArgValue (ArgValue)
import BlockApps.SolidityVarReader (svmValueToSolidityValues)
import Blockchain.DB.CodeDB (HasCodeDB)
import Blockchain.Data.AddressStateDB
import Blockchain.Data.DataDefs
import Blockchain.Sequencer.CallSpec (CallSpec (..), TxCreateObject (..), TxFuncCallObject (..))
import Blockchain.Strato.Model.Address (Address, fromPublicKey, stringAddress)
import Blockchain.Strato.Model.Gas (Gas (..))
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Blockchain.Model.SyncState (BestBlock, WorldBestBlock)
import Blockchain.SyncDB (SyncStatus)
import Control.Lens ((^.))
import Control.Monad (forM, unless, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Data.Aeson ((.=))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.Types as Aeson
import Data.Foldable (toList)
import qualified Data.Map.Strict as M
import Data.Map.Strict (Map)
import Data.Maybe (fromMaybe, isJust)
import Data.Source.Map (SourceMap, serializeSourceMap)
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Read as TR
import Handlers.AccountInfo (AccountsFilterParams)
import Handlers.Storage (StorageAddress, StorageFilterParams)
import Numeric (showHex)
import SQLM (ApiError (..))
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.Contract (functions)
import qualified SolidVM.Model.Value as SMV
import Text.Format (format)
import UnliftIO

-- What one payload simulates as, and how to shape its result.
data SimKind
  = SimCreate Text -- contract name → Upload result
  | SimCall Address Text -- target + function → Call result via return types

data SimPlan = SimPlan
  { simSpec :: CallSpec,
    simKind :: SimKind
  }

-- Per-call output of eth_simulateV1 (see vm-runner's simulateOne).
data VmCallResult = VmCallResult
  { vcrStatus :: Text,
    vcrGasUsed :: Text,
    vcrLogs :: [SimulatedEvent],
    vcrError :: Maybe Text,
    vcrReturnValue :: Maybe Aeson.Value,
    vcrCreatedAddress :: Maybe Text
  }

instance Aeson.FromJSON VmCallResult where
  parseJSON = Aeson.withObject "simulate call result" $ \o -> do
    status <- o Aeson..: "status"
    gasUsed <- o Aeson..: "gasUsed"
    logs <- o Aeson..:? "logs" Aeson..!= []
    mErr <- o Aeson..:? "error"
    mMsg <- case mErr of
      Nothing -> pure Nothing
      Just eo -> Just <$> Aeson.withObject "error" (Aeson..: "message") eo
    retVal <- o Aeson..:? "returnValue"
    created <- o Aeson..:? "createdAddress"
    pure $ VmCallResult status gasUsed logs mMsg retVal created

postBlocTransactionSimulate ::
  ( MonadUnliftIO m,
    MonadLogger m,
    Mod.Accessible (Maybe SyncStatus) m,
    Mod.Accessible (Maybe BestBlock) m,
    Mod.Accessible (Maybe WorldBestBlock) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m,
    HasCodeDB m,
    HasBlocEnv m
  ) =>
  Maybe Text -> -- optional X-USER-ACCESS-TOKEN
  Maybe String -> -- username: route through the user's User wallet contract
  Maybe Text -> -- chainid: rejected, simulation is main-chain only
  Bool -> -- trace: include a debug_traceCall frame tree (single-tx bodies)
  PostBlocTransactionRequest ->
  m [BlocSimulateResult]
postBlocTransactionSimulate mToken mUsername mChainId trace (PostBlocTransactionRequest mAddr txs' txParams msrcs) = withCodeCollectionCache $ do
  when (isJust mChainId) . throwIO $
    UserError "simulation is main-chain only; omit the chainid parameter"
  checkIsSynced
  addr <- case (mAddr, mToken) of
    (Just addr', _) -> return addr'
    (Nothing, Just token) -> fromPublicKey <$> vaultGetPub token
    (Nothing, Nothing) -> throwIO $ UserError "provide an address in the body or authenticate"
  when (trace && length txs' /= 1) . throwIO $
    UserError "trace is supported for single-transaction bodies only"
  let useWallet = maybe False (not . null) mUsername
  userContractAddr <- case (useWallet, mUsername) of
    (True, Just u) -> resolveUserWalletAddress u
    _ -> pure addr
  env <- getBlocEnv
  let url = Bloc.Monad.vmJsonRpcUrl env
      envGasLimit = Bloc.Monad.gasLimit env
      hexGas mp = Text.pack $ case txparamsGasLimit =<< mp of
        Just (Gas g) -> "0x" ++ showHex g ""
        Nothing -> "0x" ++ showHex envGasLimit ""
      mkFuncCall to' fn args gasTxt =
        SpecFuncCall
          TxFuncCallObject
            { funcCallFrom = addr,
              funcCallTo = to',
              funcCallGas = gasTxt,
              funcCallValue = "0x0",
              funcCallFunctionName = fn,
              funcCallArgs = args
            }

  -- Bound the number of concurrent simulations so they cannot starve
  -- block processing on the shared VM; excess requests are shed (503).
  withSimSlot env $ do
    -- One plan per payload, preserving body order (sandbox state accumulates
    -- across calls). Marshaling failures become per-tx Failure results rather
    -- than failing the whole request.
    plans <- forM txs' $ \tx -> try @_ @ApiError $ case tx of
      BlocTransfer _ ->
        throwIO $ Unimplemented "TRANSFER payloads are not simulatable; use a FUNCTION transfer on the token contract"
      BlocContract p
        | useWallet -> do
            (cn, contractSrc, _, ctorLits) <- marshalCreatePayload msrcs p
            outer <-
              marshalOuterCall userContractAddr "createContract" $
                walletWrapCreate cn contractSrc ctorLits
            pure $
              SimPlan
                (mkFuncCall userContractAddr "createContract" outer (hexGas $ mergeTxParams (contractpayloadTxParams p) txParams))
                (SimCall userContractAddr "createContract")
        | otherwise -> do
            (cn, contractSrc, _, ctorLits) <- marshalCreatePayload msrcs p
            pure $
              SimPlan
                ( SpecCreate
                    TxCreateObject
                      { createFrom = addr,
                        createGas = hexGas $ mergeTxParams (contractpayloadTxParams p) txParams,
                        createValue = "0x0",
                        createContractName = cn,
                        createSource = serializeSourceMap contractSrc,
                        createArgs = ctorLits
                      }
                )
                (SimCreate cn)
      BlocFunction p
        | useWallet && userContractAddr /= functionpayloadContractAddress p -> do
            inner <- marshalInnerCallArgs (functionpayloadContractAddress p) (functionpayloadMethod p) (functionpayloadArgs p)
            outer <-
              marshalOuterCall userContractAddr "callContract" $
                walletWrapCall (functionpayloadContractAddress p) (functionpayloadMethod p) inner
            pure $
              SimPlan
                (mkFuncCall userContractAddr "callContract" outer (hexGas $ mergeTxParams (functionpayloadTxParams p) txParams))
                (SimCall userContractAddr "callContract")
        | otherwise -> do
            args' <- marshalOuterCall (functionpayloadContractAddress p) (functionpayloadMethod p) (functionpayloadArgs p)
            pure $
              SimPlan
                (mkFuncCall (functionpayloadContractAddress p) (functionpayloadMethod p) args' (hexGas $ mergeTxParams (functionpayloadTxParams p) txParams))
                (SimCall (functionpayloadContractAddress p) (functionpayloadMethod p))

    let specs = [simSpec pl | Right pl <- plans]
    vmCalls <-
      if null specs
        then pure []
        else
          jsonRpcCall
            url
            "eth_simulateV1"
            [ Aeson.object ["blockStateCalls" .= [Aeson.object ["calls" .= specs]]],
              Aeson.String "latest"
            ]
            >>= \case
              Left err -> throwIO . VMError $ "simulation failed: " <> err
              Right v -> case Aeson.parseEither parseSimBlocks v of
                Left perr -> throwIO . VMError . Text.pack $ "unexpected simulation response: " ++ perr
                Right calls -> pure calls

    mTraceVal <-
      if trace
        then case specs of
          [spec] ->
            jsonRpcCall url "debug_traceCall" [Aeson.toJSON spec, Aeson.String "latest", Aeson.object ["statements" .= False]] >>= \case
              Left err -> do
                $logWarnS "simulate/trace" $ "debug_traceCall failed: " <> err
                pure Nothing
              Right v -> pure $ Just v
          _ -> pure Nothing
        else pure Nothing

    results <- zipPlans plans vmCalls
    pure $ case (mTraceVal, results) of
      (Just tv, [r]) -> [r {blocsimulateTrace = Just tv}]
      _ -> results
  where
    zipPlans [] _ = pure []
    zipPlans (Left apiErr : rest) vms = (failureResult apiErr :) <$> zipPlans rest vms
    zipPlans (Right pl : rest) (vc : vms) = do
      r <- buildResult pl vc
      (r :) <$> zipPlans rest vms
    zipPlans (Right _ : _) [] =
      throwIO $ VMError "simulation returned fewer results than expected"

-- | Run a simulation while holding one of a bounded number of slots. When all
-- slots are taken the request is shed immediately with a 503 rather than
-- queuing more VM work.
withSimSlot :: MonadUnliftIO m => Bloc.Monad.BlocEnv -> m a -> m a
withSimSlot env = bracket acquire (const release) . const
  where
    counter = Bloc.Monad.simInFlight env
    cap = Bloc.Monad.simMaxConcurrent env
    acquire = do
      ok <- liftIO . atomically $ do
        n <- readTVar counter
        if n >= cap
          then pure False
          else writeTVar counter (n + 1) >> pure True
      unless ok . throwIO $
        UnavailableError "too many simulations in progress; please retry shortly"
    release = liftIO . atomically $ modifyTVar' counter (subtract 1)

-- | The steps postUsersContractMethod' performs before signing: resolve the
-- target contract, verify the method exists, render args to literals.
marshalOuterCall ::
  ( MonadIO m,
    MonadLogger m,
    (Keccak256 `A.Selectable` CC.CodeCollection) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m
  ) =>
  Address ->
  Text ->
  Map Text ArgValue ->
  m [Text]
marshalOuterCall target fn args =
  getContractWithCodeCollectionByAddress target fn >>= \case
    Nothing ->
      throwIO . CouldNotFind $ "Couldn't find contract at address " <> Text.pack (format target)
    Just (theContract, cc) -> do
      case M.lookup (Text.unpack fn) (theContract ^. functions) of
        Just _ -> pure ()
        Nothing -> throwIO . UserError $ "Contract doesn't have a method named '" <> fn <> "'"
      marshalFunctionArgs theContract (Just cc) fn args

parseSimBlocks :: Aeson.Value -> Aeson.Parser [VmCallResult]
parseSimBlocks = Aeson.withArray "simulate blocks" $ \blocks ->
  fmap concat . forM (toList blocks) $
    Aeson.withObject "simulated block" (Aeson..: "calls")

failureResult :: ApiError -> BlocSimulateResult
failureResult e =
  BlocSimulateResult
    { blocsimulateStatus = Failure,
      blocsimulateGasUsed = 0,
      blocsimulateResponse = Nothing,
      blocsimulateData = Nothing,
      blocsimulateEvents = [],
      blocsimulateError = Just $ renderApiError e,
      blocsimulateTrace = Nothing
    }
  where
    renderApiError = \case
      UserError t -> t
      CouldNotFind t -> t
      Unimplemented t -> t
      other -> Text.pack $ show other

buildResult ::
  ( MonadIO m,
    MonadLogger m,
    (Keccak256 `A.Selectable` CC.CodeCollection) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m
  ) =>
  SimPlan ->
  VmCallResult ->
  m BlocSimulateResult
buildResult SimPlan {..} VmCallResult {..} = do
  let ok = vcrStatus == "0x1"
      gasUsed = case TR.hexadecimal $ fromMaybe vcrGasUsed (Text.stripPrefix "0x" vcrGasUsed) of
        Right (n, _) -> n
        Left _ -> 0
  mData <- case (ok, simKind) of
    (True, SimCreate cn) ->
      pure . Just . Upload . UploadContractDetails cn $
        stringAddress . Text.unpack =<< vcrCreatedAddress
    (True, SimCall target fn) -> case vcrReturnValue of
      Nothing -> pure Nothing
      Just rvJson -> case Aeson.fromJSON rvJson of
        Aeson.Error _ -> pure Nothing
        Aeson.Success (svmVal :: SMV.Value) -> do
          mRetTypes <- getReturnTypes target fn
          pure . Just . Call $ svmValueToSolidityValues svmVal mRetTypes
    _ -> pure Nothing
  pure
    BlocSimulateResult
      { blocsimulateStatus = if ok then Success else Failure,
        blocsimulateGasUsed = gasUsed,
        blocsimulateResponse = vcrReturnValue,
        blocsimulateData = mData,
        blocsimulateEvents = vcrLogs,
        blocsimulateError = vcrError,
        blocsimulateTrace = Nothing
      }
