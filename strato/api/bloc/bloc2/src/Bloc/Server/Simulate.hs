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
import BlockApps.Solidity.ArgValue (ArgValue (..), splitTypeHint)
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
import Control.Applicative ((<|>))
import Control.Monad (forM, guard, unless, when)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Data.Aeson ((.=))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KeyMap
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
    simKind :: SimKind,
    -- | Extra call to simulate independently and attach as the result's
    -- `effect` (currently: the castVoteOnIssue issue effect). When the effect
    -- is itself a castVoteOnIssue — a vote wrapped through nested multisigs —
    -- this chains recursively, one plan per hop, ending at the ultimate action.
    simEffect :: Maybe SimPlan
  }

-- Per-call output of strato_simulateV1 (see vm-runner's simulateOne).
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
  Bool -> -- trace: include a strato_traceCall frame tree (single-tx bodies)
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
                Nothing
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
                Nothing
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
                Nothing
        | otherwise -> do
            let gasTxt = hexGas $ mergeTxParams (functionpayloadTxParams p) txParams
                target = functionpayloadContractAddress p
                method = functionpayloadMethod p
            args' <- marshalOuterCall target method (functionpayloadArgs p)
            -- Simulating castVoteOnIssue(_target,_func,_args)? Also simulate the
            -- issue's effect: target.func(args) run as the registry/wallet, using
            -- the same positional _args (which flatten to the tail of args').
            let mEffect = castVoteEffectPlan target gasTxt method (functionpayloadArgs p) args'
            pure $
              SimPlan
                (mkFuncCall target method args' gasTxt)
                (SimCall target method)
                mEffect

    let specs = [simSpec pl | Right pl <- plans]
    vmCalls <-
      if null specs
        then pure []
        else
          jsonRpcCall
            url
            "strato_simulateV1"
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
            jsonRpcCall url "strato_traceCall" [Aeson.toJSON spec, Aeson.String "latest", Aeson.object ["statements" .= False]] >>= \case
              Left err -> do
                $logWarnS "simulate/trace" $ "strato_traceCall failed: " <> err
                pure Nothing
              Right v -> pure $ Just v
          _ -> pure Nothing
        else pure Nothing

    results <- zipPlans plans vmCalls
    let tracedResults = case (mTraceVal, results) of
          (Just tv, [r]) -> [withTrace tv r]
          _ -> results
    -- Attach the castVoteOnIssue effect simulation (if any) to each result. Each
    -- effect runs in its own fresh sandbox, so it reflects executing the issue
    -- against current state rather than after this vote.
    forM (zip plans tracedResults) $ \(ep, r) -> case ep of
      Right pl | Just eff <- simEffect pl -> do
        effRes <- runEffectPlan url trace eff
        pure r {blocsimulateEffect = Just effRes}
      _ -> pure r
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
      blocsimulateTrace = Nothing,
      blocsimulateEffect = Nothing
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
        blocsimulateTrace = Nothing,
        blocsimulateEffect = Nothing
      }

-- | A Failure result carrying just an error message (used when an effect
-- simulation could not be produced).
errorResult :: Text -> BlocSimulateResult
errorResult msg =
  BlocSimulateResult Failure 0 Nothing Nothing [] (Just msg) Nothing Nothing

-- | The authoritative revert reason from a trace's root frame. strato_simulateV1
-- returns @erException@, which for a reverting proxy call can be a misleading
-- secondary exception (e.g. "no contract deployed at 0x..100c" thrown while
-- unwinding, after the real @require@ already failed). The tracer instead records
-- the true error on each frame as it unwinds, so the root frame's @error@ is what
-- the user should see.
traceRootError :: Aeson.Value -> Maybe Text
traceRootError (Aeson.Object o) = case KeyMap.lookup "error" o of
  Just (Aeson.String e) -> Just e
  _ -> Nothing
traceRootError (Aeson.Array a) = case toList a of
  (x : _) -> traceRootError x
  [] -> Nothing
traceRootError _ = Nothing

-- | Attach a trace to a result, and — when the call failed — prefer the trace's
-- root-frame error over strato_simulateV1's (potentially misleading) message.
withTrace :: Aeson.Value -> BlocSimulateResult -> BlocSimulateResult
withTrace tv r =
  r
    { blocsimulateTrace = Just tv,
      blocsimulateError =
        if blocsimulateStatus r == Failure
          then traceRootError tv <|> blocsimulateError r
          else blocsimulateError r
    }

-- | Cap on how many castVoteOnIssue hops are chained when simulating a vote
-- wrapped through nested multisigs. Each hop costs one strato_simulateV1 (plus
-- one strato_traceCall when tracing), so this bounds the work a maliciously
-- deep wrapping can request.
maxNestedEffectDepth :: Int
maxNestedEffectDepth = 5

-- | When simulating @castVoteOnIssue(_target, _func, _args)@, the plan for the
-- issue's effect: @target.func(args)@ executed as the registry/wallet the vote
-- runs on (@registryAddr@). SolidVM calls are positional, and the variadic
-- @_args@ flatten to the tail of the already-marshaled castVoteOnIssue args,
-- so the effect args are just @drop 2@ of them — no ABI lookup needed. When
-- the effect is itself a castVoteOnIssue (a nested-multisig vote), the plan
-- chains one hop per wrapper level via 'effectChainPlan'.
castVoteEffectPlan :: Address -> Text -> Text -> Map Text ArgValue -> [Text] -> Maybe SimPlan
castVoteEffectPlan registryAddr gasTxt method argsMap marshaledArgs
  | method /= "castVoteOnIssue" = Nothing
  | otherwise = do
      targetTxt <- argScalarText =<< M.lookup "_target" argsMap
      funcName <- argScalarText =<< M.lookup "_func" argsMap
      targetAddr <- parseAddrLit targetTxt
      pure $
        effectChainPlan maxNestedEffectDepth registryAddr targetAddr gasTxt funcName (drop 2 marshaledArgs)

-- | One hop of an issue's effect chain: @to.func(args)@ executed as @from@
-- (the wallet whose vote passed). A castVoteOnIssue effect recurses — @args@
-- are @[nextTarget, nextFunc, …nextArgs]@ rendered as literals, so the next
-- hop runs as this hop's wallet against the unwrapped tail — until the
-- ultimate non-vote action (or the depth cap) is reached.
effectChainPlan :: Int -> Address -> Address -> Text -> Text -> [Text] -> SimPlan
effectChainPlan depth fromAddr toAddr gasTxt funcName args =
  SimPlan spec (SimCall toAddr funcName) mNext
  where
    spec =
      SpecFuncCall
        TxFuncCallObject
          { funcCallFrom = fromAddr,
            funcCallTo = toAddr,
            funcCallGas = gasTxt,
            funcCallValue = "0x0",
            funcCallFunctionName = funcName,
            funcCallArgs = args
          }
    mNext = do
      guard $ depth > 1 && funcName == "castVoteOnIssue"
      (tLit, fLit, rest) <- case args of
        (t : f : r) -> Just (t, f, r)
        _ -> Nothing
      nextTarget <- parseAddrLit tLit
      pure $ effectChainPlan (depth - 1) toAddr nextTarget gasTxt (unquoteLit fLit) rest

-- | The bare text of a marshaled literal: quoted strings lose their quotes
-- (addresses and strings render as @"…"@ literals), everything else passes
-- through unchanged.
unquoteLit :: Text -> Text
unquoteLit t = fromMaybe t $ Text.stripSuffix "\"" =<< Text.stripPrefix "\"" t

-- | Parse an address from either a bare or quoted, 0x-prefixed or bare-hex
-- rendering.
parseAddrLit :: Text -> Maybe Address
parseAddrLit t =
  let t' = unquoteLit t
   in stringAddress . Text.unpack $ fromMaybe t' (Text.stripPrefix "0x" t')

-- | Extract the plain textual value of a (possibly {type,value}-hinted) scalar.
argScalarText :: ArgValue -> Maybe Text
argScalarText av0 = case maybe av0 snd (splitTypeHint av0) of
  ArgString t -> Just t
  ArgInt i -> Just . Text.pack $ show i
  ArgBool b -> Just $ if b then "true" else "false"
  _ -> Nothing

-- | Simulate a plan's effect call independently (fresh sandbox) and shape it as
-- a nested BlocSimulateResult, with its own trace when requested. A chained
-- effect (nested-multisig vote hops) recurses, so the result mirrors the whole
-- chain; each hop simulates against current state, i.e. "what happens when this
-- hop's threshold passes".
runEffectPlan ::
  ( MonadUnliftIO m,
    MonadLogger m,
    (Keccak256 `A.Selectable` CC.CodeCollection) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m
  ) =>
  String ->
  Bool ->
  SimPlan ->
  m BlocSimulateResult
runEffectPlan url trace eff = do
  esim <-
    jsonRpcCall
      url
      "strato_simulateV1"
      [ Aeson.object ["blockStateCalls" .= [Aeson.object ["calls" .= [simSpec eff]]]],
        Aeson.String "latest"
      ]
  base <- case esim of
    Left err -> pure $ errorResult ("effect simulation failed: " <> err)
    Right v -> case Aeson.parseEither parseSimBlocks v of
      Left perr -> pure $ errorResult ("unexpected effect response: " <> Text.pack perr)
      Right [] -> pure $ errorResult "empty effect simulation response"
      Right (callRes : _) -> do
        r <- buildResult eff callRes
        if not trace
          then pure r
          else
            jsonRpcCall url "strato_traceCall" [Aeson.toJSON (simSpec eff), Aeson.String "latest", Aeson.object ["statements" .= False]] >>= \case
              Left _ -> pure r
              Right tv -> pure (withTrace tv r)
  case simEffect eff of
    Nothing -> pure base
    Just nextEff -> do
      nextRes <- runEffectPlan url trace nextEff
      pure base {blocsimulateEffect = Just nextRes}
