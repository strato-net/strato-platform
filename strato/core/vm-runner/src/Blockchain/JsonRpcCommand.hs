{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.JsonRpcCommand
  ( produceResponse,
    runJsonRpcCommand,
    runJsonRpcCommand',
    runJsonRpcCommandSandboxed,
    resolveFunction,
    traceToJson,
  )
where

import BlockApps.Logging
import BlockApps.Solidity.ABI
import Blockchain.Data.BlockHeader (BlockHeader)
import Blockchain.DB.CodeDB
import Blockchain.DB.SolidStorageDB (getSolidStorageKeyVal')
import Blockchain.Data.AddressStateDB
import Blockchain.Data.CallTrace (CallFrame, TraceLog (..), VmTracer, newVmTracer, takeTraceRoots)
import Blockchain.Data.ExecResults (ExecResults (..))
import Blockchain.MemVMContext (MemContextM, VMType (..), evalSandboxedContextM)
import Blockchain.Sequencer.CallSpec (CallSpec (..), TraceOptions (..), TxCreateObject (..), TxFuncCallObject (..))
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.HexData (HexData (..))
import Data.Aeson ((.=))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KeyMap
import qualified Data.Binary as Bin
import qualified Data.ByteString.Lazy as BL
import qualified Blockchain.Sequencer.TxCallObject as TxCall
import qualified Blockchain.SolidVM as SolidVM
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromHash)
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.GasInfo (GasInfo (..))
import Blockchain.SolidVM.SM (runSM)
import Blockchain.Strato.Model.Address (Address, addressToByteString, formatAddressWithoutColor)
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Code (Code (..))
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Gas (Gas (..))
import Blockchain.Strato.Model.Event (Event (..))
import Blockchain.Strato.Model.Keccak256 (hash)
import Blockchain.VMContext (ContextBestBlockInfo (..), CurrentBlockHash (..), VMBase, getContextBestBlockInfo, getNewAddress, checkIfRunningTests)
import Control.Lens ((^.))
import Control.Applicative ((<|>))
import Control.Monad ((<=<), void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Streaming
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.List (intercalate)
import qualified Data.Map as M
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Data.Text.Read as TR
import Prelude hiding (id)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.VarDef (IndexedType (..))
import SolidVM.Model.CodeCollection.Visibility (Visibility (..))
import SolidVM.Model.SolidString (SolidString, labelToText, stringToLabel)
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value (Variable(..), forceLoadVar)
import Numeric (showHex)
import Text.Format (format)

produceResponse :: HasStreaming m => JsonRpcResponse -> m ()
produceResponse resp = void $ produceItems "jsonrpcresponse" [(responseId resp, BL.toStrict $ Bin.encode resp)]

runJsonRpcCommand :: (VMBase m, HasStreaming m) => JsonRpcCommand -> m ()
runJsonRpcCommand =
  produceResponse
    <=< runJsonRpcCommand'

-- | Run a JSON-RPC command inside a sandboxed VM context: reads fall through
-- to the real state, but every write lands in an in-memory overlay that is
-- discarded when the command finishes. This makes it safe to simulate
-- state-changing calls and contract creations.
runJsonRpcCommandSandboxed :: forall m. VMBase m => JsonRpcCommand -> m JsonRpcResponse
runJsonRpcCommandSandboxed c =
  evalSandboxedContextM (runJsonRpcCommand' c :: MemContextM 'Sandboxed m JsonRpcResponse)

runJsonRpcCommand' :: VMBase m => JsonRpcCommand -> m JsonRpcResponse
runJsonRpcCommand' c@JRCGetBalance {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateBalance
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetBalance" $ T.pack response
  return $ Success id (BC.pack response)
runJsonRpcCommand' c@JRCGetCode {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetCode" . T.pack $ "running command: " ++ show c
  codeHash <-
    addressStateCodeHash
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  code <- getExternallyOwned $
    case codeHash of
      ExternallyOwned ch -> ch
      _ -> error "runJsonRpcCommand currently only supported for the EVM"
  return $ Success id code
runJsonRpcCommand' c@JRCGetTransactionCount {jrcAddress = address, jrcId = id} = do
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" . T.pack $ "running command: " ++ show c
  response <-
    show . addressStateNonce
      <$> A.lookupWithDefault (A.Proxy @AddressState) address
  $logInfoS "runJsonRpcCommand'.JRCGetTransactionCount" $ T.pack response
  return $ Success id (BC.pack response)
runJsonRpcCommand' JRCGetStorageAt {} = error "unsupported RPC command call"
runJsonRpcCommand' c@(JRCCall callObj id _blockTag) = do
  $logInfoS "JRCCall" . T.pack $ format c
  case TxCall.to callObj of
    Nothing -> return $ Success id B.empty
    Just toAddr -> do
      initBestBlockContext
      withExecHeader Nothing id $ \header ->
        ethCall id header (Gas 1000000) (TxCall.from callObj) toAddr (unHexData $ TxCall.data_ callObj)
runJsonRpcCommand' c@(JRCCallV2 spec mHeader id) = do
  $logInfoS "JRCCallV2" . T.pack $ format c
  withExecHeader mHeader id $ \header -> case spec of
    SpecCall callObj -> case TxCall.to callObj of
      Nothing -> return $ Error id "missing 'to' address"
      Just toAddr ->
        ethCall id header (parseHexGas $ TxCall.gas callObj) (TxCall.from callObj) toAddr (unHexData $ TxCall.data_ callObj)
    SpecCreate createObj -> ethCreate id header createObj
    -- eth_call's contract is ABI-encoded return bytes, which a direct
    -- SolidVM call has no types to produce.
    SpecFuncCall _ ->
      return $ Error id "functionName call specs are supported by eth_simulateV1 and debug_traceCall only"
runJsonRpcCommand' c@(JRCTraceCall spec mHeader opts id) = do
  $logInfoS "JRCTraceCall" . T.pack $ format c
  withExecHeader mHeader id $ \header -> do
    tracer <- newVmTracer (traceStatements opts)
    Mod.put (Mod.Proxy @(Maybe VmTracer)) (Just tracer)
    resp <- case spec of
      SpecCall callObj -> case TxCall.to callObj of
        Nothing -> return $ Error id "missing 'to' address"
        Just toAddr ->
          ethCall id header (parseHexGas $ TxCall.gas callObj) (TxCall.from callObj) toAddr (unHexData $ TxCall.data_ callObj)
      SpecCreate createObj -> ethCreate id header createObj
      SpecFuncCall fObj -> do
        (eRes, _) <- ethFuncCallEx header fObj
        return $ either (Error id) (Success id) eRes
    Mod.put (Mod.Proxy @(Maybe VmTracer)) Nothing
    (roots, truncated) <- takeTraceRoots tracer
    -- A revert still produces a trace (the frames carry the error, matching
    -- geth); only a failure before execution started surfaces as an error.
    case (resp, roots) of
      (Error _ msg, []) -> return $ Error id msg
      _ -> return . SuccessJson id . BL.toStrict . Aeson.encode $ traceToJson truncated roots
runJsonRpcCommand' c@JRCTraceBlockTxs {} = return $ Error (jrcId c) "debug_traceBlock* is not implemented yet"
runJsonRpcCommand' c@(JRCSimulate simBlocks mHeader id) = do
  $logInfoS "JRCSimulate" . T.pack $ format c
  -- The whole command runs inside one sandbox, so state accumulates across
  -- the calls (later calls see earlier calls' effects) and is discarded when
  -- the command finishes.
  withExecHeader mHeader id $ \header -> do
    results <- mapM (mapM (simulateOne header)) simBlocks
    return . SuccessJson id . BL.toStrict $ Aeson.encode results

simulateOne :: VMBase m => BlockHeader -> CallSpec -> m Aeson.Value
simulateOne header spec = do
  let gas@(Gas gasGiven) = case spec of
        SpecCall callObj -> parseHexGas $ TxCall.gas callObj
        SpecCreate createObj -> parseHexGas $ createGas createObj
        SpecFuncCall fObj -> parseHexGas $ funcCallGas fObj
  (eRes, mEr) <- case spec of
    SpecCall callObj -> case TxCall.to callObj of
      Nothing -> pure (Left "missing 'to' address", Nothing)
      Just toAddr ->
        ethCallEx header gas (TxCall.from callObj) toAddr (unHexData $ TxCall.data_ callObj)
    SpecCreate createObj -> ethCreateEx header createObj
    SpecFuncCall fObj -> ethFuncCallEx header fObj
  -- The raw SolidVM return value as JSON: the same conversion that populates
  -- TransactionResult.response for posted transactions, so simulated and
  -- posted return values are directly comparable.
  mRetJson <- case erReturnVal =<< mEr of
    Nothing -> pure Nothing
    Just rv -> Just . Aeson.toJSON <$> forceLoadVar (Constant rv)
  let gasUsed = maybe 0 (\er -> max 0 (gasGiven - erRemainingTxGas er)) mEr
      logs =
        [ TraceLog
            (evContractAddress ev)
            (T.pack $ evName ev)
            [(T.pack n, T.pack v) | (n, v, _) <- evArgs ev]
          | ev <- maybe [] erEvents mEr
        ]
      hex n = "0x" ++ showHex n ""
      extras =
        maybe [] (\v -> ["returnValue" .= v]) mRetJson
          ++ maybe
            []
            (\a -> ["createdAddress" .= T.pack (formatAddressWithoutColor a)])
            (erNewContractAddress =<< mEr)
  return . Aeson.object $ case eRes of
    Right bytes ->
      [ "status" .= hex (1 :: Integer),
        "returnData" .= ("0x" ++ BC.unpack (B16.encode bytes)),
        "gasUsed" .= hex gasUsed,
        "logs" .= logs
      ]
        ++ extras
    Left msg ->
      [ "status" .= hex (0 :: Integer),
        "returnData" .= ("0x" :: String),
        "gasUsed" .= hex gasUsed,
        "error" .= Aeson.object ["message" .= msg],
        "logs" .= logs
      ]
        ++ extras

-- | debug_trace* result payload: a single root frame is returned as an
-- object (geth callTracer shape), multiple roots as an array. When statement
-- entries were capped, the root object gets a "truncated": true marker.
traceToJson :: Bool -> [CallFrame] -> Aeson.Value
traceToJson truncated roots = case roots of
  [single] -> addTrunc $ Aeson.toJSON single
  multiple -> Aeson.toJSON $ map (addTrunc . Aeson.toJSON) multiple
  where
    addTrunc v
      | not truncated = v
      | Aeson.Object o <- v = Aeson.Object $ KeyMap.insert "truncated" (Aeson.Bool True) o
      | otherwise = v

-- | Pick the execution header — the provided historical header, or the
-- current best block — and point CurrentBlockHash at it so state lookups
-- resolve against that block's world state.
withExecHeader :: VMBase m => Maybe BlockHeader -> String -> (BlockHeader -> m JsonRpcResponse) -> m JsonRpcResponse
withExecHeader mHeader id f = do
  mH <- case mHeader of
    Just h -> return $ Just h
    Nothing ->
      getContextBestBlockInfo >>= \case
        ContextBestBlockInfo _ bh _ -> return $ Just bh
        Unspecified -> return Nothing
  case mH of
    Nothing -> return $ Error id "no best block available"
    Just header -> do
      Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash $ blockHeaderHash header)
      f header

-- | Parse a JSON-RPC hex gas quantity ("0x2dc6c0"). Zero or unparseable
-- values fall back to the historical default of 1,000,000.
parseHexGas :: T.Text -> Gas
parseHexGas t =
  case T.stripPrefix "0x" t of
    Just h | not (T.null h), Right (n, rest) <- TR.hexadecimal h, T.null rest, n > 0 -> Gas n
    _ -> Gas 1000000

--------------------------------------------------------------------------------
-- eth_call: resolve contract, match selector, invoke SolidVM, encode return
--------------------------------------------------------------------------------

ethCall :: VMBase m => String -> BlockHeader -> Gas -> Address -> Address -> B.ByteString -> m JsonRpcResponse
ethCall id blockHeader gas fromAddr toAddr callData = do
  (eRes, _) <- ethCallEx blockHeader gas fromAddr toAddr callData
  return $ either (Error id) (Success id) eRes

-- | Like ethCall, but also exposes the ExecResults (when execution ran) so
-- callers like eth_simulateV1 can report gas usage and logs per call.
ethCallEx :: VMBase m => BlockHeader -> Gas -> Address -> Address -> B.ByteString -> m (Either String B.ByteString, Maybe ExecResults)
ethCallEx blockHeader gas fromAddr toAddr callData = do
  let selector = B.take 4 callData
      argsBytes = B.drop 4 callData

  resolveFunction blockHeader fromAddr toAddr selector >>= \case
    Nothing -> do
      $logInfoS "ethCall" . T.pack $ "no function for selector " ++ BC.unpack (B16.encode selector)
      return (Left ("no function for selector 0x" ++ BC.unpack (B16.encode selector)), Nothing)
    Just (funcName, func) -> do
      let argTypes = funcArgTypes func
          retTypes = funcRetTypes func
          argTexts = map valueToArgText $ decodeABIArgs argsBytes argTypes
          prettyArgs = intercalate ", " $ map T.unpack argTexts
          prettyCall = T.unpack (labelToText funcName) ++ "(" ++ prettyArgs ++ ")"

      $logInfoS "ethCall" . T.pack $ prettyCall ++ " on " ++ show toAddr

      -- Non-view functions are allowed: the whole command runs in a sandboxed
      -- context, so any state changes are discarded after execution.
      result <- SolidVM.call blockHeader toAddr fromAddr fromAddr gas fromAddr
        (hash callData) (labelToText funcName) argTexts Nothing

      case erException result of
        Just ex -> do
          $logInfoS "ethCall" . T.pack $ prettyCall ++ " => EXCEPTION: " ++ show ex
          return (Left (show ex), Just result)
        Nothing -> case erReturnVal result of
          Nothing -> do
            $logInfoS "ethCall" . T.pack $ prettyCall ++ " => (no return value)"
            return (Right B.empty, Just result)
          Just retVal -> do
            -- The return value may contain IORef-backed Variables (struct
            -- getters build their tuple with createVar), so freeze it before
            -- the pure ABI encoder reads the members.
            val <- forceLoadVar $ Constant retVal
            let encoded = encodeValueABI retTypes val
            $logInfoS "ethCall" . T.pack $ prettyCall ++ " => " ++ show val
            return (Right encoded, Just result)

--------------------------------------------------------------------------------
-- eth_call with no 'to': simulate a contract creation from source
--------------------------------------------------------------------------------

ethCreate :: VMBase m => String -> BlockHeader -> TxCreateObject -> m JsonRpcResponse
ethCreate id blockHeader createObj = do
  (eRes, _) <- ethCreateEx blockHeader createObj
  return $ either (Error id) (Success id) eRes

ethCreateEx :: VMBase m => BlockHeader -> TxCreateObject -> m (Either String B.ByteString, Maybe ExecResults)
ethCreateEx blockHeader TxCreateObject {..} = do
  $logInfoS "ethCreate" . T.pack $
    "creating " ++ T.unpack createContractName ++ " from " ++ show createFrom

  newAddr <- getNewAddress createFrom
  result <-
    SolidVM.create blockHeader createFrom createFrom createFrom
      (parseHexGas createGas) newAddr (Code createSource)
      (hash $ TE.encodeUtf8 createSource) createContractName createArgs

  case erException result of
    Just ex -> do
      $logInfoS "ethCreate" . T.pack $ "creation => EXCEPTION: " ++ show ex
      return (Left (show ex), Just result)
    Nothing -> do
      $logInfoS "ethCreate" . T.pack $ "created at " ++ show newAddr
      -- SolidVM has no runtime bytecode to return, so the useful result of a
      -- simulated creation is the would-be address, ABI-encoded.
      return (Right (B.replicate 12 0 <> addressToByteString newAddr), Just result)

--------------------------------------------------------------------------------
-- SolidVM-native direct call: funcName + Solidity-literal args, exactly the
-- shape a posted MessageTX carries (including fallback/proxy dispatch)
--------------------------------------------------------------------------------

ethFuncCallEx :: VMBase m => BlockHeader -> TxFuncCallObject -> m (Either String B.ByteString, Maybe ExecResults)
ethFuncCallEx blockHeader TxFuncCallObject {..} = do
  let prettyCall =
        T.unpack funcCallFunctionName ++ "(" ++ intercalate ", " (map T.unpack funcCallArgs) ++ ")"
  $logInfoS "ethFuncCall" . T.pack $ prettyCall ++ " on " ++ show funcCallTo

  result <-
    SolidVM.call blockHeader funcCallTo funcCallFrom funcCallFrom
      (parseHexGas funcCallGas) funcCallFrom
      (hash . TE.encodeUtf8 $ funcCallFunctionName <> T.intercalate "," funcCallArgs)
      funcCallFunctionName funcCallArgs Nothing

  case erException result of
    Just ex -> do
      $logInfoS "ethFuncCall" . T.pack $ prettyCall ++ " => EXCEPTION: " ++ show ex
      return (Left (show ex), Just result)
    Nothing -> do
      $logInfoS "ethFuncCall" . T.pack $ prettyCall ++ " => ok"
      -- No ABI return types are available on this path; the return value
      -- travels as JSON (simulateOne's returnValue field), not ABI bytes.
      return (Right B.empty, Just result)

initBestBlockContext :: VMBase m => m ()
initBestBlockContext = do
  bbi <- getContextBestBlockInfo
  case bbi of
    ContextBestBlockInfo bestHash _ _ ->
      Mod.put (Mod.Proxy @CurrentBlockHash) (CurrentBlockHash bestHash)
    Unspecified -> return ()

--------------------------------------------------------------------------------
-- Contract resolution: address -> (funcName, func), following proxy if needed
--------------------------------------------------------------------------------

resolveFunction :: VMBase m => BlockHeader -> Address -> Address -> B.ByteString -> m (Maybe (SolidString, CC.Func))
resolveFunction blockHeader fromAddr addr selector = do
  lookupContract blockHeader fromAddr addr >>= \case
    Nothing -> do
      $logInfoS "resolveFunction" . T.pack $ "lookupContract returned Nothing for " ++ show addr
      return Nothing
    Just contract -> do
      $logInfoS "resolveFunction" . T.pack $
        "contract " ++ show (contract ^. CC.contractName)
        ++ " funcs=" ++ show (M.keys $ CC._functions contract)
        ++ " storageDefs=" ++ show (M.keys $ contract ^. CC.storageDefs)
      case matchSelector contract selector of
        Just hit -> return $ Just hit
        Nothing -> case matchStorageGetter contract selector of
          Just hit -> do
            $logInfoS "resolveFunction" "matched storage getter on direct contract"
            return $ Just hit
          Nothing -> do
            $logInfoS "resolveFunction" "no direct match, trying proxy"
            followProxy blockHeader fromAddr addr contract >>= \case
              Nothing -> do
                $logInfoS "resolveFunction" "followProxy returned Nothing"
                return Nothing
              Just implContract -> do
                let result = matchSelector implContract selector
                             <|> matchStorageGetter implContract selector
                $logInfoS "resolveFunction" . T.pack $
                  "impl contract " ++ show (implContract ^. CC.contractName)
                  ++ " funcs=" ++ show (M.keys $ CC._functions implContract)
                  ++ " storageDefs=" ++ show (M.keys $ implContract ^. CC.storageDefs)
                  ++ " resolved=" ++ show (fmap (labelToText . fst) result)
                return result

lookupContract :: VMBase m => BlockHeader -> Address -> Address -> m (Maybe CC.Contract)
lookupContract blockHeader fromAddr addr =
  A.lookup (A.Proxy @AddressState) addr >>= \case
    Nothing -> do
      $logInfoS "lookupContract" . T.pack $ "address not found: " ++ show addr
      return Nothing
    Just addrState -> case addressStateCodeHash addrState of
      SolidVMCode contractName codeHash -> do
        isRunningTests <- checkIfRunningTests
        let env = Env.Environment
              { Env.blockHeader = blockHeader
              , Env.sender = fromAddr
              , Env.origin = fromAddr
              , Env.proposer = fromAddr
              , Env.txHash = hash B.empty
              , Env.src = Nothing
              , Env.name = Nothing
              , Env.runningTests = isRunningTests
              }
            gi = GasInfo
              { _gasLeft = Gas 1000000
              , _gasUsed = 0
              , _gasInitialAllotment = Gas 1000000
              , _gasMetadata = ""
              }
        (_, result) <- runSM Nothing env gi $ do
          cc <- codeCollectionFromHash isRunningTests True codeHash
          return $ M.lookup (stringToLabel contractName) (cc ^. CC.contracts)
        case result of
          Right val -> do
            $logInfoS "lookupContract" . T.pack $
              "loaded " ++ contractName ++ " => " ++ show (fmap (^. CC.contractName) val)
            return val
          Left e -> do
            $logInfoS "lookupContract" . T.pack $
              "runSM failed for " ++ show addr ++ " (" ++ contractName ++ "): " ++ show e
            return Nothing
      _ -> do
        $logInfoS "lookupContract" . T.pack $
          "non-SolidVM code at " ++ show addr ++ ": " ++ show (addressStateCodeHash addrState)
        return Nothing

followProxy :: VMBase m => BlockHeader -> Address -> Address -> CC.Contract -> m (Maybe CC.Contract)
followProxy blockHeader fromAddr proxyAddr contract
  | M.member "fallback" (CC._functions contract),
    M.member "logicContract" (contract ^. CC.storageDefs) = do
      storageVal <- getSolidStorageKeyVal' proxyAddr (StoragePath [Field "logicContract"])
      case extractAddress storageVal of
        Nothing -> return Nothing
        Just implAddr -> do
          $logInfoS "followProxy" . T.pack $ "delegates to " ++ show implAddr
          lookupContract blockHeader fromAddr implAddr
  | otherwise = return Nothing
  where
    extractAddress (BContract _ a) = Just a
    extractAddress (BAddress a) = Just a
    extractAddress _ = Nothing

matchSelector :: CC.Contract -> B.ByteString -> Maybe (SolidString, CC.Func)
matchSelector contract selector =
  let enumSizes = [(labelToText n, length names) | (n, (names, _)) <- M.toList (CC._enums contract)]
   in matchFunction enumSizes selector (M.toList $ CC._functions contract)

matchStorageGetter :: CC.Contract -> B.ByteString -> Maybe (SolidString, CC.Func)
matchStorageGetter contract selector = go (M.toList $ CC._storageDefs contract)
  where
    go [] = Nothing
    go ((varName, varDecl) : rest)
      | CC._varVisibility varDecl /= Just Public = go rest
      | computeSelector varName argTypes == selector = Just (varName, syntheticFunc)
      | otherwise = go rest
      where
        (argTypes, retType) = getterSignature (CC._varType varDecl)
        -- A struct-valued getter returns its members flattened into a tuple
        -- (matching SolidVM's handleStruct), so the return signature is the list
        -- of included member types rather than the struct itself.
        retTypes = getterReturnTypes contract retType
        syntheticFunc = CC.Func
          { CC._funcArgs = zipWith (\i t -> (Nothing, IndexedType i t Nothing)) [0..] argTypes
          , CC._funcVals = zipWith (\i t -> (Nothing, IndexedType i t Nothing)) [0..] retTypes
          , CC._funcStateMutability = Just CC.View
          , CC._funcContents = Nothing
          , CC._funcVisibility = Just Public
          , CC._funcVirtual = False
          , CC._funcOverrides = Nothing
          , CC._funcConstructorCalls = M.empty
          , CC._funcModifiers = []
          , CC._funcContext = CC._varContext varDecl
          , CC._funcIsFree = False
          , CC._funcOverload = []
          }

getterSignature :: SVMType.Type -> ([SVMType.Type], SVMType.Type)
getterSignature (SVMType.Array elemT _) = ([SVMType.Int Nothing Nothing], elemT)
getterSignature (SVMType.Mapping _ keyT valT _ _) =
  let (innerArgs, innerRet) = getterSignature valT
   in (keyT : innerArgs, innerRet)
getterSignature t = ([], t)

-- | Return types produced by a public-variable getter. For a struct-valued
-- getter this flattens the struct into its member types (Solidity returns the
-- members as a tuple), skipping members the getter omits — mappings, arrays and
-- errors — to stay in lockstep with SolidVM's handleStruct. For any other type
-- the getter returns a single value.
getterReturnTypes :: CC.Contract -> SVMType.Type -> [SVMType.Type]
getterReturnTypes contract retType =
  case lookupStructFields contract retType of
    Just fields -> [t | (_, t) <- fields, includeInGetter t]
    Nothing -> [retType]
  where
    includeInGetter SVMType.Error {} = False
    includeInGetter SVMType.Array {} = False
    includeInGetter SVMType.Mapping {} = False
    includeInGetter _ = True

lookupStructFields :: CC.Contract -> SVMType.Type -> Maybe [(SolidString, SVMType.Type)]
lookupStructFields contract t = do
  name <- case t of
    SVMType.Struct _ s -> Just s
    SVMType.UnknownLabel s -> Just s
    _ -> Nothing
  fields <- M.lookup name (contract ^. CC.structs)
  pure [(fieldName, CC.fieldTypeType ft) | (fieldName, ft, _) <- fields]
