{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS_GHC -Wno-unrecognised-pragmas #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

{-# HLINT ignore "Use if" #-}

module SolidVM.Blockchain
  ( SolidVMBase,
    call,
    create,
    callReturnEnv,
    createReturnEnv,
  )
where

import Blockchain.DB.ModifyStateDB (pay)
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockHeader (BlockHeader)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.ExecResults
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.GasInfo
import Blockchain.SolidVM.Metrics (recordCall)
import Blockchain.SolidVM.SM hiding (action)
import SolidVM.Storage
import SolidVM.Values
import SolidVM.Events
import SolidVM.Gas
import qualified SolidVM.Core as N
import qualified SolidVM.Runtime as Runtime
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import SolidVM.Model.Delta
import SolidVM.Model.Event
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Action)
import Blockchain.VMContext
import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as Conf
import Control.Applicative
import Control.Lens hiding (Context, assign, from, to, uncons, unsnoc)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Data.Bool (bool)
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Foldable (for_, toList)
import Data.List
import qualified Data.Map as M
import Data.Maybe
import qualified Data.Sequence as Q
import qualified Data.Set as S
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import Data.Traversable
import qualified Data.Vector as V
import Blockchain.Data.BlockSummary (BlockSummary (..))
import Blockchain.Data.ProposalFacts
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
import SolidVM.Solidity.Parse.ParserTypes
import qualified SolidVM.Solidity.Parse.Fast.Parser as Fast
import SolidVM.Solidity.Parse.UnParser (unparseExpression)
import qualified Text.Colors as C
import Text.Format
import Text.Tools
import UnliftIO hiding (assert)

type SolidVMBase m = (m ~ ContextM)

onTraced :: Monad m => m () -> m ()
onTraced = when (Conf.svmTrace (Conf.debugConfig ethConf))

-- TL;DR Use onTracedSM whenever you have a showSM in a trace over onTraced
-- Full: In some onTraced logging statements we called showSM. Through a series
-- of function calls (showSM -> getVar -> getSolidStorageKeyVal'
-- -> getRawStorageKeyVal' -> getRawStorageKeyValMC -> lookupWithDefault
-- -> genericLookupRawStorageDB) we end up calling genericLookupRawStorageDB.
-- This adds default values to the MP Trie whenever we lookup a nonexistant
-- value in our DB. THIS IS PROBLOMATIC, we are adding somthing to the MP Trie
-- (and therefore changing the stateroot) for just having a logging statement!
-- TODO: Do not add default values to RawStorageDBs for SolidVM > 3.
onTracedSM :: Monad m => CC.Contract -> m () -> m ()
onTracedSM _ = when (Conf.svmTrace (Conf.debugConfig ethConf))

create ::
  SolidVMBase m =>
  BlockHeader ->
  Address ->
  Address ->
  Address ->
  Gas ->
  Address ->
  Code ->
  Keccak256 ->
  Text ->
  [Text] ->
  m ExecResults
--create isRunningTests' isHomestead preExistingSuicideList b callDepth sender origin
--       value gasPrice availableGas newAddress initCode txHash chainId metadata =
create blockData sender' origin' proposer' availableGas newAddress code txHash' contractName argsStrings = do
  snd <$> createReturnEnv blockData sender' origin' proposer' availableGas newAddress code txHash' contractName argsStrings

createReturnEnv ::
  SolidVMBase m =>
  BlockHeader ->
  Address ->
  Address ->
  Address ->
  Gas ->
  Address ->
  Code ->
  Keccak256 ->
  Text ->
  [Text] ->
  m (Env.Environment, ExecResults)
createReturnEnv blockData sender' origin' proposer' availableGas newAddress code txHash' contractName argsStrings = do
  isRunningTests <- checkIfRunningTests

  let Code initCode=code

  let env' =
        Env.Environment
          { Env.blockHeader = blockData,
            Env.sender = sender',
            Env.proposer = proposer',
            Env.origin = origin',
            Env.txHash = txHash',
            Env.src = Just code,
            Env.name = Just contractName,
            Env.runningTests = isRunningTests,
            Env.prevBlock = Nothing
          }
  let gasInfo' =
        GasInfo
          { _gasLeft = availableGas,
            _gasUsed = 0,
            _gasInitialAllotment = availableGas,
            _gasMetadata = ""
          }

  fmap (fmap $ either solidvmErrorResults id) . runTransaction (Just code) env' gasInfo' $ do

    opts <- parseOptionsForCurrentBlock
    (hsh, cc) <- codeCollectionFromSourceWith opts isRunningTests True $ DT.encodeUtf8 initCode
    addNewCodeCollection hsh cc
    let eArgExps = traverse (Fast.parseArg initialParserState "") argsStrings
        !argExps = either (parseError "create arguments") id eArgExps
    argVals <- argsToVals argExps

    create' sender' newAddress hsh cc (textToLabel contractName) argVals

createContractValues :: SolidString -> Maybe (SM Value) -> SM ValList -> SM Address
createContractValues contractName' mSalt getArgs = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "Invalid contract creation during read-only access" $ "contractName: " ++ show contractName'
  creator <- getCurrentAddress
  (hsh, cc) <- getCurrentCodeCollection
  (newAddress, argVals) <- case mSalt of
    Nothing -> do
      address <- getNewAddress creator
      values <- getArgs
      pure (address, values)
    Just getSalt -> do
      salt <- getSalt
      values <- getArgs
      address <- getNewAddressWithSalt creator salt hsh (SString (labelToString contractName') : values)
      pure (address, values)
  execResults <- create' creator newAddress hsh cc contractName' argVals
  pure $ fromMaybe (internalError "a call to create did not create an address" execResults) $ erNewContractAddress execResults

create' :: Address -> Address -> Keccak256 -> CC.CodeCollection -> SolidString -> ValList -> SM ExecResults
create' creator newAddress ch cc contractName' valList = do

  let !contract' = fromMaybe (missingType "create'/contract" contractName') (cc ^. CC.contracts . at contractName')
  -- $logInfoS "create': contract' " . T.pack $ show $ contract'
  -- $logInfoS "create': abstracts1' " . T.pack $ show $ abstracts'

  initializeAction newAddress

  A.adjustWithDefault_ (A.Proxy @AddressState) newAddress $ \newAddressState ->
    pure
      newAddressState
        { addressStateContractRoot = MP.emptyTriePtr,
          addressStateCodeHash = SolidVMCode (labelToString contractName') ch
        }

  -- get the gasLeft from the environment
  gasInfo <- getGasInfo
  multilineLog "create'/contract" $
    boringBox
      [ "Creating contract: ",
        "Address: " ++ (format newAddress),
        "Type: " ++ C.yellow (labelToString contractName'),
        "Gas allotment: " ++ (C.yellow $ show (_gasInitialAllotment gasInfo)),
        "Gas left: " ++ (C.red $ show (_gasLeft gasInfo))
      ]

  void . withCallInfo newAddress newAddress contract' "constructor" ch cc M.empty False False $ pure ()

  -- Materialize any storage references passed in by the creator — the new contract
  -- can't read the creator's storage, so we snapshot arrays/structs here.
  let constructorArgs = fromMaybe [] . fmap CC._funcArgs $ contract' ^. CC.constructor
  resolvedValList <- resolveArgRefs creator contract' cc constructorArgs valList

  -- Run the constructor
  runTheConstructors creator newAddress ch cc contractName' resolvedValList

  onTraced $ liftIO $ putStrLn $ C.green $ "Done Creating Contract: " ++ show newAddress ++ " of type " ++ labelToString contractName'

  -- I'm showing these strings because I like them to be in quotes in the logs :)
  multilineLog "create'/versioning" $ boringBox ["Contract Name: " ++ (C.yellow (labelToString contractName'))]

  stakeEventSource <- Conf.stakeEventSourceAt (Conf.networkConfig ethConf) . BlockHeader.number . Env.blockHeader <$> getEnv

  finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
  finalAct <- Mod.get (Mod.Proxy @Action)
  let (newV, remV) = fromDelta . getDeltasFromEvents $ toList finalEvs
  return
    ExecResults
      { erRemainingTxGas = 0, --Just use up all the allocated gas for now....
        erRefund = 0,
        erReturnVal = Nothing,
        erTrace = [],
        erLogs = [],
        erEvents = toList finalEvs,
        erNewContractAddress = Just newAddress,
        erSuicideList = S.empty,
        erAction = Just finalAct,
        erException = Nothing,
        erPragmas = CC._pragmas cc,
        erNewValidators = newV,
        erRemovedValidators = remV,
        erStakeUpdates = getStakeDeltasFromEvents stakeEventSource $ toList finalEvs
      }

call ::
  SolidVMBase m =>
  BlockHeader ->
  Address ->
  Address ->
  Address ->
  Gas ->
  Address ->
  Keccak256 ->
  Text ->
  [Text] ->
  Maybe CC.FunctionCallType ->
  m ExecResults
--  call isRunningTests' isHomestead noValueTransfer preExistingSuicideList b callDepth receiveAddress
--       (Address codeAddress) sender value gasPrice theData availableGas origin txHash chainId metadata =
call blockData codeAddress sender' proposer' availableGas origin' txHash' funcName argsStrings mFuncCallType = do
  snd <$> callReturnEnv blockData codeAddress sender' proposer' availableGas origin' txHash' funcName argsStrings mFuncCallType

callReturnEnv ::
  SolidVMBase m =>
  BlockHeader ->
  Address ->
  Address ->
  Address ->
  Gas ->
  Address ->
  Keccak256 ->
  Text ->
  [Text] ->
  Maybe CC.FunctionCallType ->
  m (Env.Environment, ExecResults)
callReturnEnv blockData codeAddress sender' proposer' availableGas origin' txHash' funcName argsStrings mFuncCallType = do
  recordCall
  isRunningTests <- checkIfRunningTests
  let env' =
        Env.Environment
          { Env.blockHeader = blockData,
            Env.sender = sender',
            Env.origin = origin',
            Env.proposer = proposer',
            Env.txHash = txHash',
            Env.src = Nothing,
            Env.name = Nothing,
            Env.runningTests = isRunningTests,
            Env.prevBlock = Nothing
          }

  let gasInfo' =
        GasInfo
          { _gasLeft = availableGas,
            _gasUsed = 0,
            _gasInitialAllotment = availableGas,
            _gasMetadata = ""
          }

  fmap (fmap $ either solidvmErrorResults id) . runTransaction Nothing env' gasInfo' $ do
    --requireOriginCert origin'
    let -- maybeSrcLength = M.lookup "srcLength" =<< metadata
        -- !srcLength = maybe 0 (\sl -> read (T.unpack sl) :: Int) maybeSrcLength
        srcLength = 0
        !argExps = either (parseError "call arguments") id $
          traverse (Fast.parseArg (initialParserStateWithLength srcLength) "") argsStrings
    argVals <- argsToVals argExps

    maybeVal <-
      call' sender' codeAddress (fromMaybe CC.DefaultCall mFuncCallType) (textToLabel funcName) argVals

    finalAct <- Mod.get (Mod.Proxy @Action)
    finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
    let (newV, remV) = fromDelta . getDeltasFromEvents $ toList finalEvs
        stakeEventSource = Conf.stakeEventSourceAt (Conf.networkConfig ethConf) (BlockHeader.number blockData)

    return $
      ExecResults
        { erRemainingTxGas = 0, --Just use up all the allocated gas for now....
          erRefund = 0,
          erReturnVal = maybeVal,
          erTrace = [],
          erLogs = [],
          erEvents = toList finalEvs,
          erNewContractAddress = Nothing,
          erSuicideList = S.empty,
          erAction = Just $ finalAct,
          erException = Nothing, -- tells me if theres an exception
          erPragmas = [],
          erNewValidators = newV,
          erRemovedValidators = remV,
          erStakeUpdates = getStakeDeltasFromEvents stakeEventSource $ toList finalEvs
        }

call' ::
  Address ->
  Address ->
  CC.FunctionCallType ->
  SolidString ->
  ValList ->
  SM (Maybe Value)
call' from to' fnCalltype functionName valList = do
  currentCall <- getCurrentCallInfoIfExists
  (isExternal, storageAddress, codeAddress) <- case fnCalltype of
    CC.DelegateCall -> return (True, from, to')
    CC.RawCall -> return (True, to', to')
    _ -> (from /= to', to',) <$> do
      if from == to'
        then case currentCall of
          Just callInfo -> pure $ currentCodeAddress callInfo
          _ -> pure to'
        else pure to'
  let shouldPushSender = bool False (fnCalltype /= CC.DelegateCall) isExternal
      currentReadOnly = maybe False readOnly currentCall
  (contract, hsh, cc) <- getCodeAndCollection codeAddress

  unless (maybe False ((storageAddress ==) . currentAddress) currentCall) $
    initializeAction storageAddress

  let lookupFunction name
        | name == "<constructor>" = Just $ fromMaybe emptyFunction (contract ^. CC.constructor)
        | otherwise = M.lookup name (contract ^. CC.functions)
        where
          emptyFunction = CC.Func [] [] Nothing (Just []) Nothing False Nothing M.empty [] dummyAnnotation False []
          dummyAnnotation :: SourceAnnotation ()
          dummyAnnotation =
            SourceAnnotation
              { _sourceAnnotationStart =
                  SourcePosition
                    { _sourcePositionName = "",
                      _sourcePositionLine = 0,
                      _sourcePositionColumn = 0
                    },
                _sourceAnnotationEnd =
                  SourcePosition
                    { _sourcePositionName = "",
                      _sourcePositionLine = 0,
                      _sourcePositionColumn = 0
                    },
                _sourceAnnotationAnnotation = ()
              }

  let functionName' =
        case fnCalltype of
          CC.DefaultCall -> functionName
          _
            | not (T.any (== '(') functionName) -> functionName
            | otherwise -> case Fast.parseExternalCallArgs initialParserState "" (labelToText functionName) of
                Right (funcToCall, _) -> funcToCall
                _ -> functionName
      nullifyRefs (ts, v) = case v of
        Just ref@(SReference _) | isExternal -> do
          let retType = case ts of
                [(_, CC.IndexedType _ t _)] -> t
                _ -> SVMType.UnknownLabel ""
          resolved <- resolveArgRef storageAddress contract cc retType ref
          case resolved of
            -- Still an unresolved reference after loading — the slot is empty
            -- and the return type isn't an array/struct we could materialize.
            SReference _ -> pure $ Just SNULL
            v' -> pure $ Just v'
        _ -> pure v

      resolveArgs shouldResolve theFunction args
        | shouldResolve = resolveArgRefs from contract cc (CC._funcArgs theFunction) args
        | otherwise     = pure args

  f <- (nullifyRefs =<<) <$> case (lookupFunction functionName', fnCalltype) of
      -- Standard contract call
      -- (Just theFunction, _)
      (Just theFunction, CC.DefaultCall) -> do
        let isForbidden = theFunction ^. CC.funcVisibility == Just CC.Private || theFunction ^. CC.funcVisibility == Just CC.Internal
        when (isExternal && isForbidden) $
          unknownFunction "logFunctionCall" (functionName, "asdf2" :: String) -- contract) -- ^. CC.contractName)
        resolvedValList <- resolveArgs shouldPushSender theFunction valList
        pure . bool id (pushSender from) shouldPushSender $
          runTheCall storageAddress codeAddress contract functionName' hsh cc theFunction resolvedValList currentReadOnly False
      -- Handles .call() and .delegatecall() logic
      (Just theFunction, _) -> do
        let isForbidden = theFunction ^. CC.funcVisibility == Just CC.Private || theFunction ^. CC.funcVisibility == Just CC.Internal
        when (isExternal && isForbidden) $
          unknownFunction "logFunctionCall" (functionName, "asdf" :: String) -- contract ^. CC.contractName)
        validateFunctionArguments cc contract theFunction valList >>= \case
          Just (theFunction', valList') -> do
            resolvedValList <- resolveArgs shouldPushSender theFunction' valList'
            let validation =
                  if fnCalltype == CC.DelegateCall && not shouldPushSender
                    then validatedCallMode theFunction valList'
                    else NeedsValidation
            pure . bool id (pushSender from) shouldPushSender $
              runTheCallValidated validation storageAddress codeAddress contract functionName' hsh cc theFunction' resolvedValList currentReadOnly False
          _ -> case lookupFunction "fallback" of
            Just fallbackFunc -> do
              resolvedValList <- resolveArgs shouldPushSender fallbackFunc valList
              pure . bool id (pushSender from) shouldPushSender $
                runTheCall storageAddress codeAddress contract functionName' hsh cc fallbackFunc resolvedValList currentReadOnly False
            _ -> unknownFunction "logFunctionCall" (functionName, valList) -- contract ^. CC.contractName)
      -- Maybe the function is actually a getter
      _ -> case M.lookup functionName $ contract ^. CC.storageDefs of
        Just CC.VariableDecl {..} | not (isExternal && _varVisibility /= Just CC.Public) -> do
          _ <- Runtime.compiledContract hsh cc contract
          let args' = fromMaybe [] $ case (_varType, valList) of
                ((SVMType.Array _ _), oa) -> for oa $ \case
                  SInteger n -> Just . MS.Index . BC.pack $ show n
                  _ -> Nothing
                ((SVMType.Mapping _ _ _ _ _), oa) ->
                  traverse convertValueToStoragePathPiece oa
                _ -> Nothing
              returnType = \case
                SVMType.Array t _ -> returnType t
                SVMType.Mapping _ _ t _ _ -> returnType t
                t -> t
              handleStruct s path = do
                mFields <- case M.lookup s $ contract ^. CC.structs of
                  Just vals -> pure . Just $ (\(a, t, _) -> (a, CC.fieldTypeType t)) <$> vals
                  Nothing -> do
                    let !vals' = M.lookup s $ cc ^. CC.flStructs
                    pure $ map (\(a, t, _) -> (a, CC.fieldTypeType t)) <$> vals'
                for mFields $ \fields -> do
                  let fieldsToLoad = catMaybes $ (\(n, t) -> case t of
                          SVMType.Error{} -> Nothing
                          SVMType.Array{} -> Nothing
                          SVMType.Mapping{} -> Nothing
                          _ -> Just n
                        ) <$> fields
                  fieldVals <- for fieldsToLoad $ \fieldName ->
                    getVar $ Constant $ SReference $ path `MS.snoc` MS.Field (BC.pack $ labelToString fieldName)
                  fieldVars <- traverse createVar fieldVals
                  pure . STuple $ V.fromList fieldVars
              handleSimple path = do
                v <- getVar $ Constant $ SReference path
                pure $ Just v
              typeTuple = [(Nothing, CC.IndexedType 0 (returnType _varType) Nothing)]
          case args' of
            [] -> do
              let path = MS.singleton $ BC.pack $ labelToString functionName
              pure . fmap (typeTuple,) . withCallInfo storageAddress codeAddress contract functionName hsh cc M.empty True False $ case returnType _varType of
                SVMType.Struct _ s -> (<|>) <$> handleStruct s path <*> handleSimple path
                SVMType.UnknownLabel s -> (<|>) <$> handleStruct s path <*> handleSimple path
                _ -> handleSimple path
            _ -> do
              let path = MS.snocList (MS.singleton $ BC.pack $ labelToString functionName) args'
              pure . fmap (typeTuple,) . withCallInfo storageAddress codeAddress contract functionName hsh cc M.empty True False $ case returnType _varType of
                SVMType.Struct _ s -> (<|>) <$> handleStruct s path <*> handleSimple path
                SVMType.UnknownLabel s -> (<|>) <$> handleStruct s path <*> handleSimple path
                _ -> handleSimple path
        _ -> case lookupFunction "fallback" of
          Just fallbackFunc -> do
            resolvedValList <- resolveArgs shouldPushSender fallbackFunc valList
            pure . bool id (pushSender from) shouldPushSender $
              runTheCall storageAddress codeAddress contract functionName hsh cc fallbackFunc resolvedValList currentReadOnly False
          _ -> unknownFunction "logFunctionCall" (functionName, "asdf5" :: String) -- ^. CC.contractName)

  when (fnCalltype == CC.DelegateCall) $
    addDelegatecall storageAddress hsh (labelToText $ contract ^. CC.contractName)
  logFunctionCall valList storageAddress contract functionName f
  where
    convertValueToStoragePathPiece :: Value -> Maybe MS.StoragePathPiece
    convertValueToStoragePathPiece v =
      case v of
        SInteger i -> Just $ MS.Index $ BC.pack $ show i
        SString s -> Just $ MS.Index $ DT.encodeUtf8 $ T.pack s
        SAddress a _ -> Just $ MS.Index $ BC.pack $ show a
        SBool b -> Just $ MS.Index $ bool "false" "true" b
        _ -> Nothing

logFunctionCall :: ValList -> Address -> CC.Contract -> SolidString -> SM (Maybe Value) -> SM (Maybe Value)
logFunctionCall args address contract functionName f = do
  onTracedSM contract $ do
    argStrings <- fmap (intercalate ", ") $ forM args showSM

    let shownFunc = labelToString functionName ++ "(" ++ argStrings ++ ")"
    multilineLog "Calling function" $
      boringBox
        [ "Address: " ++ format address,
          labelToString (contract ^. CC.contractName) ++ "/" ++ shownFunc
        ]

  result <- f

  onTracedSM contract $ do
    resultString <- maybe (return "()") showSM result
    liftIO $ putStrLn $ box ["returning from " ++ labelToString functionName ++ ":", resultString]

  return result

runTheConstructors :: Address -> Address -> Keccak256 -> CC.CodeCollection -> SolidString -> ValList -> SM ()
runTheConstructors from to hsh cc contractName' argVals' = do
  let !contract' =
        fromMaybe (missingType "contract inherits from nonexistent parent" contractName') $
          cc ^. CC.contracts . at contractName'
      argPairs = fromMaybe [] . fmap CC._funcArgs $ contract' ^. CC.constructor
      argTypeNames =
        map fst $
          sortOn snd $
            [ ((t, fromMaybe "" n), i)
              | (n, CC.IndexedType {CC.indexedTypeType = t, CC.indexedTypeIndex = i}) <- argPairs
            ]
  onTraced $
    liftIO $
      putStrLn $
        box
          ["running constructor: " ++ labelToString contractName' ++ "(" ++ intercalate ", " (map (labelToString . snd) argTypeNames) ++ ")"]

  argVals <- case contract' ^. CC.constructor of
    Nothing -> pure argVals'
    Just theConstructor -> validateFunctionArguments cc contract' theConstructor argVals' >>= \case
      Just (_, vals) -> pure vals
      Nothing -> invalidArguments "constructor arguments don't match" (contractName', argVals')

  nativeArgs <- liftIO $ newIORef $ maybe [] (const argVals) (contract' ^. CC.constructor)
  let runStage stage = do
        fun <- Runtime.constructorStage hsh cc contract' stage
        values <- liftIO $ readIORef nativeArgs
        result <- runAction cc contract' "constructor" (CC._contractContext contract') fun values
        if stage == "<constructor>" then pure result else case result of
          Just (STuple outputs) -> case V.toList outputs of
            [updatedVar, valueVar] -> do
              updated <- getVar updatedVar
              case updated of
                SVariadic parameters | length parameters == length argTypeNames ->
                  liftIO $ writeIORef nativeArgs parameters
                _ -> internalError "constructor parameter snapshot" stage
              Just <$> getVar valueVar
            _ -> internalError "constructor stage result" stage
          _ -> internalError "constructor stage result" stage

  void . withCallInfo to to contract' "constructor" hsh cc M.empty False False . pushSender from $ do

    void $ runStage "<initializers>"

    forM_ [(n, theType) | (n, CC.VariableDecl theType _ Nothing _ _) <- M.toList $ contract' ^. CC.storageDefs] $ \(n, theType) -> do
      case theType of
        SVMType.Mapping _ _ _ _ _ -> return ()
        SVMType.Array _ _ -> return ()
        t -> do
          defVal <- createDefaultValue cc contract' t
          currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
          for_ (toBasic currentBlockNum defVal) $ markDiffForAction to (MS.StoragePath [MS.Field $ BC.pack $ labelToString n])
    -- SVMType.Bool -> markDiffForAction to (MS.StoragePath [MS.Field $ BC.pack $ labelToString n]) $ MS.BBool False

    forM_ (reverse $ contract' ^. CC.parents) $ \parent -> do
      -- Get explicit constructor args if present, otherwise use empty args for parameterless constructors
      let maybeArgs = M.lookup parent . CC._funcConstructorCalls =<< contract' ^. CC.constructor
      case maybeArgs of
        Just _ -> do
          result <- runStage parent
          vals <- case result of
            Just (SVariadic vs) -> pure vs
            _ -> internalError "native parent constructor arguments" parent
          runTheConstructors from to hsh cc parent vals
        Nothing -> do
          -- Only call parent constructor with empty args if it has no parameters
          -- (If parent constructor requires args and child doesn't provide them,
          -- the child is using an initializer pattern - don't auto-call)
          let parentContract = cc ^. CC.contracts . at parent
              parentConstructorArgs = fromMaybe [] . fmap CC._funcArgs . (>>= (^. CC.constructor)) $ parentContract
          when (null parentConstructorArgs) $
            runTheConstructors from to hsh cc parent []

    case contract' ^. CC.constructor of
      Just _ -> void $ runStage "<constructor>"
      Nothing -> return ()
    addDelegatecall to hsh $ labelToText contractName'

  return ()

getPrevBlockFacts :: MonadSM m => m ProposalFacts
getPrevBlockFacts = do
  env' <- getEnv
  case Env.prevBlock env' of
    Just facts -> pure facts
    Nothing ->
      maybe noProposalFacts bSumProposalFacts
        <$> A.lookup (A.Proxy @BlockSummary) (BlockHeader.parentHash $ Env.blockHeader env')

-- The shared transaction-state runner treats unknown exceptions as receipts.
-- Engine and host failures must escape it and stop block execution.
runTransaction :: Maybe Code -> Env.Environment -> GasInfo -> SM a -> ContextM (Env.Environment, Either SolidException a)
runTransaction code environment gas action = do
  fatal <- newIORef Nothing
  result <- runSM code environment gas $ action `catch` (\(e :: SomeException) -> do
    case fromException e :: Maybe SolidException of
      Just InternalError{} -> writeIORef fatal (Just e)
      Just TODO{} -> writeIORef fatal (Just e)
      Just _ -> pure ()
      Nothing -> writeIORef fatal (Just e)
    throwIO e)
  readIORef fatal >>= mapM_ throwIO
  pure result

argsToVals :: CC.ArgList -> SM ValList
argsToVals = traverse literalValue
  where
    literalValue expression = do
      decrementGas 1
      case expression of
        CC.NumberLiteral _ n unit -> pure $ SInteger $ n * case unit of
          Nothing -> 1
          Just CC.Wei -> 1
          Just CC.Szabo -> 10 ^ (12 :: Integer)
          Just CC.Finney -> 10 ^ (15 :: Integer)
          Just CC.Ether -> 10 ^ (18 :: Integer)
        CC.DecimalLiteral _ n -> pure $ SDecimal (CC.unwrapDecimal n)
        CC.StringLiteral _ s -> pure $ SString s
        CC.AddressLiteral _ a -> pure $ SAddress a False
        CC.BoolLiteral _ b -> pure $ SBool b
        CC.HexaLiteral _ s -> pure $ SBytes $ either (parseError "hexadecimal argument") id (B16.decode (DT.encodeUtf8 s))
        CC.ArrayExpression _ xs -> SArray . V.fromList . map Constant <$> traverse literalValue xs
        CC.ObjectLiteral _ fields -> SStruct "" . M.map Constant <$> traverse literalValue fields
        _ -> invalidArguments "transaction argument must be a literal" (unparseExpression expression)

data CallValidation = NeedsValidation | AlreadyValidated

validatedCallMode :: CC.Func -> ValList -> CallValidation
validatedCallMode original vals
  | null (CC._funcOverload original) && not (any isReference vals) = AlreadyValidated
  | otherwise = NeedsValidation
  where
    isReference SReference{} = True
    isReference _ = False

runTheCall :: Address -> Address -> CC.Contract -> SolidString -> Keccak256 -> CC.CodeCollection -> CC.Func -> ValList -> Bool -> Bool -> SM ([(Maybe SolidString, CC.IndexedType)], Maybe Value)
runTheCall = runTheCallValidated NeedsValidation

runTheCallValidated :: CallValidation -> Address -> Address -> CC.Contract -> SolidString -> Keccak256 -> CC.CodeCollection -> CC.Func -> ValList -> Bool -> Bool -> SM ([(Maybe SolidString, CC.IndexedType)], Maybe Value)
runTheCallValidated validation address codeAddress contract name hsh cc original args ro ff = do
  (selected, values) <- case validation of
    AlreadyValidated -> pure (original, args)
    NeedsValidation -> validateFunctionArguments cc contract original args >>= \case
      Just pair -> pure pair
      Nothing -> typeError "function arguments do not match" (labelToString name)
  fun <- Runtime.compiledFunction hsh cc contract name selected
  decrementGas 5
  result <- withCallInfo address codeAddress contract name hsh cc M.empty ro ff $
    runAction cc contract name (CC._funcContext selected) fun values
  pure (selected ^. CC.funcVals, result)

runAction :: CC.CodeCollection -> CC.Contract -> T.Text -> SourceAnnotation () -> N.Fun -> ValList -> SM (Maybe Value)
runAction cc contract name annotation = Runtime.runAction (decrementGas . Gas) call' createContractValues host emit cc contract name
  where
    host = Runtime.Host createCode selfdestruct getPrevBlockFacts derive
    emit eventContractName event values = do
      eventContract <- maybe (missingType "event contract" eventContractName) pure $ M.lookup eventContractName (cc ^. CC.contracts)
      void $ emitEventValuesForContract eventContract (CC.EmitStatement event [] annotation) event values

createCode :: Maybe Value -> T.Text -> T.Text -> ValList -> SM Address
createCode salt name source args = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "contract creation during read-only access" (T.unpack name)
  creator <- getCurrentAddress
  isRunningTests <- Env.runningTests <$> getEnv
  opts <- parseOptionsForCurrentBlock
  (hsh, cc) <- codeCollectionFromSourceWith opts isRunningTests True (DT.encodeUtf8 source)
  addNewCodeCollection hsh cc
  address <- case salt of
    Nothing -> getNewAddress creator
    Just s -> getNewAddressWithSalt creator s hsh (SString (T.unpack name) : args)
  result <- create' creator address hsh cc name args
  pure $ fromMaybe (internalError "create did not produce an address" result) (erNewContractAddress result)

selfdestruct :: Address -> SM Bool
selfdestruct target = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "selfdestruct during read-only access" (show target)
  address <- getCurrentAddress
  balance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy @AddressState) address
  A.adjustWithDefault_ (A.Proxy @AddressState) address $ \addressState ->
    pure addressState {addressStateCodeHash = SolidVMCode "Code_0" (unsafeCreateKeccak256FromWord256 0)}
  sent <- pay "selfdestruct function" address target balance
  purgeStorageMap address
  pure sent

derive :: Address -> T.Text -> T.Text -> ValList -> SM Address
derive address salt name args = do
  (_, hsh, _) <- getCodeAndCollection address
  pure $ getNewAddressWithSalt_unsafe address (T.unpack salt) (keccak256ToByteString hsh) (SString (T.unpack name) : args)
