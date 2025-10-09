{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
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

module Blockchain.SolidVM
  ( SolidVMBase,
    call,
    create,
  )
where

import BlockApps.Logging
import BlockApps.X509.Certificate
import BlockApps.X509.Keys
import Blockchain.DB.CodeDB
import Blockchain.DB.ModifyStateDB (pay)
import Blockchain.DB.SolidStorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockHeader (BlockHeader)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.ExecResults
import Blockchain.Data.RLP
import Blockchain.Data.Transaction (whoSignedThisTransactionEcrecover)
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.SolidVM.Builtins as Builtins
import Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.GasInfo
import Blockchain.SolidVM.Metrics
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Blockchain.SolidVM.TraceTools
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Delta
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Secp256k1 as SEC
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action
import Blockchain.VMContext
import Blockchain.VMOptions
import Control.Applicative
import Control.Arrow ((***))
import Control.DeepSeq (force)
import Control.Exception (throw)
import Control.Lens hiding (Context, assign, from, to, uncons, unsnoc)
import Control.Monad
import qualified Control.Monad.Catch as EUnsafe
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Extra (fromMaybeM)
import Control.Monad.IO.Class
import Control.Monad.Trans.Maybe
import qualified Crypto.Hash.RIPEMD160 as RIPEMD160
import qualified Crypto.Hash.SHA256 as SHA256
import Data.Bits
import Data.Bool (bool)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.UTF8 as UTF8
import Data.Char as CHAR
import Data.Decimal
import Data.Either.Extra (eitherToMaybe)
import Data.Foldable (for_)
import Data.List
import qualified Data.List.NonEmpty as NE
import qualified Data.Map as M
import qualified Data.Map.Merge.Lazy as M
import Data.Maybe
import qualified Data.Sequence as Q
import qualified Data.Set as S
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import Data.Time.Clock
import Data.Time.Clock.POSIX
import Data.Traversable
import qualified Data.Vector as V
import Debugger
import GHC.Exts hiding (breakpoint)
import qualified LabeledError
--import Blockchain.DB.RawStorageDB
--import Blockchain.Data.BlockSummary
--import Blockchain.DB.MemAddressStateDB

import Network.Haskoin.Crypto.BigWord ()
import qualified Numeric (readHex)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
import SolidVM.Solidity.Parse.Lexer (stringLiteral)
import SolidVM.Solidity.Parse.ParserTypes
import SolidVM.Solidity.Parse.Statement
import SolidVM.Solidity.Parse.UnParser hiding (sortWith)
import qualified Text.Colors as C
import Text.Format
import Text.Parsec (runParser)
import Text.Printf
import Text.Read (readEither, readMaybe)
import Text.Tools
import UnliftIO hiding (assert)


type SolidVMBase m = VMBase m

onTraced :: Monad m => m () -> m ()
onTraced = when flags_svmTrace

-- TL;DR Use onTracedSM whenever you have a showSM in a trace over onTraced
-- Full: In some onTraced logging statements we called showSM. Through a series
-- of function calls (showSM -> getVar -> getSolidStorageKeyVal'
-- -> getRawStorageKeyVal' -> getRawStorageKeyValMC -> lookupWithDefault
-- -> genericLookupRawStorageDB) we end up calling genericLookupRawStorageDB.
-- This adds default values to the MP Trie whenever we lookup a nonexistant
-- value in our DB. THIS IS PROBLOMATIC, we are adding somthing to the MP Trie
-- (and therefore changing the stateroot) for just having a logging statement!
-- TODO: Do not add default values to RawStorageDBs for SolidVM > 3.
onTracedSM :: MonadSM m => CC.Contract -> m () -> m ()
onTracedSM _ = when flags_svmTrace

withSrcPos :: MonadIO m => SourceAnnotation () -> String -> m ()
withSrcPos pos str =
  liftIO . putStrLn $
    concat
      [ show $ _sourceAnnotationStart pos,
        ": ",
        str
      ]

runExpr :: MonadSM m => EvaluationRequest -> m EvaluationResponse
runExpr exprText = withoutDebugging . withTempCallInfo True $ do
  -- TODO: allow write access once we figure out how to discard changes
  let eExpr = runParser expression initialParserState "" (T.unpack exprText)
  case eExpr of
    Left pe -> pure . Left . T.pack $ show pe
    Right expr -> do
      eRes <- EUnsafe.try $ do
        var <- expToVar expr Nothing
        val <- getVar var
        str <- showSM val
        case (force str) of -- stupid code to get lazy exceptions to be thrown within the try block
          [] -> pure []
          xs -> pure xs
      pure $ bimap (T.pack . showSolidException) T.pack eRes

solidVMBreakpoint :: MonadSM m => SourceAnnotation () -> m ()
solidVMBreakpoint ann = do
  let pos = _sourceAnnotationStart ann
  Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
    [] -> pure []
    (ci : cis) -> pure $ ci {currentSourcePos = Just pos} : cis
  breakpoint runExpr

-- end debugger-related code

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
            Env.runningTests = isRunningTests
          }
  let gasInfo' =
        GasInfo
          { _gasLeft = availableGas,
            _gasUsed = 0,
            _gasInitialAllotment = availableGas,
            _gasMetadata = ""
          }

  fmap (either solidvmErrorResults id) . runSM (Just code) env' gasInfo' $ do

    (hsh, cc) <- codeCollectionFromSource isRunningTests True $ DT.encodeUtf8 initCode
    (issuerAcct, _, issuerName) <- getCreator origin'
    let eArgExps = traverse (runParser parseArg initialParserState "" . T.unpack) argsStrings
        !argExps = either (parseError "create arguments") CC.OrderedArgs eArgExps
    argVals <- argsToVals argExps

    create' sender' newAddress issuerAcct issuerName newAddress hsh cc (T.unpack contractName) argVals

getParentName :: MonadSM m => Address -> m String
getParentName address = fromMaybeM (return "") $
                        runMaybeT $
                          pure address -- Code pointer's address
                            >>= MaybeT . A.lookup (A.Proxy @AddressState) -- Address's state
                            >>= pure . addressStateCodeHash -- state's Acodehash/CodePtr
                            >>= ( \case
                                    SolidVMCode name _ -> pure name -- Name of the parent
                                    _ -> pure ""
                            )

create' :: MonadSM m => Address -> Address -> Address -> String -> Address -> Keccak256 -> CC.CodeCollection -> SolidString -> ValList -> m ExecResults
create' creator originAddress issuerAcct issuerName newAddress ch cc contractName' valList = do
  
  -- Get parentName and cc_creator from maybeCodePtr or creator
  parentName <-  getParentName creator

  let !contract' = fromMaybe (missingType "create'/contract" contractName') (cc ^. CC.contracts . at contractName')
      !abstracts' = getAbstractParentsFromContract contract' cc
  -- $logInfoS "create': contract' " . T.pack $ show $ contract'
  -- $logInfoS "create': abstracts1' " . T.pack $ show $ abstracts'
  !abstracts <- M.fromList <$> traverse (resolveNameParts newAddress (T.pack issuerName) (T.pack parentName)) abstracts'

  initializeAction newAddress (labelToString contractName') issuerName Nothing (show originAddress) parentName ch cc abstracts

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

  void . withCallInfo newAddress contract' "constructor" ch cc M.empty False False $ pure ()

  env <- getEnv
  let -- metadata = Env.metadata env
      maybeUseWallet = Nothing
--        M.lookup "useWallet" =<< metadata
      !useWallet = maybe False (const True) maybeUseWallet
      parentName' = bool parentName "" (useWallet && parentName == "User")
  -- set creator
  setCreator issuerAcct originAddress newAddress contract' (BlockHeader.number $ Env.blockHeader env)

  -- Run the constructor
  runTheConstructors creator newAddress ch cc contractName' valList

  onTraced $ liftIO $ putStrLn $ C.green $ "Done Creating Contract: " ++ show newAddress ++ " of type " ++ labelToString contractName'

  void . withCallInfo newAddress contract' "constructor" ch cc M.empty False False $ do
    -- set creator again, in case the caller's cert changed during constructor execution
    setCreator issuerAcct originAddress newAddress contract' (BlockHeader.number $ Env.blockHeader env)

  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData %= Action.omapAdjust (Action.actionDataCreator .~ (T.pack issuerName)) newAddress

  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData %= Action.omapAdjust (Action.actionDataCCCreator .~ Nothing) newAddress
    
  when (useWallet && parentName == "User") $ Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData %= Action.omapAdjust (Action.actionDataApplication .~ (T.pack "")) newAddress
  -- I'm showing these strings because I like them to be in quotes in the logs :)
  multilineLog "create'/versioning" $ boringBox ["Contract Name: " ++ (C.yellow contractName'), "App: " ++ (C.yellow parentName'), "Creator: " ++ (C.yellow issuerName)]

  finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
  finalAct <- Mod.get (Mod.Proxy @Action)
  let ((newV, remV), (newC, revC)) = (fromDelta *** fromDelta) . getDeltasFromEvents $ toList finalEvs
  return
    ExecResults
      { erRemainingTxGas = 0, --Just use up all the allocated gas for now....
        erRefund = 0,
        erReturnVal = Just "",
        erTrace = [],
        erLogs = [],
        erEvents = toList finalEvs,
        erNewContractAddress = Just newAddress,
        erSuicideList = S.empty,
        erAction = Just finalAct,
        erException = Nothing,
        erPragmas = CC._pragmas cc,
        erCreator = issuerName,
        erAppName = parentName',
        erNewValidators = newV,
        erRemovedValidators = remV,
        erNewCerts = newC,
        erRevokedCerts = revC
      }

call ::
  SolidVMBase m =>
  Bool ->
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
call isRCC blockData codeAddress sender' proposer' availableGas origin' txHash' funcName argsStrings mFuncCallType = do
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
            Env.runningTests = isRunningTests
          }

  let gasInfo' =
        GasInfo
          { _gasLeft = availableGas,
            _gasUsed = 0,
            _gasInitialAllotment = availableGas,
            _gasMetadata = ""
          }

  fmap (either solidvmErrorResults id) . runSM Nothing env' gasInfo' $ do
    --requireOriginCert origin'
    let -- maybeSrcLength = M.lookup "srcLength" =<< metadata
        -- !srcLength = maybe 0 (\sl -> read (T.unpack sl) :: Int) maybeSrcLength
        srcLength = 0
        eArgExps = traverse (runParser parseArg (initialParserStateWithLength srcLength) "" . T.unpack) argsStrings
        !argExps = either (parseError "call arguments") CC.OrderedArgs eArgExps
    argVals <- argsToVals argExps

    ((creator, appName), returnVal) <-
      traverse (fmap Just . maybe (return "()") encodeForReturn)
        =<< call' sender' codeAddress (fromMaybe CC.DefaultCall mFuncCallType) Nothing (textToLabel funcName) isRCC argVals

    finalAct <- Mod.get (Mod.Proxy @Action)
    finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
    let ((newV, remV), (newC, revC)) = (fromDelta *** fromDelta) . getDeltasFromEvents $ toList finalEvs

    return $
      ExecResults
        { erRemainingTxGas = 0, --Just use up all the allocated gas for now....
          erRefund = 0,
          erReturnVal = returnVal,
          erTrace = [],
          erLogs = [],
          erEvents = toList finalEvs,
          erNewContractAddress = Nothing,
          erSuicideList = S.empty,
          erAction = Just $ finalAct,
          erException = Nothing, -- tells me if theres an exception
          erPragmas = [],
          erCreator = creator,
          erAppName = appName,
          erNewValidators = newV,
          erRemovedValidators = remV,
          erNewCerts = newC,
          erRevokedCerts = revC
        }

call' ::
  MonadSM m =>
  Address ->
  Address ->
  CC.FunctionCallType ->
  Maybe SolidString ->
  SolidString ->
  Bool ->
  ValList ->
  m ((SolidString, SolidString), Maybe Value)
call' from to' fnCalltype mContract functionName isRCC valList = do
  let (to, ccToGet) = case fnCalltype of
        CC.DefaultCall -> (to', to')
        CC.RawCall -> (to', to')
        CC.DelegateCall -> (from, to')
  (contract', hsh, cc) <- getCodeAndCollection ccToGet
  (toName, parentName) <- do
    ch <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) to
    let n = case ch of
              SolidVMCode n' _ -> n' 
              _ -> ""
    case ch of
      SolidVMCode name _ -> pure (n, stringToLabel name) -- Name of the parent
      _ -> pure (n, "")

  let contract = fromMaybe contract' $ mContract >>= \c -> M.lookup c $ CC._contracts cc
      parentName' = if parentName == (CC._contractName contract) then "" else parentName

  let !abstracts' = getAbstractParentsFromContract contract cc

  -- grab the org from the senders account and set it to the codeAddress
  cnAccount <-
    if isRCC
      then
        addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) to >>= \_ -> pure from
      else pure to
  (ctr, oAddr, ctrName) <- getCreator cnAccount
  !abstracts <- M.fromList <$> traverse (resolveNameParts to (T.pack ctrName) (T.pack parentName')) abstracts'

  initializeAction to (labelToString toName) (labelToString ctrName) Nothing (show oAddr) (labelToString parentName') hsh cc abstracts

  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData %= Action.omapAdjust (Action.actionDataCreator .~ (T.pack ctrName)) to
  when (isRCC) $
    (\env -> setCreator ctr to to contract (BlockHeader.number $ Env.blockHeader env)) =<< getEnv

  let functionsIncludingConstructor =
        case contract ^. CC.constructor of
          Nothing -> M.insert "<constructor>" emptyFunction $ contract ^. CC.functions
          Just c -> M.insert "<constructor>" c $ contract ^. CC.functions
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
          -- Handles RawCall and DelegateCall function signature parsing
          _ ->
            ( case runParser parseExternalCallArgs initialParserState "" functionName of
                Right (funcTocall, _) -> funcTocall
                _ -> functionName
            )

  f <- case (M.lookup functionName' functionsIncludingConstructor, fnCalltype) of
      -- Standard contract call
      -- (Just theFunction, _)
      (Just theFunction, CC.DefaultCall) -> do
        mCallInfo <- getCurrentCallInfoIfExists
        let isForbidden = theFunction ^. CC.funcVisibility == Just CC.Private || theFunction ^. CC.funcVisibility == Just CC.Internal
        when ((from /= to) && isForbidden) $
          unknownFunction "logFunctionCall" (functionName, "asdf2" :: String) -- contract) -- ^. CC.contractName)
        let ro = case mCallInfo of
              Nothing -> False
              Just ci -> readOnly ci
        pure . bool (pushSender from) id (from == to) $
          runTheCall to contract functionName' hsh cc theFunction valList ro False
      -- Handles .call() and .delegatecall() logic
      (Just theFunction, _) -> do
        let isForbidden = theFunction ^. CC.funcVisibility == Just CC.Private || theFunction ^. CC.funcVisibility == Just CC.Internal
        when ((from /= to) && isForbidden) $
          unknownFunction "logFunctionCall" (functionName, "asdf" :: String) -- contract ^. CC.contractName)
        validateFunctionArguments theFunction valList >>= \case
          Just (theFunction', valList') -> do
            mCallInfo <- getCurrentCallInfoIfExists
            let ro = case mCallInfo of
                  Nothing -> False
                  Just ci -> readOnly ci
            pure . bool (pushSender from) id (from == to) $
              runTheCall to contract functionName' hsh cc theFunction' valList' ro False
          _ -> case M.lookup "fallback" functionsIncludingConstructor of
            Just fallbackFunc -> do
              mCallInfo <- getCurrentCallInfoIfExists
              let ro = case mCallInfo of
                    Nothing -> False
                    Just ci -> readOnly ci
              pure . bool (pushSender from) id (from == to) $
                runTheCall to contract functionName' hsh cc fallbackFunc valList ro False
            _ -> unknownFunction "logFunctionCall" (functionName, valList) -- contract ^. CC.contractName)
      -- Maybe the function is actually a getter
      _ -> case M.lookup functionName $ contract ^. CC.storageDefs of
        Just CC.VariableDecl {..} -> do
          let args' = fromMaybe [] $ case (_varType, valList) of
                ((SVMType.Array _ _), OrderedVals oa) -> for oa $ \case
                  SInteger n -> Just . MS.ArrayIndex $ fromIntegral n
                  _ -> Nothing
                ((SVMType.Mapping _ _ _), OrderedVals oa) ->
                  traverse convertValueToStoragePathPiece oa
                _ -> Nothing
              returnType = \case
                SVMType.Array t _ -> returnType t
                SVMType.Mapping _ _ t -> returnType t
                t -> t
              isForbidden = not _varIsPublic -- TODO: Stop being lazy and give VariableDecls the full visibility treatment!
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
                    getVar $ Constant $ SReference $ path `apSnoc` MS.Field (BC.pack $ labelToString fieldName)
                  fieldVars <- traverse createVar fieldVals
                  pure . STuple $ V.fromList fieldVars
              handleSimple path = do
                v <- getVar $ Constant $ SReference path
                pure $ Just v
          when ((from /= to) && isForbidden) $
            unknownFunction "logFunctionCall" (functionName, "asdf4" :: String) -- contract ^. CC.contractName)
          -- TODO: this should only exist if the storage variable is declared "public",
          -- right now I just ignore this and allow anything to be called as a getter
          case args' of
            [] -> do
              let path = AccountPath to $ MS.singleton $ BC.pack $ labelToString functionName
              withCallInfo to contract functionName hsh cc M.empty True False $ case returnType _varType of
                SVMType.Struct _ s -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                SVMType.UnknownLabel s _ -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                _ -> pure $ handleSimple path
            _ -> do
              let path = apSnocList (AccountPath to . MS.singleton $ BC.pack $ labelToString functionName) args'
              withCallInfo to contract functionName hsh cc M.empty True False $ case returnType _varType of
                SVMType.Struct _ s -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                SVMType.UnknownLabel s _ -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                _ -> pure $ handleSimple path
        Nothing -> case M.lookup "fallback" functionsIncludingConstructor of
          Just fallbackFunc -> do
            mCallInfo <- getCurrentCallInfoIfExists
            let ro = case mCallInfo of
                  Nothing -> False
                  Just ci -> readOnly ci
            pure . bool (pushSender from) id (from == to) $
              runTheCall to contract functionName hsh cc fallbackFunc valList ro False
          _ -> unknownFunction "logFunctionCall" (functionName, "asdf5" :: String) -- ^. CC.contractName)

  when
    isRCC
    ( do
        void . withCallInfo to contract' "constructor" hsh cc M.empty False False $ do
          forM_ [(n, e) | (n, CC.VariableDecl _ _ (Just e) _ _ _) <- M.toList $ contract' ^. CC.storageDefs] $ \(n, e) -> do
            v <- expToVar e Nothing
            setVar (Constant (SReference (AccountPath to $ MS.StoragePath [MS.Field $ BC.pack $ labelToString n]))) =<< getVar v
          forM_ [(n, theType) | (n, CC.VariableDecl theType _ Nothing _ _ _) <- M.toList $ contract' ^. CC.storageDefs] $ \(n, theType) -> do
            case theType of
              SVMType.Mapping _ _ _ -> return ()
              SVMType.Array _ _ -> return ()
              _ -> markDiffForAction to (MS.StoragePath [MS.Field $ BC.pack $ labelToString n]) MS.BDefault
    )
  when (fnCalltype == CC.DelegateCall) $ do
    (codeContractName, codeContractParentName) <- do
      ch <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) ccToGet
      let n = case ch of
                SolidVMCode n' _ -> n'
                _ -> ""
      case ch of
        SolidVMCode name _ -> pure (n, stringToLabel name) -- Name of the parent
        _ -> pure (n, "")
    (_, _, codeContractCreator) <- getCreator ccToGet
    addDelegatecall from to' (T.pack codeContractCreator) (T.pack codeContractParentName) (T.pack codeContractName)
  ((ctrName, parentName'),) <$> logFunctionCall valList to contract functionName f
  where
    convertValueToStoragePathPiece :: Value -> Maybe MS.StoragePathPiece
    convertValueToStoragePathPiece v = 
      case v of
        SInteger i -> Just $ MS.MapIndex $ MS.INum i
        SString s -> Just $ MS.MapIndex $ MS.IText $ UTF8.fromString s
        SAccount a _ -> Just $ MS.MapIndex $ MS.IAccount a
        SBool b -> Just $ MS.MapIndex $ MS.IBool b
        _ -> Nothing

callWithResult :: MonadSM m => Address -> Address -> CC.FunctionCallType -> Maybe SolidString -> SolidString -> Bool -> ValList -> m (Maybe Value)
callWithResult from to fnCalltype mContract functionName isRCC valList = snd <$> call' from to fnCalltype mContract functionName isRCC valList

-- set the hidden ":creator" field
setCreator :: MonadSM m => Address -> Address -> Address -> CC.Contract -> Integer -> m ()
setCreator creator originAddress contract _ _ = do
  maybeCert <- A.select (A.Proxy @X509Certificate) creator
  let _cn = fromMaybe "" $ fmap subCommonName $ getCertSubject =<< maybeCert

  case maybeCert of
    (Just cert) -> do
      onTraced $ $logDebugS "setCreator/versioning" . T.pack . C.green $ "Found cert for " ++ (format creator) ++ ":\n\t" ++ (format $ getCertSubject cert)
    Nothing -> $logDebugS "setCreator/versioning" . T.pack . C.red $ "No cert found for " ++ (format creator)

  $logDebugS "setCreator/address" . T.pack $ "Setting creatorAddress to: " ++ show creator
  putSolidStorageKeyVal' contract (MS.StoragePath [MS.Field ":creatorAddress"]) (MS.BAccount (NamedAccount creator MainChain))
  let putCreatorField ctr = do
        $logDebugS "setCreator/versioning" . T.pack $ "setting the creator as " ++ (show ctr)
        putSolidStorageKeyVal' contract (MS.StoragePath [MS.Field ":creator"]) (MS.BString $ BC.pack ctr)

  if _cn /= ""
    then putCreatorField _cn
    else do
      $logDebugS "setCreator/versioning" . T.pack . C.red $ "Ignoring creator field for empty creator field"
  
  putSolidStorageKeyVal' contract (MS.StoragePath [MS.Field ":originAddress"]) (MS.BAccount $ NamedAccount originAddress MainChain)

getCreator :: MonadSM m => Address -> m (Address, Address, String) -- (creatorAddress, originAddress, creatorName)
getCreator caller = do
  $logDebugS "getCreator/versioning" . T.pack $ "Getting creator for the caller " ++ format caller
  callerCodeHash <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) caller

  case callerCodeHash of
    ExternallyOwned _ -> do
      -- caller is a user account, so they are creating the first instance of this app
      -- we will look up their cert in the DB and use it to get the org name for this app
      maybeCert <- A.select (A.Proxy @X509Certificate) caller
      let creator' = fromMaybe "" $ fmap subCommonName $ getCertSubject =<< maybeCert
      $logDebugS "getCreator/versioning" . T.pack $ "The creator is " ++ (show creator')
      return (caller, caller, creator')
    _ -> do
      $logDebugS "getCreator/versioning" . T.pack $ "They are part of app contract " ++ (format caller)
      appCreatorAddress <- getSolidStorageKeyVal' caller $ MS.StoragePath [MS.Field ":creatorAddress"]
      appCreator <- getSolidStorageKeyVal' caller $ MS.StoragePath [MS.Field ":creator"]
      case (appCreatorAddress, appCreator)  of
        (MS.BAccount creatorAddress, MS.BString creator') -> do
          $logDebugS "getCreator/versioning" . T.pack $ "Its creator is " ++ show creator'
          appOriginAddress <- getSolidStorageKeyVal' caller $ MS.StoragePath [MS.Field ":originAddress"]
          let originAddress = case appOriginAddress of
                    MS.BAccount oa -> oa^.namedAccountAddress
                    _ -> caller
          return (creatorAddress^.namedAccountAddress, originAddress, BC.unpack creator')
        (_ , _)-> do
          $logDebugS "getCreator/versioning" . T.pack $ "Its creator is unset. Returning empty string"
          return (caller, caller, "") --TODO: have better sane default

logFunctionCall :: MonadSM m => ValList -> Address -> CC.Contract -> SolidString -> m (Maybe Value) -> m (Maybe Value)
logFunctionCall args address contract functionName f = do
  onTracedSM contract $ do
    argStrings <-
      case args of
        OrderedVals argList -> fmap (intercalate ", ") $ forM argList showSM
        NamedVals argMap ->
          fmap (intercalate ", ") $
            forM argMap $ \(n, v) -> do
              valString <- showSM v
              return $ labelToString n ++ ": " ++ valString

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

argsToVals :: MonadSM m => CC.ArgList -> m ValList
argsToVals args = case args of
  CC.OrderedArgs xs -> do
    vals <- traverse (getVar <=< flip expToVar Nothing) xs
    pure . OrderedVals $ case reverse vals of
      SVariadic vs : rest -> reverse rest ++ vs
      _ -> vals
  CC.NamedArgs xs -> NamedVals <$> traverse (\(n,v) -> fmap (n,) . getVar =<< expToVar v Nothing) xs

runModifiersAndStatements :: MonadSM m => [[CC.Statement]] -> [CC.Statement] -> m (Maybe Value)
runModifiersAndStatements []   stmts = runStatementBlock stmts
runModifiersAndStatements mods stmts = withLocalVars $ go mods
  where go [] = pure Nothing
        go (ss:rest) = do
          (mv, ss') <- runStatements ss
          case mv of
            Just SContinue -> do
              mv1 <- runModifiersAndStatements rest stmts
              mv2 <- go $ ss':rest
              pure $ mv2 <|> mv1
            _ -> pure mv

runStatementBlock :: MonadSM m => [CC.Statement] -> m (Maybe Value)
runStatementBlock = fmap fst . runStatementBlock'

runStatementBlock' :: MonadSM m => [CC.Statement] -> m (Maybe Value, [CC.Statement])
runStatementBlock' = withLocalVars . runStatements

runStatements :: MonadSM m => [CC.Statement] -> m (Maybe Value, [CC.Statement])
runStatements [] = return (Nothing, [])
runStatements (s : rest) = do
  onTraced $ do
    when False printFullStackTrace -- Too verbose, only turn on by hand when needed
    funcName <- getCurrentFunctionName
    liftIO $ putStrLn $ C.green $ labelToString funcName ++ "> " ++ unparseStatement s

  decrementGas 1
  ret <- runStatement s

  case ret of
    Nothing -> runStatements rest
    v -> return (v, rest)

runStatement :: MonadSM m => CC.Statement -> m (Maybe Value)
runStatement (CC.RevertStatement mString theArgs pos) = do
  -- Below defined logic works well for REVERT statement use-cases:
  --    revert();

  --    revert(args);
  --    revert("error message") i.e. OrderedArgs
  --    revert({x:"Message"}) i.e. NamedArgs

  --    revert customError(args);
  --    revert customError("error message") i.e. OrderedArgs
  --    revert customError({x:"Message"}) i.e. NamedArgs
  solidVMBreakpoint pos
  g <- getCurrentContract
  case mString of
    Just name -> do
      err <- case M.lookup name $ CC._errors g of
        Just _ -> do
          argVals <- case theArgs of
            CC.OrderedArgs as -> OrderedVals <$> mapM (getVar <=< flip expToVar Nothing) as
            CC.NamedArgs ns -> NamedVals <$> mapM (mapM $ getVar <=< flip expToVar Nothing) ns
          let listOfVals = case argVals of
                OrderedVals ov -> mapMaybe (\x -> toBasic x) ov
                NamedVals nv -> mapMaybe (\(_, y) -> toBasic y) nv

          return $ customError "Reverting based on  Error Method:" name listOfVals
        Nothing -> do revertError "REVERT: to initial state" name
      pure $ err
    Nothing -> do
      argVals <- case theArgs of
        CC.OrderedArgs as -> OrderedVals <$> mapM (getVar <=< flip expToVar Nothing) as
        CC.NamedArgs ns -> NamedVals <$> mapM (mapM $ getVar <=< flip expToVar Nothing) ns
      let listOfVals = case argVals of
            OrderedVals ov -> mapMaybe (\x -> toBasic x) ov
            NamedVals nv -> mapMaybe (\(_, y) -> toBasic y) nv
      return $ revertError "REVERT" listOfVals

-- Assignment to an index into an array or mapping
runStatement st@(CC.SimpleStatement (CC.ExpressionStatement (CC.Binary _ "=" dst@(CC.IndexAccess _ parent (Just indExp)) src)) pos) = do
  solidVMBreakpoint pos
  srcVar <- expToVar src Nothing
  srcVal <- getVar srcVar

  cntrct <- getCurrentContract
  onTracedSM cntrct $ do
    valString <- showSM srcVal
    withSrcPos pos $ "    Setting: " ++ unparseExpression dst ++ " = " ++ valString

  pVar <- expToVar parent Nothing
  pVal <- weakGetVar pVar

  -- If it's an array, calling (expToVar dst) gives us
  -- the value at the index, NOT a reference that we can
  -- assign to....so we need to make a new vector and reset the whole array
  case pVal of
    SArray fs -> do
      indVal <- getVar =<< expToVar indExp Nothing
      case indVal of
        SInteger ind -> do
          when ((ind >= toInteger (V.length fs) || 0 > ind)) (invalidWrite "Cannot assign a value outside the allocated space for an array" (unparseStatement st))
          let newVec = fs V.// [(fromIntegral ind, srcVar)]
          setVar pVar (SArray newVec)
          return Nothing
        _ -> typeError ("array index value (" ++ (show indVal) ++ ") is not an integer") (unparseStatement st)
    SMap theMap -> do
      theIndex <- getVar =<< expToVar indExp Nothing
      let newMap = M.insert theIndex srcVar theMap
      setVar pVar (SMap newMap)
      return Nothing
    _ -> do
      -- If it's a mapping, (expToVar dst) IS a reference, so we can set directly to it
      dstVar <- expToVar dst Nothing
      setVar dstVar srcVal
      return Nothing
runStatement st@(CC.SimpleStatement (CC.ExpressionStatement (CC.Binary _ "=" (CC.IndexAccess _ _ Nothing) _)) pos) = do
  solidVMBreakpoint pos
  missingField "index value cannot be empty" (unparseStatement st)
runStatement (CC.SimpleStatement (CC.ExpressionStatement (CC.Binary _ "=" dst src)) pos) = do
  solidVMBreakpoint pos
  dstVar <- expToVar dst Nothing
  dstType <- case dstVar of
    Constant (SReference (AccountPath addr (MS.StoragePath (MS.Field field : _)))) -> getXabiType addr field
    _ -> pure $ Nothing
  srcVal <- getVar =<< expToVar src dstType

  setVar dstVar srcVal

  cntrct <- getCurrentContract
  onTracedSM cntrct $ do
    valString <- showSM srcVal
    withSrcPos pos $ "    Setting: " ++ unparseExpression dst ++ " = " ++ valString

  return Nothing

runStatement (CC.SimpleStatement (CC.ExpressionStatement e) pos) = do
  solidVMBreakpoint pos
  _ <- getVar =<< expToVar e Nothing
  return Nothing -- just throw away the return value
runStatement s@(CC.SimpleStatement (CC.VariableDefinition entries maybeExpression) pos) = do
  solidVMBreakpoint pos
  let !maybeLoc = case entries of
        [e] -> CC.vardefLocation e
        es ->
          if any ((== Just CC.Storage) . CC.vardefLocation) es
            then -- It is possible to supply locations in tuple definitions, but
            -- I'm not sure what that exactly looks like when its not memory.
              todo "storage was not anticipated in a tuple entry" s
            else Nothing
  let singleType = case entries of
        [e] -> fromMaybe (todo "type inference not implemented" s) $ CC.vardefType e
        _ -> todo "could not evaluate expression without tuple type" s
  (_, cc) <- getCurrentCodeCollection
  !value <-
    case maybeExpression of
      Nothing -> do
        ctract <- getCurrentContract
        createDefaultValue cc ctract singleType
      Just e -> do
        rhs <- weakGetVar =<< expToVar e Nothing
        case (maybeLoc, rhs) of
          (Just CC.Storage, SReference {}) -> return rhs
          (_, SReference {}) -> getVar $ Constant rhs
          (_, c) -> return c

  cntrct <- getCurrentContract
  onTracedSM cntrct $ do
    valueString <- showSM value
    let toName :: CC.VarDefEntry -> SolidString
        toName CC.BlankEntry = ""
        toName vde = CC.vardefName vde
    withSrcPos pos $
      printf "             creating and setting variables: (%s)\n" $
        intercalate ", " (map (labelToString . toName) entries)
    withSrcPos pos $ printf "             to: %s\n" valueString
  let ensureType :: Maybe SVMType.Type -> SVMType.Type
      ensureType = fromMaybe (todo "type inference not implemented" s)

  case (entries, value) of
    ([CC.VarDefEntry mType _ name _], _) -> addLocalVariable (ensureType mType) name value
    ([CC.BlankEntry], _) -> parseError "cannot declare single nameless variable" s
    (_, STuple variables) -> do
      checkArity "var declaration tuple" (V.length variables) (length entries)
      let nonBlanks = [(ensureType t, n, v) | (CC.VarDefEntry t _ n _, v) <- zip entries $ V.toList variables]
      --We get the values first so in the case of (x,y) = (y,x) we can still set the variables to the correct values
      nonBlanks' <- forM nonBlanks $ \(t, n, v) -> do
        v' <- getVar v
        return (t, n, v')
      forM_ nonBlanks' $ \(theType', name', v) -> do
        logAssigningVariable v
        addLocalVariable theType' name' v
    _ -> typeError "VariableDefinition expected a tuple" value

  return Nothing
runStatement (CC.SolidityTryCatchStatement tryExpression returnsDecl statementsForSuccess catchBlockMap pos) = do
  solidVMBreakpoint pos
  -- currentCallInfo <- getCurrentCallInfo

  mRes <- EUnsafe.try $ do
    expResultVal <- getVar =<< expToVar tryExpression Nothing
    return expResultVal
  case mRes of
    Left (ex :: SolidException) -> do
      res1 <- solidityExceptionHandler catchBlockMap ex
      return res1
    Right aRealVal -> do
      case returnsDecl of
        Nothing -> do
          sfsRes <- runStatementBlock statementsForSuccess
          return $ sfsRes
        Just xs -> do
          case aRealVal of
            STuple vecOfVars -> do
              let vars = V.toList vecOfVars
              if length vars /= length returnsDecl
                then typeError "try/catch statement expected a tuple of the same length as the returns statement" (tryExpression, aRealVal)
                else do
                  forM_ (zip vars xs) $ \(var, (name, ty)) -> do
                    val <- getVar var
                    addLocalVariable ty name val
                  sfsRes' <- runStatementBlock statementsForSuccess
                  return sfsRes'
            _ -> typeError "try/catch statement expected a tuple" (tryExpression, aRealVal)
runStatement (CC.TryCatchStatement tryBlock catchBlockMap pos) = do
  solidVMBreakpoint pos
  mRes <- EUnsafe.try $ do
    val <- runStatementBlock tryBlock
    pure $ val
  case mRes of
    Left ex -> do
      res1 <- solidVMExceptionHandler catchBlockMap ex
      return res1
    Right res -> return res
runStatement (CC.IfStatement condition code' maybeElseCode pos) = do
  solidVMBreakpoint pos
  conditionResult <- getBool =<< expToVar condition Nothing

  onTraced $ do
    if conditionResult
      then withSrcPos pos $ "       if condition succeeded, running internal code"
      else withSrcPos pos $ "       if condition failed, skipping internal code"

  if conditionResult
    then runStatementBlock code'
    else case maybeElseCode of
      Just elseCode -> runStatementBlock elseCode
      Nothing -> return Nothing
runStatement (CC.WhileStatement condition code pos) = do
  solidVMBreakpoint pos

  while (getBool =<< expToVar condition Nothing) $! do
    onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
    result <- runStatementBlock code
    return result

runStatement (CC.DoWhileStatement code condition pos) = do
  solidVMBreakpoint pos
  doWhile (getBool =<< expToVar condition Nothing) $! do
    onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
    result <- runStatementBlock code
    return result

--TODO- all the variables declared in an `if` or `for` code block need to be deleted when the block is finished....
runStatement (CC.ForStatement maybeInitStatement maybeConditionExp maybeLoopExp code pos) = do
  solidVMBreakpoint pos
  _ <-
    case maybeInitStatement of
      Just initStatement -> runStatement $ CC.SimpleStatement initStatement pos
      _ -> return Nothing

  let conditionExp =
        case maybeConditionExp of
          Just x -> x
          Nothing -> CC.BoolLiteral pos True

  let loopExp =
        case maybeLoopExp of
          Just x -> x
          Nothing -> (CC.NumberLiteral pos 1 Nothing)

  let condition = getBool =<< expToVar conditionExp Nothing

  while condition $! do
    onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
    result <- runStatementBlock code
    _ <- getVar =<< expToVar loopExp Nothing
    return result
runStatement (CC.Break pos) = do
  solidVMBreakpoint pos
  return $ Just SBreak
runStatement (CC.Continue pos) = do
  solidVMBreakpoint pos
  return $ Just SContinue
runStatement (CC.Return maybeExpression pos) = do
  solidVMBreakpoint pos

  case maybeExpression of
    Just e -> do
      var <- expToVar e Nothing
      var' <- getVar var
      onTraced $ liftIO $ putStrLn $ (C.green ">> Returned value: ") ++ show var'
      return $ Just var'
    Nothing -> return $ Just SNULL
runStatement (CC.Throw expr pos) = do
  solidVMBreakpoint pos
  (name, args) <- do
    case expr of
      CC.FunctionCall _ (CC.Variable _ n) a -> pure (n, a)
      _ -> invalidArguments "Invalid argument for throw." expr
  argVals <- case args of
    CC.OrderedArgs as -> OrderedVals <$> mapM (getVar <=< flip expToVar Nothing) as
    CC.NamedArgs ns -> NamedVals <$> mapM (mapM $ getVar <=< flip expToVar Nothing) ns
  let listOfVals = case argVals of
        OrderedVals ov -> mapMaybe (\x -> toBasic x) ov
        NamedVals nv -> mapMaybe (\(_, y) -> toBasic y) nv
  customError "Custom user error thrown" name listOfVals
runStatement (CC.AssemblyStatement (CC.MloadAdd32 dst src) pos) = do
  solidVMBreakpoint pos
  srcVar <- expToVar (CC.Variable pos $ textToLabel src) Nothing
  dstVar <- expToVar (CC.Variable pos $ textToLabel dst) Nothing

  -- TODO(tim): should this hex encode src and pad?
  setVar dstVar =<< getVar srcVar
  return Nothing
runStatement st@(CC.EmitStatement eventName exptups pos) = do
  -- emit MemberAdded(<address>, <enode>);
  solidVMBreakpoint pos
  exps <- mapM (flip expToVar Nothing . snd) exptups
  expVals <- mapM getVar exps
  expStrs <- mapM jsonSM expVals

  -- checks that the event is declared and that the number of args match
  --   DOES NOT check consistency of arg types
  curInfo <- getCurrentCallInfo
  curCnct <- getCurrentContract
  let evs = CC._events curCnct
      mEv = M.lookup (stringToLabel eventName) evs
  case mEv of
    Nothing ->
      missingType "no corresponding event has been declared for the following emit statement: " (unparseStatement st)
    Just ev -> do
      if (length exptups) /= (length $ CC._eventLogs ev)
        then invalidArguments "arguments to statement are inconsistent with those declared" (unparseStatement st)
        else do
          let address = currentAddress curInfo
          (_, _, ctrName) <- getCreator address
          parentName <-
            fromMaybeM (return "") $
              runMaybeT $
                pure address
                  >>= MaybeT . A.lookup (A.Proxy @AddressState)
                  >>= pure . addressStateCodeHash
                  >>= ( \case
                          SolidVMCode name _ | name /= (labelToString $ CC._contractName curCnct) -> pure name
                          _ -> pure ""
                  )
          -- pair up field names with values one-by-one (no type checking tho, lol)
          -- let pairs = zip (map (T.unpack . fst) $ CC._eventLogs ev) expStrs

          let evArgs = zipWith (\(CC.EventLog name _ (CC.IndexedType _ idxType)) value -> 
                        (T.unpack name, value, if isTypeArray idxType then "Array" else "Other")) 
                     (CC._eventLogs ev) expStrs
                where
                  isTypeArray :: SVMType.Type -> Bool
                  isTypeArray (SVMType.Array _ _) = True
                  isTypeArray _ = False

          multilineLog "event/emit/versioning" $
            boringBox
              [ "Emitting event:",
                "Event: " ++ C.yellow eventName,
                "Contract: " ++ C.yellow (labelToString $ CC._contractName curCnct),
                "App: " ++ C.yellow (show parentName),
                "Creator: " ++ C.yellow (show ctrName)
              ]

          bHash <- blockHeaderHash . Env.blockHeader <$> getEnv
          addr <- getCurrentAddress
          contractName' <- fst <$> getContractNameAndHash addr
          addEvent $ Event bHash ctrName parentName (labelToString contractName') address eventName evArgs
          return Nothing
runStatement (CC.UncheckedStatement code pos) = do
  solidVMBreakpoint pos
  withUncheckedCallInfo $ runStatementBlock code

--runs the "_;" operator in a modifier statement
runStatement (CC.ModifierExecutor pos) = do
  solidVMBreakpoint pos
  return $ Just SContinue
runStatement x = unknownStatement "unknown statement in call to runStatement: " (show x)

while :: MonadSM m => m Bool -> m (Maybe Value) -> m (Maybe Value)
while condition code = do
  c <- condition
  onTraced $ liftIO $ putStrLn $ C.red $ "^^^^^^^^^^^^^^^^^^^^ loopy condition: " ++ show c
  decrementGas 1
  if c
    then do
      result <- code
      case result of
        Nothing -> while condition code
        Just SContinue -> while condition code
        Just SBreak -> return Nothing
        _ -> return result
    else return Nothing

doWhile :: MonadSM m => m Bool -> m (Maybe Value) -> m (Maybe Value)
doWhile condition code = do
  result <- code
  decrementGas 1
  case result of
    Nothing -> do
      c <- condition
      onTraced $ liftIO $ putStrLn $ C.red $ "^^^^^^^^^^^^^^^^^^^^ loopy condition: " ++ show c
      if c
        then doWhile condition code
        else return Nothing
    Just SBreak -> return Nothing
    Just SContinue -> doWhile condition code
    _ -> return result

getIndexType :: MonadSM m => AccountPath -> m IndexType
getIndexType (AccountPath addr (MS.StoragePath path)) = case path of
  (MS.Field field : path') -> do
    mType <- getXabiType addr field
    let loop :: MonadSM m => [MS.StoragePathPiece] -> SVMType.Type -> m IndexType
        loop [] t = case t of
          SVMType.Mapping {SVMType.key = SVMType.Int {}} -> return MapIntIndex
          SVMType.Mapping {SVMType.key = SVMType.String {}} -> return MapStringIndex
          SVMType.Mapping {SVMType.key = SVMType.Bytes {}} -> return MapStringIndex
          SVMType.Mapping {SVMType.key = SVMType.Address {}} -> return MapAccountIndex
          SVMType.Mapping {SVMType.key = SVMType.Account {}} -> return MapAccountIndex
          SVMType.Mapping {SVMType.key = SVMType.Bool {}} -> return MapBoolIndex
          SVMType.Array {} -> return ArrayIndex
          _ -> typeError "unanticipated index type" t
        loop (p:ps) t = case t of
          SVMType.Mapping {SVMType.value = t'} -> loop ps t'
          SVMType.Array {SVMType.entry = t'} -> loop ps t'
          -- TODO lookup struct typos, this seems to be the case when there is a global struct reference
          SVMType.UnknownLabel def' _ -> do
            t' <- getTypeOfName def'
            case t' of
              StructTypo fs -> case p of
                MS.Field f -> case UTF8.toString f `M.lookup` M.fromList fs of
                  Nothing -> typeError "unknownField from StructTypo" field
                  Just tt -> loop ps $ CC.fieldTypeType tt
                _ -> typeError "non-field path piece found after struct type" ps
              _ -> todo "hintFromType" t'
          _ -> typeError "indexing type in var dec" t
    case mType of
      Nothing -> todo "getIndexType/unknown storage reference" field
      Just v -> loop path' v
  _ -> typeError "getIndexType called with non-field path" path

expToPath :: MonadSM m => CC.Expression -> m AccountPath
expToPath (CC.Variable _ x) = do
  callInfo <- getCurrentCallInfo
  let path = MS.singleton $ BC.pack $ labelToString x
  case x `M.lookup` NE.head (localVariables callInfo) of
    Just (_, var) -> do
      val <- weakGetVar var
      case val of
        SReference apt -> return apt
        _ -> typeError "expToPath should never be called for a local variable" ((show x) ++ " = " ++ show val)
    Nothing -> return $ AccountPath (currentAddress callInfo) path
expToPath x@(CC.IndexAccess _ parent mIndex) = do
  parPath <- do
    parvar <- expToVar parent Nothing
    case parvar of
      Constant (SReference apt) -> return apt
      _ -> expToPath parent

  idxType <- getIndexType parPath
  idxVar <- maybe (typeError "empty index is only valid at type level" x) expToVar mIndex Nothing
  apSnoc parPath <$> case idxType of
    MapAccountIndex -> do
      idx <- getVar idxVar
      return $ case idx of
        SAccount a _ -> MS.MapIndex $ MS.IAccount a
        SInteger i -> MS.MapIndex $ MS.IAccount . unspecifiedChain $ fromIntegral i
        _ -> typeError "invalid map of addresses index" idx
    MapBoolIndex -> do
      b <- getBool idxVar
      return $ MS.MapIndex $ MS.IBool b
    MapIntIndex -> do
      n <- getInt idxVar
      return . MS.MapIndex $ MS.INum n
    MapStringIndex -> do
      idx <- getVar idxVar
      return $ case idx of
        SString s -> MS.MapIndex $ MS.IText $ UTF8.fromString s
        _ -> typeError "invalid map of strings index" idx
    ArrayIndex -> do
      n <- getInt idxVar
      return . MS.ArrayIndex $ fromIntegral n
expToPath (CC.MemberAccess _ parent field) = do
  apt <- do
    parvar <- expToVar parent Nothing
    case parvar of
      _ -> expToPath parent
  return . apSnoc apt . MS.Field $ BC.pack $ labelToString field
expToPath x = todo "expToPath/unhandled" x

expToVar :: MonadSM m => CC.Expression -> Maybe SVMType.Type -> m Variable
expToVar x t = do
  -- liftIO $ putStrLn $ C.cyan $ "expToVar: " ++ show x
  v <- expToVar' x t
  decrementGas 1
  return v

decrementGas :: MonadSM m => Gas -> m ()
decrementGas !gas = do
  gasInfo' <- Mod.modifyStatefully (Mod.Proxy @GasInfo) $ gasLeft -= gas
  let !gasUsed' = gas + gasInfo' ^. gasUsed
  Mod.modifyStatefully_ (Mod.Proxy @GasInfo) $ gasUsed .= gasUsed'
  let !gasLeft' = gasInfo' ^. gasLeft
  if (gasLeft') < (Gas 0)
    then do
      let msg = "out of gas: " ++ show gasLeft' ++ " < " ++ show gas
      liftIO $ putStrLn $ C.red $ msg
      tooMuchGas (getGasValue $ _gasInitialAllotment gasInfo') (getGasValue gasUsed')
    else do
      return ()
expToVar' :: MonadSM m => CC.Expression -> Maybe SVMType.Type -> m Variable
expToVar' (CC.NumberLiteral _ v Nothing) _ = return . Constant $ SInteger v
expToVar' (CC.NumberLiteral _ v (Just nu)) _ =
  case nu of
    CC.Wei -> return . Constant $ SInteger v
    CC.Szabo -> return . Constant $ SInteger (v * (10 ^ (12 :: Integer)))
    CC.Finney -> return . Constant $ SInteger (v * (10 ^ (15 :: Integer)))
    CC.Ether -> return . Constant $ SInteger (v * (10 ^ (18 :: Integer)))
expToVar' (CC.StringLiteral _ s) _ = return $ Constant $ SString s
expToVar' (CC.DecimalLiteral _ v) _ = return $ Constant $ SDecimal $ CC.unwrapDecimal v
expToVar' (CC.AccountLiteral _ a) _ = return $ Constant $ SAccount a False
expToVar' (CC.BoolLiteral _ b) _ = return $ Constant $ SBool b
expToVar' (CC.HexaLiteral _ a) _ = return $ Constant $ SString $ BC.unpack . either (parseError "Couldn't parse hexadecimal literal: ") id . B16.decode $ BC.pack a
expToVar' (CC.Variable _ "bytes32ToString") _ = return $ Constant $ SHexDecodeAndTrim
expToVar' (CC.Variable _ "addressToAsciiString") _ = return $ Constant SAddressToAscii
expToVar' (CC.Variable _ "bytes") _ = return $ Constant $ SFunction "identity" Nothing
expToVar' (CC.Variable _ "now") _ = Constant . SInteger . round . utcTimeToPOSIXSeconds . BlockHeader.timestamp . Env.blockHeader <$> getEnv
expToVar' (CC.Variable _ name) _ = getVariableOfName name
expToVar' (CC.Unitary _ "-" e) _ = do
  var <- expToVar e Nothing
  value <- getRealNum var
  case value of
    Left v -> return $ Constant $ SInteger (v * (-1))
    Right v -> return $ Constant $ SDecimal $ v * (-1)
expToVar' (CC.PlusPlus _ e) _ = do
  var <- expToVar e Nothing
  value <- getInt var

  logAssigningVariable $ SInteger value
  setVar var $ SInteger $ value + 1
  return $ Constant $ SInteger value
expToVar' (CC.Unitary _ "++" e) _ = do
  var <- expToVar e Nothing
  value <- getInt var
  let next = SInteger $ value + 1
  logAssigningVariable next

  setVar var next
  return $ Constant next
expToVar' (CC.MinusMinus _ e) _ = do
  var <- expToVar e Nothing
  value <- getInt var
  logAssigningVariable $ SInteger value
  setVar var . SInteger $ value - 1
  return $ Constant $ SInteger value
expToVar' (CC.Unitary _ "--" e) _ = do
  var <- expToVar e Nothing
  value <- getInt var
  let next = SInteger $ value - 1
  logAssigningVariable next
  setVar var next
  return $ Constant next
expToVar' (CC.Binary _ "+=" lhs rhs) _ = addAndAssign lhs rhs
expToVar' (CC.Binary _ "-=" lhs rhs) _ = binopAssign' (-) (-) lhs rhs Nothing
expToVar' (CC.Binary _ "*=" lhs rhs) _ = binopAssign' (*) (*) lhs rhs Nothing
expToVar' ex@(CC.Binary _ "/=" lhs rhs) t = do
  rhs' <- getRealNum =<< expToVar rhs Nothing
  case rhs' of
    Left 0 -> divideByZero $ unparseExpression ex
    Right 0 -> divideByZero $ unparseExpression ex
    _ -> binopDivide (div) (/) lhs rhs t
expToVar' (CC.Binary _ "%=" lhs rhs) _ = binopAssign' rem decMod lhs rhs Nothing
expToVar' (CC.Binary _ "|=" lhs rhs) _ = binopAssign (.|.) lhs rhs
expToVar' (CC.Binary _ "&=" lhs rhs) _ = binopAssign (.&.) lhs rhs
expToVar' (CC.Binary _ "^=" lhs rhs) _ = binopAssign xor lhs rhs
expToVar' (CC.Binary _ ">>=" lhs rhs) _ = do
  binopAssign (\x i -> x `shiftR` fromInteger i) lhs rhs
expToVar' (CC.Binary _ "<<=" lhs rhs) _ = do
  binopAssign (\x i -> x `shiftL` fromInteger i) lhs rhs
expToVar' (CC.Binary _ ">>>=" lhs rhs) _ = do
  binopAssign (\x i -> fromInteger (toInteger ((fromInteger x) :: Word256)) `shiftR` fromInteger i) lhs rhs
expToVar' (CC.MemberAccess _ (CC.FunctionCall x (CC.Variable _ "type") (CC.OrderedArgs [CC.Variable _ name])) "runTimeCode") _ = do
  (_, cc) <- getCurrentCodeCollection
  return $
    Constant $
      SString $ case M.lookup name $ cc ^. CC.contracts of -- (_contracts cc) of
        Just contract -> unparseContract contract
        _ -> getRunTimeCodeError "Failed to get contract runtime code " x
expToVar' (CC.MemberAccess _ (CC.Variable _ "Util") "bytes32ToString") _ = do
  return $ Constant $ SHexDecodeAndTrim
expToVar' (CC.MemberAccess _ (CC.Variable _ "Util") "b32") _ = do
  --TODO- remove this hardcoded case
  return $ Constant $ SFunction "identity" Nothing
expToVar' (CC.MemberAccess _ (CC.Variable _ "string") "concat") _ = do
  return $ Constant $ SStringConcat
expToVar' x@(CC.MemberAccess _ expr name) _ = do
  var <- expToVar expr Nothing
  val <- getVar var
  case (val, name) of
    (SEnum enumName, _) -> do
      contract' <- getCurrentContract
      let maybeEnumValues = M.lookup enumName $ contract' ^. CC.enums
      case maybeEnumValues of
        Nothing -> do
          cc <- getCurrentCodeCollection
          let maybeEnumValues' = M.lookup enumName $ (snd cc) ^. CC.flEnums
              !enumVals' = fromMaybe (missingType "Enum nonexistent type" enumName) maybeEnumValues'
              !num' = maybe (missingType "Enum nonexistent member" (enumName, name)) fromIntegral (name `elemIndex` fst enumVals')
          return $ Constant $ SEnumVal enumName name num'
        Just enumVals -> do
          let !num = maybe (missingType "Enum nonexistent member" (enumName, name)) fromIntegral (name `elemIndex` fst enumVals)
          return $ Constant $ SEnumVal enumName name num
    (SBuiltinVariable "msg", "sender") -> (Constant . ((flip SAccount) False) . (\v -> NamedAccount v UnspecifiedChain) . Env.sender) <$> getEnv
    (SBuiltinVariable "msg", "data") -> do
      contract' <- getCurrentContract
      functionName <- getCurrentFunctionName
      callInfo <- getCurrentCallInfo
      let argList = maybe [] CC._funcArgs $ contract' ^. CC.functions . at functionName
          localVars = NE.head $ localVariables callInfo
      argVals <- forM argList (\(n, _) -> getVar . snd $ localVars M.! (fromMaybe "" n))
      return . Constant $ SVariadic argVals
    (SBuiltinVariable "msg", "sig") -> do
      functionName <- getCurrentFunctionName
      return . Constant $ SString functionName
    (SBuiltinVariable "tx", "origin") -> (Constant . ((flip SAccount) False) . (\v -> NamedAccount v UnspecifiedChain) . Env.origin) <$> getEnv
    (SBuiltinVariable "tx", "username") -> do
      env' <- getEnv
      maybeCert <- A.select (A.Proxy @X509Certificate) $ Env.origin env'
      return . Constant . SString . fromMaybe "" . fmap subCommonName $ getCertSubject =<< maybeCert
    (SBuiltinVariable "tx", "organization") -> do
      env' <- getEnv
      maybeCert <- A.select (A.Proxy @X509Certificate) $ Env.origin env'
      return . Constant . SString . fromMaybe "" . fmap subOrg $ getCertSubject =<< maybeCert
    (SBuiltinVariable "tx", "group") -> do
      env' <- getEnv
      maybeCert <- A.select (A.Proxy @X509Certificate) $ Env.origin env'
      return . Constant . SString . fromMaybe "" $ subUnit =<< getCertSubject =<< maybeCert
    (SBuiltinVariable "tx", "organizationalUnit") -> do
      env' <- getEnv
      maybeCert <- A.select (A.Proxy @X509Certificate) $ Env.origin env'
      return . Constant . SString . fromMaybe "" $ subUnit =<< getCertSubject =<< maybeCert
    (SBuiltinVariable "tx", "certificate") -> do
      env' <- getEnv
      maybeCert <- A.select (A.Proxy @X509Certificate) $ Env.origin env'
      return . Constant . SString . fromMaybe "" $ fmap (BC.unpack . certToBytes) maybeCert
    (SStruct _ theMap, fieldName) -> case M.lookup fieldName theMap of
      Nothing -> missingField "struct member access" fieldName
      Just v -> return v
    (SContractDef contractName', constName) -> do
      --TODO- move all variable name resolution by contract to a function
      (_, cc) <- getCurrentCodeCollection
      cont <- case M.lookup contractName' $ cc ^. CC.contracts of
        Nothing -> missingType "contract function lookup" contractName'
        Just ct -> pure ct
      if constName `M.member` CC._functions cont
        then do
          -- TODO: Check that this contract actually is a contractName'
          addr <- getCurrentAddress
          return $ Constant $ SContractFunction (Just contractName') (NamedAccount addr UnspecifiedChain) constName
        else case constName `M.lookup` CC._constants cont of
          Nothing -> case constName `M.lookup` (cc ^. CC.flConstants) of
            Just (CC.ConstantDecl _ _ constExp _) -> expToVar constExp Nothing
            Nothing -> case constName `M.lookup` CC._structs cont of
              Just _ -> pure . Constant $ SStructDef constName
              Nothing -> unknownConstant "constant member access" (contractName', constName)
          Just (CC.ConstantDecl _ _ constExp _) -> expToVar constExp Nothing
    (SBuiltinVariable "block", "proposer") -> do
      env' <- getEnv
      let acc = Env.proposer env'
      return $ Constant (flip SAccount False (unspecifiedChain acc))
    (SBuiltinVariable "block", "timestamp") -> do
      env' <- getEnv
      let baseTimestamp = utcTimeToPOSIXSeconds $ BlockHeader.timestamp $ Env.blockHeader env'
      return $ Constant $ SInteger $ round baseTimestamp
    (SBuiltinVariable "block", "number") -> (Constant . SInteger . BlockHeader.number . Env.blockHeader) <$> getEnv
    (SBuiltinVariable "block", "coinbase") ->
      pure . Constant $ SAccount (NamedAccount (Address 0) UnspecifiedChain) True -- TODO: fix?
    (SBuiltinVariable "block", "difficulty") ->
      (Constant . SInteger . BlockHeader.difficulty . Env.blockHeader) <$> getEnv
    (SBuiltinVariable "block", "gaslimit") ->
      (Constant . SInteger . BlockHeader.gasLimit . Env.blockHeader) <$> getEnv
    (SBuiltinVariable "super", method) -> do
      ctract <- getCurrentContract
      (_, cc) <- getCurrentCodeCollection
      let parents' = either (throw . fst) id $ CC.getParents cc ctract
      case filter (elem method . M.keys . CC._functions) parents' of
        [] -> typeError "cannot use super without a parent contract" (method, ctract)
        (p:_) -> do
          addr <- getCurrentAddress
          return $ Constant $ SContractFunction (Just $ CC._contractName p) (NamedAccount addr UnspecifiedChain) method
    (SAccount a _, n) -> evaluateAccountMember (a^.namedAccountAddress) False n
    (SContractItem a _, n) -> evaluateAccountMember (a^.namedAccountAddress) False n
    (SContract _ a, n) -> evaluateAccountMember (a^.namedAccountAddress) True n
    (r@(SReference _), "push") -> return $ Constant $ SPush r Nothing
    (a@(SArray _), "push") -> return $ Constant $ SPush a (Just var)
    (SArray theVector, "length") -> return $ Constant $ SInteger $ fromIntegral $ V.length theVector
    (SString s, "length") -> return . Constant . SInteger . fromIntegral $ length s
    (SReference apt, "length") -> do
      ty <- getValueType apt
      case ty of
        TString -> do
          let getInnerString (SString s) = s
              getInnerString _ = error "impossible match in CC.hs"
          return . Constant . SInteger . fromIntegral $ length $ getInnerString val
        _ -> return . Constant . SReference . apSnoc apt $ MS.Field "length"
    (SReference p, itemName) -> return . Constant . SReference $ apSnoc p $ MS.Field $ BC.pack $ labelToString itemName
    ((SUserDefined alias notSure actualType), "wrap") -> return . Constant $ (SUserDefined alias notSure actualType) -- return $ Constant . SUserDefined alias val actualType
    m -> typeError ("illegal member access: " ++ (unparseExpression x)) ("parsed as " ++ show m ++ "with full exp" ++ show x)
expToVar' x@(CC.IndexAccess _ _ (Nothing)) _ = missingField "index value cannot be empty" (unparseExpression x)
-- TODO(tim): When this is a string constant, we can index into the string directly for SInteger
expToVar' x@(CC.IndexAccess _ parent (Just mIndex)) _ = do
  var <- expToVar parent Nothing

  case var of
    (Constant (SReference _)) -> Constant . SReference <$> expToPath x
    --    (Constant (SArray theVector)) -> do
    _ -> do
      theIndex <- getVar =<< expToVar mIndex Nothing
      val <- getVar var
      case (val, theIndex) of
        (SArray theVector, SInteger i) -> do
          if (fromIntegral i) >= length theVector
            then indexOutOfBounds ("index value was " ++ (show i) ++ ", but the array length was " ++ (show $ length theVector)) $ unparseExpression x
            else return $ theVector V.! fromIntegral i
        (SVariadic theList, SInteger i) -> case theList !? fromInteger i of
          Just v -> pure $ Constant v
          Nothing -> indexOutOfBounds ("index out of range: " ++ (show i)) $ unparseExpression x
        (SMap theMap, _) -> case theMap M.!? theIndex of
          Just v -> return v
          Nothing -> traverse getVar (fmap fst . uncons $ M.elems theMap) >>= \case
            Nothing -> pure $ Constant SNULL
            Just SInteger{} -> pure $ Constant $ SInteger 0
            Just SString{} -> pure $ Constant $ SString ""
            Just SDecimal{} -> pure $ Constant $ SDecimal 0.0
            Just SBool{} -> pure $ Constant $ SBool False
            Just (SAccount _ p) -> pure $ Constant $ SAccount (unspecifiedChain 0x0) p
            Just (SStruct n _) -> pure $ Constant $ SStruct n M.empty
            Just (SEnumVal t n _) -> pure $ Constant $ SEnumVal t n 0
            Just (SArray _) -> pure $ Constant $ SArray mempty
            Just (SContractItem _ n) -> pure $ Constant $ SContractItem (unspecifiedChain 0x0) n
            Just (SMap _) -> pure $ Constant $ SMap M.empty
            _ -> internalError "Type of Mapping not allowed" theMap
        (SReference _, _) -> Constant . SReference <$> expToPath x
        _ -> typeError "unsupported types for index access" $ unparseExpression x
--    _ -> error $ "unknown case in expToVar' for IndexAccess: " ++ show var

expToVar' (CC.Binary _ "+" expr1 expr2) _ = expToVarAdd expr1 expr2
expToVar' (CC.Binary _ "-" expr1 expr2) _ = expToVarArith (-) (-) expr1 expr2 Nothing
expToVar' (CC.Binary _ "*" expr1 expr2) _ = expToVarArith (*) (*) expr1 expr2 Nothing
expToVar' ex@(CC.Binary _ "/" expr1 expr2) t = do
  rhs <- getRealNum =<< expToVar expr2 Nothing
  case rhs of
    Left 0 -> divideByZero $ unparseExpression ex
    Right 0 -> divideByZero $ unparseExpression ex
    _ -> expToVarDivide (div) (/) expr1 expr2 t
--modified to use decimal division
expToVar' (CC.Binary _ "%" expr1 expr2) _ = expToVarArith rem decMod expr1 expr2 Nothing
expToVar' (CC.Binary _ "|" expr1 expr2) _ = expToVarInteger expr1 (.|.) expr2 SInteger
expToVar' (CC.Binary _ "&" expr1 expr2) _ = expToVarInteger expr1 (.&.) expr2 SInteger
expToVar' (CC.Binary _ "^" expr1 expr2) _ = expToVarInteger expr1 xor expr2 SInteger
expToVar' (CC.Binary _ "**" expr1 expr2) _ = expToVarInteger expr1 (^) expr2 SInteger
expToVar' (CC.Binary _ "<<" expr1 expr2) _ = expToVarInteger expr1 (\x i -> x `shift` fromInteger i) expr2 SInteger
expToVar' (CC.Binary _ ">>" expr1 expr2) _ = expToVarInteger expr1 (\x i -> x `shiftR` fromInteger i) expr2 SInteger
expToVar' (CC.Binary _ ">>>" expr1 expr2) _ = expToVarInteger expr1 (\x i -> fromInteger (toInteger ((fromInteger x) :: Word256)) `shiftR` fromInteger i) expr2 SInteger
expToVar' (CC.Unitary _ "!" expr) _ = do
  (Constant . SBool . not) <$> (getBool =<< expToVar expr Nothing)
expToVar' (CC.Unitary _ "delete" expr) _ = do
  p <- expToVar expr Nothing
  deleteVar p
  return $ Constant SNULL
expToVar' (CC.Binary _ "!=" expr1 expr2) _ = do
  --TODO- generalize all of these Binary operations to a single function
  val1 <- getVar =<< expToVar expr1 Nothing
  val2 <- getVar =<< expToVar expr2 Nothing
  ctract <- getCurrentContract
  onTraced $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  return . Constant . SBool . not $ valEquals ctract val1 val2
expToVar' (CC.Binary _ "==" expr1 expr2) _ = do
  val1 <- getVar =<< expToVar expr1 Nothing
  val2 <- getVar =<< expToVar expr2 Nothing
  ctract <- getCurrentContract
  logVals val1 val2
  return . Constant . SBool $ valEquals ctract val1 val2
expToVar' (CC.Binary _ "<" expr1 expr2) _ = do
  val1 <- getVar =<< expToVar expr1 Nothing
  val2 <- getVar =<< expToVar expr2 Nothing
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 < i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 < v2
    _ -> typeError "binary '<' on non-ints" (val1, val2)
expToVar' (CC.Binary _ ">" expr1 expr2) _ = do
  val1 <- getVar =<< expToVar expr1 Nothing
  val2 <- getVar =<< expToVar expr2 Nothing
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 > i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 > v2
    _ -> typeError "binary '>' on non-ints" (val1, val2)
expToVar' (CC.Binary _ ">=" expr1 expr2) _ = do
  val1 <- getVar =<< expToVar expr1 Nothing
  val2 <- getVar =<< expToVar expr2 Nothing
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 >= i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 >= v2
    _ -> typeError "binary '>=' used on non-ints" (val1, val2)
expToVar' (CC.Binary _ "<=" expr1 expr2) _ = do
  val1 <- getVar =<< expToVar expr1 Nothing
  val2 <- getVar =<< expToVar expr2 Nothing
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 <= i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 <= v2
    _ -> typeError "binary '<=' used on non-ints" (val1, val2)
expToVar' (CC.Binary _ "&&" expr1 expr2) _ = do
  b1 <- getBool =<< expToVar expr1 Nothing

  -- Only evaluate expr2 if b1 is True, otherwise return False
  if b1
    then do
      b2 <- getBool =<< expToVar expr2 Nothing
      logVals b1 b2
      return $ Constant $ SBool b2
    else return $ Constant $ SBool False
expToVar' (CC.Binary _ "||" expr1 expr2) _ = do
  b1 <- getBool =<< expToVar expr1 Nothing

  -- Only evaluate expr2 if b1 is False, otherwise return True
  if b1
    then return $ Constant $ SBool True
    else do
      b2 <- getBool =<< expToVar expr2 Nothing
      logVals b1 b2
      return $ Constant $ SBool b2
expToVar' (CC.TupleExpression _ exps) _ = do
  -- Or should STuple be a Vector of Maybe?
  vars <- for exps $ maybe (return $ Constant SNULL) $ flip expToVar Nothing
  return $ Constant $ STuple $ V.fromList vars
expToVar' (CC.ArrayExpression _ exps) _ = do
  vars <- for exps $ flip expToVar Nothing
  --  return $ Constant $ SArray (error "array type from array literal not known") $ V.fromList vars
  return $ Constant $ SArray $ V.fromList vars
expToVar' (CC.Ternary _ condition expr1 expr2) _ = do
  c <- getBool =<< expToVar condition Nothing
  flip expToVar Nothing $ if c then expr1 else expr2
expToVar' (CC.FunctionCall _ (CC.NewExpression _ SVMType.Bytes {}) (CC.OrderedArgs args)) _ = do
  case args of
    [a] -> do
      len <- getInt =<< expToVar a Nothing
      return . Constant . SString $ replicate (fromIntegral len) '\NUL'
    _ -> arityMismatch "newBytes" 1 (length args)
expToVar' x@(CC.FunctionCall _ (CC.NewExpression _ SVMType.Bytes {}) (CC.NamedArgs {})) _ =
  typeError "cannot create new bytes with named arguments" x
expToVar' (CC.FunctionCall _ (CC.NewExpression _ (SVMType.Array {SVMType.entry = t})) (CC.OrderedArgs args)) _ = do
  case args of
    [a] -> do
      len <- getInt =<< expToVar a Nothing
      ctract <- getCurrentContract
      cc <- snd <$> getCurrentCodeCollection
      v <- createDefaultValue cc ctract t
      Constant . SArray . V.fromList <$> traverse (const $ createVar v) [1..len]
    _ -> arityMismatch "new array" 1 (length args)
expToVar' x@(CC.FunctionCall _ (CC.NewExpression _ (SVMType.Array {})) CC.NamedArgs {}) _ =
  typeError "cannot create new array with named arguments" x
expToVar' (CC.FunctionCall _ (CC.NewExpression _ (SVMType.UnknownLabel contractName' Nothing)) args) _ = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "Invalid contract creation during read-only access" $ "contractName: " ++ show contractName' ++ ", args: " ++ show args
  creator <- getCurrentAddress
  (hsh, cc) <- getCurrentCodeCollection
  newAddress <- getNewAddress creator
  (issuerAcct, originAddress, issuerName) <- getCreator creator
  argVals <- argsToVals args
  execResults <- create' creator originAddress issuerAcct issuerName newAddress hsh cc contractName' argVals
  return $
    Constant $
      SContract contractName' $
        (\v -> NamedAccount v UnspecifiedChain) $
          fromMaybe (internalError "a call to create did not create an address" execResults) $
            erNewContractAddress execResults
expToVar' (CC.FunctionCall _ (CC.NewExpression _ (SVMType.UnknownLabel contractName' (Just saltExpressionText))) args) _ = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "Invalid contract creation during read-only access" $ "contractName: " ++ show contractName' ++ ", args: " ++ show args
  creator <- getCurrentAddress
  (hsh, cc) <- getCurrentCodeCollection
  salt <- saltTextToValue saltExpressionText
  argVals <- argsToVals args
  newAddress <- getNewAddressWithSalt creator salt hsh $ show argVals
  $logDebugS "DEBUG" $ T.pack $ (show hsh) ++ "  " ++ show newAddress
  (issuerAcct, originAddress, issuerName) <- getCreator creator
  execResults <- create' creator originAddress issuerAcct issuerName newAddress hsh cc contractName' argVals
  onTraced $ do
    liftIO $
      putStrLn $
        concat
          [ C.cyan ">> Created salted contract:",
            "\n   code hash      " ++ C.yellow (show hsh),
            "\n   salt           " ++ C.yellow (show salt),
            "\n   creator        " ++ C.yellow (show creator),
            "\n   arguments      " ++ C.yellow (show argVals),
            "\n   salted address " ++ C.yellow (show newAddress)
          ]
  return $
    Constant $
      SContract contractName' $
        (\v -> NamedAccount v UnspecifiedChain) $
          fromMaybe (internalError "a call to create did not create an address" execResults) $
            erNewContractAddress execResults
  where
    saltTextToValue saltText = do
      let stringParser = do
            ~(a, str) <- withPosition $ do
              s <- stringLiteral
              return s
            return $ CC.StringLiteral a str
      let saltExpression = runParser (stringParser <|> expression) initialParserState "" (saltText)
      saltValue <- do
        case saltExpression of
          Left pe -> invalidArguments "big bad sad" pe
          Right expr -> do
            s <- getVar =<< expToVar expr Nothing
            return s
      return saltValue
-- case to catch a using statement function like _x.add(3)

expToVar' (CC.FunctionCall _ e args) _ = do
      argVals <- argsToVals args
      case e of -- FunctionCall Special Case when calling a function via Member Access
        (CC.MemberAccess _ (CC.Variable _ "Util") _) -> regularFunctionCall argVals Nothing --Because of the hardcoded Util functions
        (CC.MemberAccess _ expr name) -> do
          var1 <- expToVar expr Nothing
          val1 <- getVar var1
          case (val1, name) of
            (SAccount (NamedAccount addr _) _, "derive") -> do
              (_, hsh, _) <- getCodeAndCollection addr
              let (salt, args'') = case argVals of
                    OrderedVals (SString s:vs) -> (s,) . OrderedVals $ case reverse vs of
                      SVariadic v : rest -> reverse rest ++ v
                      _ -> vs
                    _ -> typeError "first arugment must be a string " args
                  newAddress =
                    getNewAddressWithSalt_unsafe
                      addr
                      salt
                      (keccak256ToByteString hsh)
                      (show args'')
              onTraced $ do
                liftIO $
                  putStrLn $
                    concat
                      [ C.cyan ">> Deriving salted contract:",
                        "\n   code hash      " ++ C.yellow (show hsh),
                        "\n   salt           " ++ C.yellow (show salt),
                        "\n   input address  " ++ C.yellow (show addr),
                        "\n   arguments      " ++ C.yellow (show argVals),
                        "\n   salted address " ++ C.yellow (show newAddress)
                      ]
              return . Constant $ SAccount (NamedAccount newAddress UnspecifiedChain) False
            (SAccount addr _, "delegatecall") -> do
              let (funcName, args') = case argVals of
                    OrderedVals (SString fname : a) -> (fname, (OrderedVals a))
                    OrderedVals _ -> typeError "delegate call needs first argument to be a string" args
                    NamedVals _ -> typeError "Cannot provide named args to delegate call" args
              fromAddress <- getCurrentAddress
              let toAddress = addr ^. namedAccountAddress
              res <- callWithResult fromAddress toAddress CC.DelegateCall Nothing funcName False args'
              case res of
                Just a -> return $ Constant a
                Nothing -> return $ Constant SNULL
            (SAccount addr _, "call") -> do
              let (funcName, args') = case argVals of
                    OrderedVals (SString fname : as) -> (fname, OrderedVals as)
                    OrderedVals _ -> typeError "call needs first argument to be a string" args
                    NamedVals _ -> typeError "Cannot provide named args to call" args
              fromAddress <- getCurrentAddress
              let toAddress = addr ^. namedAccountAddress
              res <- callWithResult fromAddress toAddress CC.RawCall Nothing funcName False args'
              case res of
                -- TODO: call() should return (bool, variadic)... (Constant BBool , Constant a)
                Just a -> return $ Constant a
                Nothing -> return $ Constant SNULL
            (SAccount addr _, itemName) -> regularFunctionCall argVals $ Just (return $ Constant $ SContractItem addr itemName)
            (SDecimal v, "truncate") -> case argVals of
              OrderedVals (SInteger n:_) -> return . Constant $ SDecimal $ roundTo' truncate (fromInteger n) v
              _ -> invalidArguments ("truncate() called with non-integer value as argument") args
            _ -> regularFunctionCall argVals Nothing
        _ -> regularFunctionCall argVals Nothing
      where
        regularFunctionCall :: MonadSM m => ValList -> Maybe (m Variable) -> m Variable
        regularFunctionCall argVals mSCI = do
          var <- case mSCI of
            Just sci -> sci
            Nothing -> expToVar' e Nothing
          case var of
            Constant (SReference (AccountPath address (MS.StoragePath pieces))) -> do
              val' <- getVar $ Constant $ SReference $ AccountPath address $ MS.StoragePath $ init pieces
              case (val', last pieces) of
                (SContract _ toAddress', MS.Field funcName) -> do
                  fromAddress <- getCurrentAddress
                  let toAddress = toAddress' ^. namedAccountAddress
                  res <- callWithResult fromAddress toAddress CC.DefaultCall Nothing (stringToLabel $ BC.unpack funcName) False argVals
                  case res of
                    Just v -> return $ Constant $ v
                    Nothing -> return $ Constant SNULL
                (SAccount toAddress' _, MS.Field funcName) -> do
                  fromAddress <- getCurrentAddress
                  let toAddress = toAddress' ^. namedAccountAddress
                  res <- callWithResult fromAddress toAddress CC.DefaultCall Nothing (stringToLabel $ BC.unpack funcName) False argVals
                  case res of
                    Just v -> return $ Constant $ v
                    Nothing -> return $ Constant SNULL
                x -> todo "expToVar'/FunctionCall" x
            Constant (SFunction name Nothing) -> case argVals of
              OrderedVals vs -> Constant <$> callBuiltin name vs
              NamedVals {} -> invalidArguments (printf "expToVar'/builtinfunction: cannot used namedvals with builtin %s" name) argVals
            Constant (SFunction funcName (Just func)) -> do
              ro <- readOnly <$> getCurrentCallInfo
              contract' <- getCurrentContract
              address <- getCurrentAddress
              (hsh, cc) <- getCurrentCodeCollection
              -- when (True) (internalError "IT'S MORBIN TIME" matchingFuncOverload)
              res <- do
                if (CC._funcIsFree func)
                  then do
                    validateFunctionArguments func argVals >>= \case
                      Just (mo, argVals') -> runTheCall address contract' funcName hsh cc mo argVals' ro True
                      Nothing -> runTheCall address contract' funcName hsh cc func argVals ro True
                  else do
                    validateFunctionArguments func argVals >>= \case
                      Just (mo, argVals') -> runTheCall address contract' funcName hsh cc mo argVals' ro False
                      Nothing -> case M.lookup funcName $ cc ^. CC.flFuncs of
                        Just ff -> do
                          validateFunctionArguments ff argVals >>= \case
                            Just (mo, argVals') -> runTheCall address contract' funcName hsh cc mo argVals' ro True
                            Nothing -> runTheCall address contract' funcName hsh cc func argVals ro False
                        Nothing -> runTheCall address contract' funcName hsh cc func argVals ro False
              return . Constant . fromMaybe SNULL $ res
            Constant (SStructDef structName) -> do
              contract' <- getCurrentContract
              case M.lookup structName $ contract' ^. CC.structs of
                Just vals -> do
                  return . Constant . SStruct structName . fmap Constant . M.fromList $
                    case argVals of
                      OrderedVals as -> zip (map (\(a, _, _) -> a) vals) as
                      NamedVals ns -> ns
                Nothing -> do
                  cc <- getCurrentCodeCollection
                  let !vals' = fromMaybe (missingType "struct constructor not found" structName) $ M.lookup structName $ (snd cc) ^. CC.flStructs
                  return . Constant . SStruct structName . fmap Constant . M.fromList $
                    case argVals of
                      OrderedVals as -> zip (map (\(a, _, _) -> a) vals') as
                      NamedVals ns -> ns
            Constant (SContractDef contractName') -> do
              decrementGas 500
              case argVals of
                OrderedVals [SInteger address] ->
                  --TODO- clean up this ambiguity between SAddress and SInteger....
                  return $ Constant $ SContract contractName' $ unspecifiedChain $ fromInteger address
                OrderedVals [SAccount address _] ->
                  return $ Constant $ SContract contractName' address
                OrderedVals [SContract _ addr] ->
                  return $ Constant $ SContract contractName' $ addr
                _ -> typeError "contract variable creation" argVals

            -- Transfer wei, throw error on failure no return on success
            -- TODO: When gas gets more implemented ensure that this function does not
            --       consume more than 2300 gas
            Constant (SContractItem address' "transfer") -> do
              from <- getCurrentAddress
              case argVals of
                OrderedVals [SInteger amount] -> do
                  res <- pay "built-in transfer function" from (address' ^. namedAccountAddress) amount
                  case res of
                    True -> return $ Constant SNULL
                    _ -> do
                      balance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy :: A.Proxy AddressState) from
                      paymentError amount (show address', balance)
                _ -> typeError "transfer arguments" argVals

            -- Send Wei return bool on failure or success
            -- TODO: When gas gets more implemented ensure that this function does not
            --       consume more than 2300 gas
            Constant (SContractItem address' "send") -> do
              from <- getCurrentAddress
              success <- case argVals of
                OrderedVals [SInteger amount] -> do
                  res <- pay "built-in send function" from (address' ^. namedAccountAddress) amount
                  case res of
                    True -> return True
                    _ -> return False
                _ -> return False
              return . Constant $ SBool success
            Constant (SContractItem toAccount "code") -> do
              -- let namedFrom = accountToNamedAccount' from --convert to a namedAccount to verify everything is on the correct chain

              -- Collect a potential item to search
              searchTerms <- case argVals of
                -- catch only the SStrings
                OrderedVals [SString arguments] -> pure $ Just arguments
                -- Throw an error if too many arguments are passed
                OrderedVals as | length as > 1 -> tooManyCooks 1 (length as)
                --If nothing was given or something else, then just return the entire code
                _ -> pure $ Nothing
              --get only the contract containing the sweet succulent ContractF definition
              (!contract, _, _) <- getCodeAndCollection (toAccount^.namedAccountAddress)
              decrementGas 1000 -- Discourage creating/calling contract instances willy nilly
              let codeSnippets :: [String]
                  codeSnippets =
                    case (fromMaybe "" searchTerms) of
                      --Unparse just the contract
                      "" -> [unparseContract contract]
                      term ->
                        --Search the full contract for the search term, retrieving the sourceAnnotation location of the part that was found
                        -- Check for and get the different parts of the contract
                        let contrString =
                              case ((contract ^. CC.contractName) == term) of
                                True -> Just $ unparseContract contract
                                False -> Nothing

                            constString =
                              case ((contract ^. CC.constants) M.!? term) of
                                Just constF -> Just $ unparseConstant (term, constF)
                                Nothing -> Nothing

                            storjString =
                              case ((contract ^. CC.storageDefs) M.!? term) of
                                Just storjF -> Just $ unparseVar (term, storjF)
                                Nothing -> Nothing

                            enumString =
                              case ((contract ^. CC.enums) M.!? term) of
                                Just enumF -> Just $ unparseEnum (term, fst enumF)
                                Nothing -> Nothing

                            structString =
                              case ((contract ^. CC.structs) M.!? term) of
                                Just structF -> Just $ unparseStruct (term, structF)
                                Nothing -> Nothing

                            eventString =
                              case ((contract ^. CC.events) M.!? term) of
                                Just eventF -> Just $ unparseEvent (term, eventF)
                                Nothing -> Nothing

                            funcString =
                              case ((contract ^. CC.functions) M.!? term) of
                                Just funcF -> Just $ unparseFunc (term, funcF)
                                Nothing -> Nothing

                            modString =
                              case ((contract ^. CC.modifiers) M.!? term) of
                                Just modF -> Just $ unparseModifier (term, modF)
                                Nothing -> Nothing
                         in --Remove all of the items that were found to contain nothing, this should leave just the items that we found
                            catMaybes [contrString, funcString, constString, storjString, enumString, eventString, structString, modString]
              pure . Constant $ SString (unlines codeSnippets)
            Constant (SContractItem address' itemName) -> do
              from <- getCurrentAddress
              let address = address' ^. namedAccountAddress
              result <- callWithResult from address CC.DefaultCall Nothing itemName False argVals
              return . Constant . fromMaybe SNULL $ result
            Constant (SContractFunction name address' functionName) -> do
              from <- getCurrentAddress
              let address = address' ^. namedAccountAddress
              result <- callWithResult from address CC.DefaultCall name functionName False argVals
              return . Constant . fromMaybe SNULL $ result
            Constant (SEnum enumName) -> do
              case argVals of
                OrderedVals [SInteger i] -> do
                  c <- getCurrentContract
                  case M.lookup enumName $ c ^. CC.enums of
                    Just theEnum -> do
                      case fst theEnum !? fromInteger i of
                        Nothing -> typeError "enum val out of range" argVals
                        Just enumVal -> pure . Constant . SEnumVal enumName enumVal $ fromInteger i
                    Nothing -> do
                      (_, cc) <- getCurrentCodeCollection
                      let !theEnum' =
                            fromMaybe (missingType "enum constructor" enumName) $
                              M.lookup enumName $ cc ^. CC.flEnums
                      case fst theEnum' !? fromInteger i of
                        Nothing -> typeError "enum val out of range" argVals
                        Just enumVal -> pure . Constant . SEnumVal enumName enumVal $ fromInteger i
                _ -> typeError "called enum constructor with improper args" argVals
            Constant (SPush theArray mvar) -> Builtins.push theArray mvar argVals
            Constant SStringConcat -> do
              case argVals of
                OrderedVals xs -> do
                  when
                    ( any
                        ( \x -> case x of
                            (SString _) -> False
                            _ -> True
                        )
                        xs
                    )
                    $ typeError "string concat" argVals
                  return $ Constant $ SString $ concatMap (\x -> case x of (SString s) -> s; _ -> "") xs
                _ -> typeError "called string concat with improper args" argVals
            Constant SHexDecodeAndTrim ->
              case argVals of
                -- bytes should already be hex decoded when appropriate
                OrderedVals [s@SString {}] -> return $ Constant s
                _ -> typeError "bytes32ToString with incorrect arguments" argVals
            Constant SAddressToAscii ->
              case argVals of
                OrderedVals [SAccount a _] -> return . Constant . SString $ show a
                _ -> typeError "addressToAsciiString with incorrect arguments" argVals
            -- It would be nice to reinterpret two element paths as a function.
            -- How can we get a to resolve to a local variable instead of a path?
            -- StorageItem [Field a, Field b] -> todo "reinterpret as a function

            _ -> typeError "cannot call non-function" var


expToVar' ep@(CC.Binary _ "=" dst@(CC.IndexAccess _ parent (Just indExp)) src) _ = do
  !srcVar <- expToVar src Nothing
  !srcVal <- getVar srcVar

  !pVar <- expToVar parent Nothing
  !pVal <- weakGetVar pVar

  -- If it's an array, calling (expToVar dst) gives us
  -- the value at the index, NOT a reference that we can
  -- assign to....so we need to make a new vector and reset the whole array
  case pVal of
    SArray fs -> do
      indVal <- getVar =<< expToVar indExp Nothing
      case indVal of
        SInteger ind -> do
          when ((ind >= toInteger (V.length fs) || 0 > ind)) (invalidWrite "Cannot assign a value outside the allocated space for an array" (unparseExpression ep))
          let newVec = fs V.// [(fromIntegral ind, srcVar)]
          setVar pVar (SArray newVec)
          return $ Constant $ SBool True
        _ -> typeError ("array index value (" ++ (show indVal) ++ ") is not an integer") (unparseExpression ep)
    SMap theMap -> do
      theIndex <- getVar =<< expToVar indExp Nothing
      let newMap = M.insert theIndex srcVar theMap
      setVar pVar (SMap newMap)
      return $ Constant $ SBool True
    _ -> do
      -- If it's a mapping, (expToVar dst) IS a reference, so we can set directly to it
      dstVar <- expToVar dst Nothing
      setVar dstVar srcVal
      return $ Constant srcVal
expToVar' ep@(CC.Binary _ "=" (CC.IndexAccess _ _ Nothing) _) _ = do
  missingField "index value cannot be empty" (unparseExpression ep)
expToVar' (CC.Binary _ "=" dst src) _ = do
  srcVal <- getVar =<< expToVar src Nothing
  dstVar <- expToVar dst Nothing

  setVar dstVar srcVal

  return $ Constant srcVal
expToVar' x _ = todo "expToVar/unhandled" x

--------------

evaluateAccountMember ::
  MonadSM m =>
  Address ->
  Bool -> -- Is SContract
  SolidString ->
  m Variable
evaluateAccountMember a _ "codehash" = do
  -- Get the chainId for the account
  -- Retreive and resolve the codehash
  codeHash' <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) a
  case codeHash' of
    SolidVMCode _ ch' -> return (Constant $ SString . keccak256ToHex $ ch')
    cp -> missingCodeCollection "Address is not a SolidVM contract" (format cp)
--Get the whole code collection when nothing is supplied to the code function
evaluateAccountMember a _ "code" = do
  -- Get the code at the address
  -- Retreive and resolve the codehash
  codeHash' <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) a
  let ch' = case codeHash' of
        SolidVMCode _ ch1' -> ch1'
        cp -> missingCodeCollection "Address is not a SolidVM contract" (format cp)
  -- Find the code using the codehash
  cd <- A.lookup (A.Proxy @DBCode) ch'
  let cd' = case cd of
        Just bs -> bs
        Nothing -> missingCodeCollection "Could not locate SolidVM code collection at address" (format a)
  let decodeCD = DT.decodeUtf8 cd'
  -- Format the result
  return $ Constant $ SString $ T.unpack decodeCD
evaluateAccountMember a _ "nonce" = do
  mAddrSt <- A.lookup (A.Proxy @AddressState) a
  case mAddrSt of
    Just as -> return $ Constant $ SInteger $ addressStateNonce as
    _ -> return $ Constant $ SInteger 0
evaluateAccountMember a _ "balance" = do
  bal <- A.lookup (A.Proxy @AddressState) a
  case bal of
    Just as -> return $ Constant $ SInteger $ addressStateBalance as
    _ -> return $ Constant $ SInteger 0
evaluateAccountMember a _ "creator" = do
  (_, _, issuerName) <- getCreator a
  return $ Constant $ SString $ issuerName
evaluateAccountMember a _ "root" = do
  (_, originAddress, _) <- getCreator a
  return $ Constant $ SAccount (NamedAccount originAddress MainChain) False
-- evaluateAccountMember a _ "call" =
evaluateAccountMember a True funcName = return $ Constant $ SContractFunction Nothing (NamedAccount a UnspecifiedChain) funcName
evaluateAccountMember a False itemName = do
  --return $ Constant $ SContractItem addr itemName
  from <- getCurrentAddress
  result <- callWithResult from a CC.DefaultCall Nothing itemName False (OrderedVals [])
  return . Constant . fromMaybe SNULL $ result

defaultToInt :: Value -> Value
defaultToInt SNULL = SInteger 0
defaultToInt x     = x

expToVarAdd :: MonadSM m => CC.Expression -> CC.Expression -> m Variable
expToVarAdd expr1 expr2 = do
  i1' <- getVar =<< expToVar expr1 Nothing
  i2' <- getVar =<< expToVar expr2 Nothing
  let addEm i1 i2 = case i1 of
        SInteger a -> case defaultToInt i2 of
          SInteger b -> return . Constant . SInteger $ a + b
          SDecimal b -> return . Constant . SDecimal $ (Decimal 0 a) + b
          _ -> typeError "expToVarAdd" (i1, i2)
        SDecimal a -> case defaultToInt i2 of
          SInteger b -> return . Constant . SDecimal $ a + (Decimal 0 b)
          SDecimal b -> return . Constant . SDecimal $ a + b
          _ -> typeError "expToVarAdd" (i1, i2)
        SString a -> case i2 of
          SString b -> return . Constant . SString $ a ++ b
          SNULL -> return . Constant $ SString a
          _ -> typeError "expToVarAdd" (i1, i2)
        SNULL -> case i2 of
          SNULL -> return $ Constant SNULL
          _ -> addEm i2 i1
        _ -> typeError "expToVarAdd" (i1, i2)
  addEm i1' i2'

--decMod operation, implements % w Data.Decimal library functions
decMod :: Decimal -> Decimal -> Decimal
decMod a b = fromRational (toRational a `mod'` toRational b)
  where
    mod' x y = x - (fromIntegral (floor (x / y) :: Integer)) * y

expToVarArith :: MonadSM m => 
  (Integer -> Integer -> Integer) -> 
  (Decimal -> Decimal -> Decimal) -> 
  CC.Expression -> 
  CC.Expression -> 
  Maybe SVMType.Type ->
  m Variable
expToVarArith intOp decOp expr1 expr2 valType = do
  i1 <- getVar =<< expToVar expr1 Nothing
  i2 <- getVar =<< expToVar expr2 Nothing
  let valType' = fromMaybe (SVMType.Int (Just True) Nothing) valType 
  case (defaultToInt i1, defaultToInt i2, valType') of
    (SInteger a, SInteger b, (SVMType.Int _ _)) -> return . Constant . SInteger $ a `intOp` b
    (SInteger a, SInteger b, SVMType.Decimal) -> return . Constant . SDecimal $ (Decimal 0 a) `decOp` (Decimal 0 b)
    (SDecimal a, SDecimal b, _) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b, _) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b, _) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "expToVarArith" (i1, i2)
  
expToVarDivide :: MonadSM m => 
  (Integer -> Integer -> Integer) -> 
  (Decimal -> Decimal -> Decimal) -> 
  CC.Expression -> 
  CC.Expression -> 
  Maybe SVMType.Type ->
  m Variable
expToVarDivide intOp decOp expr1 expr2 valType = do
  i1 <- getVar =<< expToVar expr1 Nothing
  i2 <- getVar =<< expToVar expr2 Nothing
  let valType' = fromMaybe (SVMType.Int (Just True) Nothing) valType 
  case (defaultToInt i1, defaultToInt i2, valType') of
    (SInteger a, SInteger b, (SVMType.Int _ _)) -> return . Constant . SInteger $ a `intOp` b
    (SInteger a, SInteger b, SVMType.Decimal) -> 
      return $ Constant $ SDecimal $ roundTo 0 ((Decimal 0 a) `decOp` (Decimal 0 b))
    (SDecimal a, SDecimal b, _) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b, _) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b, _) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "expToVarArith" (i1, i2)

expToVarInteger :: MonadSM m => CC.Expression -> (Integer -> Integer -> a) -> CC.Expression -> (a -> Value) -> m Variable
expToVarInteger expr1 o expr2 retType = do
  i1 <- getInt =<< expToVar expr1 Nothing
  i2 <- getInt =<< expToVar expr2 Nothing
  return . Constant . retType $ i1 `o` i2

binopAssign' :: MonadSM m => 
  (Integer -> Integer -> Integer) -> 
  (Decimal -> Decimal -> Decimal) -> 
  CC.Expression -> 
  CC.Expression -> 
  Maybe SVMType.Type ->
  m Variable
binopAssign' intOp decOp lhs rhs valType = do
  let readVal e = getVar =<< expToVar e Nothing
  delta <- readVal rhs
  curValue <- readVal lhs
  varToAssign <- expToVar lhs Nothing
  let valType' = fromMaybe (SVMType.Int (Just True) Nothing) valType
  next <- case (defaultToInt curValue, defaultToInt delta, valType') of
    (SInteger c, SInteger d, (SVMType.Int _ _)) -> pure . SInteger $ c `intOp` d
    (SInteger a, SInteger b, SVMType.Decimal) -> pure . SDecimal $ (Decimal 0 a) `decOp` (Decimal 0 b)
    (SDecimal a, SDecimal b, _) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      pure $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b, _) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      return $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b, _) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      return $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "binopAssign'" (curValue, delta)
  setVar varToAssign next
  return $ Constant next

binopDivide :: MonadSM m =>
  (Integer -> Integer -> Integer) -> 
  (Decimal -> Decimal -> Decimal) -> 
  CC.Expression -> 
  CC.Expression -> 
  Maybe SVMType.Type ->
  m Variable
binopDivide intOp decOp lhs rhs valType = do
  let readVal e = getVar =<< expToVar e Nothing
  delta <- readVal rhs
  curValue <- readVal lhs
  varToAssign <- expToVar lhs Nothing
  let valType' = fromMaybe (SVMType.Int (Just True) Nothing) valType
  next <- case (defaultToInt curValue, defaultToInt delta, valType') of
    (SInteger c, SInteger d, (SVMType.Int _ _)) -> pure . SInteger $ c `intOp` d
    (SInteger a, SInteger b, SVMType.Decimal) -> 
      return $ SDecimal $ roundTo 0 ((Decimal 0 a) `decOp` (Decimal 0 b))
    (SDecimal a, SDecimal b, _) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      return $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b, _) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      return $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b, _) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      return $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "binopAssign'" (curValue, delta)
  setVar varToAssign next
  return $ Constant next

addAndAssign :: MonadSM m => CC.Expression -> CC.Expression -> m Variable
addAndAssign lhs rhs = do
  let readVal e = getVar =<< expToVar e Nothing
  delta <- readVal rhs
  curValue <- readVal lhs
  varToAssign <- expToVar lhs Nothing
  next <- case (defaultToInt curValue, defaultToInt delta) of
    (SInteger c, SInteger d) -> pure . SInteger $ c + d
    (SString c, SString d) -> pure . SString $ c ++ d
    (SDecimal c, SDecimal d) -> pure . SDecimal $ c + d
    (SDecimal a, SInteger b) -> pure . SDecimal $ a + (Decimal 0 b)
    (SInteger a, SDecimal b) -> pure . SDecimal $ (Decimal 0 a) + b
    _ -> typeError "addAndAssign" (curValue, delta)
  setVar varToAssign next
  return $ Constant next

binopAssign :: MonadSM m => (Integer -> Integer -> Integer) -> CC.Expression -> CC.Expression -> m Variable
binopAssign oper lhs rhs = do
  let readInt e = getInt =<< expToVar e Nothing
  delta <- readInt rhs
  curValue <- readInt lhs
  varToAssign <- expToVar lhs Nothing
  let next = SInteger $ curValue `oper` delta
  setVar varToAssign next
  return $ Constant next

intBuiltin :: [Value] -> Value
intBuiltin [SEnumVal _ _ enumNum] = SInteger $ fromIntegral enumNum
intBuiltin [SInteger n] = SInteger n
intBuiltin [SDecimal v] = SInteger (decimalMantissa $ roundTo 0 v)
intBuiltin [SString hex] = integerToValue $ parseBaseInt hex 16
intBuiltin [SString hex, SInteger 16] = integerToValue $ parseBaseInt hex 16
intBuiltin [SString dec, SInteger 10] = integerToValue $ parseBaseInt dec 10
intBuiltin [SNULL] = SInteger 0
intBuiltin args = typeError "numeric cast - invalid args" args

integerToValue :: Either String Integer -> Value
integerToValue (Right n) = SInteger n
integerToValue (Left err) = typeError err ("" :: String)

decimalBuiltin :: [Value] -> Value
decimalBuiltin [SInteger n] = SDecimal $ Decimal 0 n
decimalBuiltin [SString str] =
  let stringToDecimal = (readEither str :: Either String Decimal)
  in case stringToDecimal of
    Right deci -> SDecimal deci
    Left e -> typeError e str
decimalBuiltin [SDecimal v] = SDecimal v
decimalBuiltin [SNULL] = SDecimal $ Decimal 0 0
decimalBuiltin args = typeError "decimal cast - invalid args" args

parseBaseInt :: String -> Integer -> Either String Integer
parseBaseInt s n =
  case n of
    10 -> readEither s
    16 -> case B16.decode (BC.pack s) of
      Right l ->
        let zeros = 32 - B.length l
         in Right . fromIntegral . bytesToWord256 $ B.replicate zeros 0x0 <> l
      _ -> Left $ "numeric cast - not a hex string " <> s
    _ -> Left $ "Cannot convert string " <> s <> " to base " <> show n

castToAncestor :: MonadSM m => NamedAccount -> String -> m Value
castToAncestor a _ = 
    return $ SAccount (NamedAccount (a^.namedAccountAddress) MainChain) False

callBuiltin :: MonadSM m => SolidString -> [Value] -> m Value
callBuiltin "string" [SString s] = return $ SString s
callBuiltin "string" [SAccount a _] = return . SString $ show a
callBuiltin "string" [SInteger i] = return . SString $ show i
callBuiltin "string" [SBool b] = return . SString $ bool "false" "true" b
callBuiltin "string" [SNULL] = return $ SString ""
callBuiltin "string" vs = typeError "string cast" vs
callBuiltin "address" [SInteger a] = return . ((flip SAccount) False) . unspecifiedChain $ fromIntegral a
callBuiltin "address" [SAccount na b] = return $ SAccount (unspecifiedChain (_namedAccountAddress na)) b
callBuiltin "address" [SContract _ a] = return $ SAccount a False
callBuiltin "address" [ss@(SString s)] =
  maybe
    (typeError "address cast" ss)
    (return . ((flip SAccount) False) . (namedAccountChainId .~ UnspecifiedChain))
    $ readMaybe s
callBuiltin "address" [SNULL] = return $ SAccount (unspecifiedChain 0) False
callBuiltin "address" vs = typeError "address cast" vs
callBuiltin "account" [SInteger a] = return . ((flip SAccount) False) . unspecifiedChain $ fromIntegral a
callBuiltin "account" [a@SAccount {}] = return a
callBuiltin "account" [SContract _ a] = return $ SAccount a False
callBuiltin "account" [ss@(SString s)] =
  maybe
    (typeError "account cast" ss)
    (return . ((flip SAccount) False))
    $ readMaybe s
callBuiltin "account" [SInteger a, SInteger b] = return . ((flip SAccount) False) $ explicitChain (fromIntegral a) (fromInteger b)
callBuiltin "account" [SInteger a, SString "main"] = return . ((flip SAccount) False) $ mainChain (fromIntegral a)
callBuiltin "account" [SInteger a, SString "self"] = do
  pure . ((flip SAccount) False) $ mainChain (fromIntegral a)
callBuiltin "account" [SInteger a, SString ('0' : 'x' : xs)] = do
  return . ((flip SAccount) False) $ explicitChain (fromIntegral a) (fromIntegral $ base16ToIntegral xs)
  where
    hexChar ch = fromMaybe (invalidArguments "illegal character in chainId hexstring" [ch]) $ elemIndex ch "0123456789ABCDEF"
    base16ToIntegral = foldl' (\n c -> 16 * n + (hexChar $ CHAR.toUpper c)) 0
callBuiltin "account" [SInteger a, SString name] = unspecifiedChain (fromIntegral a) `castToAncestor` name
callBuiltin "account" [(SAccount a _), SInteger b] = return . ((flip SAccount) False) $ (namedAccountChainId .~ ExplicitChain (fromIntegral b)) a
callBuiltin "account" [(SAccount a _), SString "main"] = return . ((flip SAccount) False) $ (namedAccountChainId .~ MainChain) a
callBuiltin "account" [(SAccount a _), SString "self"] = do
  pure . ((flip SAccount) False) $ (namedAccountChainId .~ MainChain) a
callBuiltin "account" [(SAccount a _), SString ('0' : 'x' : xs)] = return . ((flip SAccount) False) $ (namedAccountChainId .~ ExplicitChain (fromIntegral $ base16ToIntegral xs)) a
  where
    hexChar ch = fromMaybe (invalidArguments "illegal character in chainId hexstring" [ch]) $ elemIndex ch "0123456789ABCDEF"
    base16ToIntegral = foldl' (\n c -> 16 * n + (hexChar $ CHAR.toUpper c)) 0
callBuiltin "account" [(SAccount a _), SString name] = a `castToAncestor` name
callBuiltin "account" [SNULL] = return $ SAccount (unspecifiedChain 0) False
callBuiltin ("addmod") [SInteger a, SInteger b, SInteger c] = return . SInteger $ (a + b) `mod` c
callBuiltin ("mulmod") [SInteger a, SInteger b, SInteger c] = return . SInteger $ (a * b) `mod` c
callBuiltin ("blockhash") [SInteger blockNum] | blockNum < 0 = invalidArguments "blockhash() only accepts arguments greater than or equal to 0" [blockNum]
callBuiltin ("blockhash") [SInteger blockNum] = do
  env' <- getEnv
  let curBlock = Env.blockHeader env'
  maybeTheHash <- getBlockHashWithNumber blockNum (BlockHeader.parentHash curBlock)
  maybe (invalidArguments "the block number given does not exist" [blockNum]) (return . SString . BC.unpack . keccak256ToByteString) maybeTheHash
callBuiltin ("selfdestruct") [SAccount a _] = do
  contract' <- getCurrentAddress
  contractBalance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy @AddressState) contract'
  _destroyRes <- A.adjustWithDefault_ (A.Proxy @AddressState) contract' $ \newAddressState ->
    pure newAddressState {addressStateCodeHash = SolidVMCode "Code_0" $ unsafeCreateKeccak256FromWord256 0}
  sendRes <- pay "selfdestruct function" contract' (a^.namedAccountAddress) contractBalance
  _purgeRes <- purgeStorageMap contract'
  return $ SBool sendRes
callBuiltin "account" vs = typeError "account cast" vs
callBuiltin "bool" [SBool b] = return $ SBool b
callBuiltin "bool" [SString "true"] = return $ SBool True
callBuiltin "bool" [SString "false"] = return $ SBool False
callBuiltin "bool" [SNULL] = return $ SBool False
callBuiltin "bool" vs = typeError "bool cast" vs
callBuiltin "byte" [SInteger n] = return $ SInteger (n .&. 0xff)
callBuiltin "byte" [SNULL] = return $ SInteger 0
callBuiltin "byte" vs = typeError "byte cast" vs
callBuiltin "uint" args = return $ intBuiltin args
callBuiltin "int" args = return $ intBuiltin args
callBuiltin "decimal" args = return $ decimalBuiltin args
callBuiltin "identity" [v] = return v
callBuiltin "log" args = SNULL <$ traverse (liftIO . putStrLn <=< showSM) args
callBuiltin "keccak256" args = SString . keccak256ToHex . hash . rlpSerialize <$> rlpEncodeValues args
callBuiltin "ecrecover" [SString h, SInteger v, r', s'] = case B16.decode (BC.pack h) of
  Left err -> invalidArguments err ("" :: String)
  Right bytestringHash -> do
    rIntHash <- case r' of
      SInteger r -> pure r
      SString r -> case Numeric.readHex r of
        [(x, "")] -> return x
        _ -> invalidArguments "parseHex: error parsing r: " r
      _ -> invalidArguments "ecrecover: r must be a hex string or an integer" r'
    sIntHash <- case s' of
      SInteger s -> pure s
      SString s -> case Numeric.readHex s of
        [(y, "")] -> return y
        _ -> invalidArguments "parseHex: error parsing s: " s
      _ -> invalidArguments "ecrecover: s must be a hex string or an integer" s'
    let theSignerAddress = whoSignedThisTransactionEcrecover (unsafeCreateKeccak256FromByteString bytestringHash) rIntHash sIntHash v
    let theZero :: Integer
        theZero = 0
    case theSignerAddress of
      Nothing -> return . ((flip SAccount) False) . unspecifiedChain $ fromIntegral theZero
      Just theAddress -> return . ((flip SAccount) False) . unspecifiedChain $ theAddress
callBuiltin "sha256" args = SString . BC.unpack . SHA256.hash . rlpSerialize <$> rlpEncodeValues args
callBuiltin "ripemd160" args = SString . BC.unpack . RIPEMD160.hash . rlpSerialize <$> rlpEncodeValues args
callBuiltin "modExp" [SInteger b, SInteger e, SInteger m] = pure . SInteger $ Builtins.modExp b e m
callBuiltin "ecAdd" [SInteger x1, SInteger y1, SInteger x2, SInteger y2] =
  let (x, y) = Builtins.ecAdd (x1, y1) (x2, y2)
   in pure . STuple . V.fromList $ Constant <$> [SInteger x, SInteger y]
callBuiltin "ecMul" [SInteger x1, SInteger y1, SInteger s] =
  let (x, y) = Builtins.ecMul (x1, y1) s
   in pure . STuple . V.fromList $ Constant <$> [SInteger x, SInteger y]
callBuiltin "ecPairing" [SVariadic xs] =
  let go (SInteger x : xs') = (x:) <$> go xs'
      go []   = Right []
      go xs' = Left xs'
   in case go xs of
        Right points -> pure . SBool $ Builtins.ecPairing points
        Left xs' -> typeError "invalid args passed to ecPairing" xs'
callBuiltin "ecPairing" [SArray xs] =
  SBool . Builtins.ecPairing <$> traverse getInt (V.toList xs)
callBuiltin "ecPairing" xs =
  let go (SInteger x : xs') = (x:) <$> go xs'
      go []   = Right []
      go xs' = Left xs'
   in case go xs of
        Right points -> pure . SBool $ Builtins.ecPairing points
        Left xs' -> typeError "invalid args passed to ecPairing" xs'
callBuiltin ("payable") [SAccount a _] = return $ SAccount a True
callBuiltin "require" (SBool cond : msg) = do
  case msg of
    [] -> require cond Nothing
    (m : _) -> require cond (Just $ show m)
  return SNULL
callBuiltin "assert" [SBool cond] = SNULL <$ assert cond
callBuiltin "getUserCert" [SAccount a _] = do
  --Add others
  curContract <- getCurrentContract
  maybeCert <- A.select (A.Proxy @X509Certificate) $ a ^. namedAccountAddress
  return $ certificateMap (fmap (BC.unpack . certToBytes) maybeCert) curContract
callBuiltin "getCertField" [(SAccount a _), (SString certField)] = do
  --Add others
  maybeField <- A.select (A.Proxy @X509CertificateField) $ ((a ^. namedAccountAddress), ((T.pack $ show certField)))
  case maybeField of
    Nothing -> return $ (SString $ fromString "")
    Just f -> return $ SString ((\(X509CertificateField xf) -> xf) f)

-- SolidVM built in function that verifies that the root cert is signed by the key
-- verifyCert checks that the root of a chained cert is signed by the public key.
-- But verifyCertSignedBy checks that the target of a chained cert is signed by the public key.
-- Expects the public key to be in PEM format
-- Raises an error if it can't parse either argument, however perhaps that should't happen...
callBuiltin "verifyCert" [SString cert, SString pubkey] = do
  let ex509Cert = bytesToCert . BC.pack $ cert
  let ePublicKey = bsToPub $ BC.pack pubkey
  case (ex509Cert, ePublicKey) of
    (Left q, _) -> invalidCertificate "Could not parse X.509 certificate" q
    (_, Left r) -> malformedData "Could not parse public key" r
    (Right x509Cert, Right publicKey) -> do
      let isValid = verifyCert publicKey x509Cert
      onTraced $
        liftIO $
          putStrLn $
            ( if isValid
                then C.green "The certificate is valid."
                else C.red "The certificate is invalid"
            )
      return $ SBool isValid

-- SolidVM built in function that verifies a cert that if it's signed by a given key
-- verifyCert checks that the root of a chained cert is signed by the public key.
-- But verifyCertSignedBy checks that the target of a chained cert is signed by the public key.
-- Expects the public key to be in PEM format
-- Raises an error if it can't parse either argument, however perhaps that should't happen...
callBuiltin "verifyCertSignedBy" [SString cert, SString pubkey] = do
  let ex509Cert = bytesToCert . BC.pack $ cert
  let ePublicKey = bsToPub $ BC.pack pubkey
  case (ex509Cert, ePublicKey) of
    (Left q, _) -> invalidCertificate "Could not parse X.509 certificate" q
    (_, Left r) -> malformedData "Could not parse public key" r
    (Right x509Cert, Right publicKey) -> do
      let isValid = verifyCertSignedBy publicKey x509Cert
      onTraced $
        liftIO $
          putStrLn $
            ( if isValid
                then C.green "The certificate is valid."
                else C.red "The certificate is invalid"
            )
      return $ SBool isValid

-- SolidVM builtin function that verifies a ECSDA non-recoverable signature is signed by a given key with on the SECP256k1 curve
-- Expects the signature as a DER/PEM format encoded string
-- Expects the public key to be in PEM format
-- Raises an error if it can't parse either argument, however perhaps that should't happen...
callBuiltin "verifySignature" [SString msg, SString signature, SString pubkey] = do
  let eMesgBs = B16.decode $ BC.pack msg
  case eMesgBs of
    Right mesgBs -> do
      if ((BC.length mesgBs) /= 32)
        then malformedData "Message hash is not 32 bytes" msg
        else do
          let mSignature = SEC.importSignature' $ LabeledError.b16Decode "callBuiltin" $ BC.pack signature
          let ePublicKey = bsToPub $ BC.pack pubkey
          case (mSignature, ePublicKey) of
            (Nothing, _) -> malformedData "Could not parse EC Signature " signature
            (_, Left pk) -> malformedData "Could not parse public key" pk
            (Just sig, Right publicKey) -> do
              let isValid = SEC.verifySig publicKey sig mesgBs
              onTraced $
                liftIO $
                  putStrLn $
                    ( if isValid
                        then C.green "The signature is valid."
                        else C.red "The signature is invalid"
                    )
              return $ SBool isValid
    Left err -> malformedData "Could not decode hex string" err
callBuiltin "parseCert" [SString cert] = do
  curContract <- getCurrentContract
  return $ certificateMap (Just cert) curContract
callBuiltin "create" args@(SString contractName' : SString contractSrc : argVals) = do
  when (contractName' == "" || contractSrc == "") $
    invalidArguments "The contract name and src arguments for the create function should not be empty" args

  creator <- getCurrentAddress

  -- Because of the current testnet stateroot problem with contracts using an older version of
  -- create/create2 with incomplete codeptrs, this pragma will allow new contract using the
  -- create/create2 features to work correctly but unfortunately, even without the pragma, the contracts
  -- will still work but will have incorrect codeptrs.
  -- Thus, when the testnet wipes, this pragma can largely be removed because the old contracts on the
  -- testnet won't exist anymore and the stateroot mismatches will be fixed.
  isRunningTests <- Env.runningTests <$> getEnv
  (hsh, cc) <- codeCollectionFromSource isRunningTests True $ BC.pack contractSrc
  newAddress <- getNewAddress creator
  theEnv <- getEnv
  let origin = Env.origin theEnv
  (ctr, _, ctrName) <- getCreator $ origin --not sure if this should be there instead
  execResults <- create' creator newAddress ctr ctrName newAddress hsh cc contractName' (OrderedVals argVals)
  case erNewContractAddress execResults of
    Just nca -> pure $ ((flip SAccount) False) $ NamedAccount nca UnspecifiedChain
    Nothing -> internalError "a call to create did not create an address" execResults
callBuiltin "create2" args@(salt : SString contractName' : SString contractSrc : argVals) = do
  when (contractName' == "" || contractSrc == "") $
    invalidArguments "The contract name and src arguments for the create2 function should not be empty" args

  creator <- getCurrentAddress

  -- Because of the current testnet stateroot problem with contracts using an older version of
  -- create/create2 with incomplete codeptrs, this pragma will allow new contract using the
  -- create/create2 features to work correctly but unfortunately, even without the pragma, the contracts
  -- will still work but will have incorrect codeptrs.
  -- Thus, when the testnet wipes, this pragma can largely be removed because the old contracts on the
  -- testnet won't exist anymore and the stateroot mismatches will be fixed.
  isRunningTests <- Env.runningTests <$> getEnv
  (hsh, cc) <- codeCollectionFromSource isRunningTests True $ BC.pack contractSrc
  let constructorArgVals = OrderedVals argVals
  newAddress <- getNewAddressWithSalt creator salt hsh $ show constructorArgVals
  (ctr, originAddress, ctrName) <- getCreator creator
  execResults <- create' creator originAddress ctr ctrName newAddress hsh cc contractName' constructorArgVals
  case erNewContractAddress execResults of
    Just nca -> pure $ ((flip SAccount) False) $ NamedAccount nca UnspecifiedChain
    Nothing -> internalError "a call to create did not create an address" execResults
callBuiltin "fastForward" [SInteger seconds] = do
  -- Only allow fastForward during testing
  env' <- getEnv
  if not (Env.runningTests env')
    then invalidArguments "fastForward can only be called during testing" [SInteger seconds]
    else do
      -- Get current timestamp and add seconds
      let currentTimestamp = BlockHeader.timestamp $ Env.blockHeader env'
          newTimestamp = addUTCTime (fromIntegral seconds) currentTimestamp
          updatedBlockHeader = (Env.blockHeader env') { BlockHeader.timestamp = newTimestamp }
      -- Update the environment with new block header
      Mod.modify_ (Mod.Proxy @Env.Environment) $ \env ->
        pure $ env { Env.blockHeader = updatedBlockHeader }
      return SNULL

callBuiltin x args = unknownFunction ("callBuiltin " ++ show args) x

certificateMap :: Maybe String -> CC.Contract -> Value
certificateMap maybeCert _ =
  case maybeCert of
    Nothing -> SMap emptyCertMap
    Just cert -> SMap (fromMaybe emptyCertMap $ fmap (certMap cert) (subject cert))
  where
    subject cert = getCertSubject =<< (eitherToMaybe . bytesToCert . BC.pack $ cert)
    rawCert cert = eitherToMaybe . bytesToCert . BC.pack $ cert
    nonEmptyFields cert sub =
      M.fromList
        [ (SString "commonName", Constant . SString $ subCommonName sub),
          (SString "country", Constant . SString $ fromMaybe "" $ subCountry sub),
          (SString "organization", Constant . SString $ subOrg sub),
          (SString "group", Constant . SString $ fromMaybe "" $ subUnit sub),
          (SString "publicKey", Constant . SString $ BC.unpack $ pubToBytes $ subPub sub),
          (SString "userAddress", Constant . SString $ show $ fromPublicKey $ subPub sub),
          (SString "certString", Constant . SString $ cert),
          (SString "parent", Constant . SString $ maybe "0" show (getParentUserAddress =<< (eitherToMaybe . bytesToCert . BC.pack $ cert)))
        ]
    emptyFields =
      M.fromList
        [ (SString "commonName", Constant . SString $ ""),
          (SString "country", Constant . SString $ ""),
          (SString "organization", Constant . SString $ ""),
          (SString "group", Constant . SString $ ""),
          (SString "publicKey", Constant . SString $ ""),
          (SString "userAddress", Constant . SString $ ""),
          (SString "certString", Constant . SString $ ""),
          (SString "parent", Constant . SString $ "")
        ]
    certMap cert sub =
      let fieldsToUpdate =
            M.fromList
              [ (SString "organizationalUnit", Constant . SString $ fromMaybe "" $ subUnit sub),
                (SString "expirationDate", Constant . SString $ fromMaybe "" $ dateTimeToString . snd . getCertValidity <$> rawCert cert)
              ]
       in M.union fieldsToUpdate $ nonEmptyFields cert sub
    emptyCertMap =
      let fieldsToUpdate =
            M.fromList
              [ (SString "organizationalUnit", Constant . SString $ ""),
                (SString "expirationDate", Constant . SString $ "")
              ]
       in M.union fieldsToUpdate $ emptyFields

runTheConstructors :: MonadSM m => Address -> Address -> Keccak256 -> CC.CodeCollection -> SolidString -> ValList -> m ()
runTheConstructors from to hsh cc contractName' argVals' = do
  let !contract' =
        fromMaybe (missingType "contract inherits from nonexistent parent" contractName') $
          cc ^. CC.contracts . at contractName'
      argPairs = fromMaybe [] . fmap CC._funcArgs $ contract' ^. CC.constructor
      argTypeNames =
        map fst $
          sortWith snd $
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
    Just theConstructor -> validateFunctionArguments theConstructor argVals' >>= \case
      Just (_, vals) -> pure vals
      Nothing -> invalidArguments "constructor arguments don't match" (contractName', argVals')

  let einval = invalidArguments "named arguments to contract without constructor" (contractName', argVals)
  zipped <-
    case argVals of
      OrderedVals vals -> do
        let go [(SVMType.Variadic, n)] [SVariadic vs'] = do
              let var = Constant $ SVariadic vs'
              pure [(n, (SVMType.Variadic, var))]
            go [(SVMType.Variadic, n)] vs' = do
              let var = Constant $ SVariadic vs'
              pure [(n, (SVMType.Variadic, var))]
            go [] _ = pure []
            go _ [] = pure []
            go ((t,n):tns) (v:vs') = do
              let correctedVal = coerceType contract' t v
              var <- createVar correctedVal
              ((n,(t,var)):) <$> go tns vs' 
        go argTypeNames vals
      NamedVals ns -> do
        let argTypes =
              M.fromList $
                map (\(k, v) -> (fromMaybe "" $ k, v)) $
                  maybe einval CC._funcArgs $ contract' ^. CC.constructor

            typeAndVal =
              M.merge
                (M.mapMissing (curry $ invalidArguments "missing argument"))
                (M.mapMissing (curry $ invalidArguments "extra argument"))
                (M.zipWithMatched $ \_k t v -> (t, v))
                argTypes
                (M.fromList ns)

        forM (M.toList typeAndVal) $ \(n, (CC.IndexedType _ t, v)) -> do
          let correctedVal = coerceType contract' t v
          var <- createVar correctedVal
          return (n, (t, var))

  void . withCallInfo to contract' "constructor" hsh cc (M.fromList zipped) False False . pushSender from $ do

    forM_ [(n, e, theType) | (n, CC.VariableDecl theType _ (Just e) _ _ _) <- M.toList $ contract' ^. CC.storageDefs] $ \(n, e, theType) -> do
      v <- expToVar e $ Just theType
      setVar (Constant (SReference (AccountPath to $ MS.StoragePath [MS.Field $ BC.pack $ labelToString n]))) =<< getVar v

    forM_ [(n, theType) | (n, CC.VariableDecl theType _ Nothing _ _ _) <- M.toList $ contract' ^. CC.storageDefs] $ \(n, theType) -> do
      case theType of
        SVMType.Mapping _ _ _ -> return ()
        SVMType.Array _ _ -> return ()
        t -> do
          defVal <- createDefaultValue cc contract' t
          for_ (toBasic defVal) $ markDiffForAction to (MS.StoragePath [MS.Field $ BC.pack $ labelToString n])
    -- SVMType.Bool -> markDiffForAction to (MS.StoragePath [MS.Field $ BC.pack $ labelToString n]) $ MS.BBool False

    forM_ (reverse $ contract' ^. CC.parents) $ \parent -> do
      for_ (M.lookup parent . CC._funcConstructorCalls =<< contract' ^. CC.constructor) $ \args'' -> do
        vals <- traverse (getVar <=< flip expToVar Nothing) args''
        runTheConstructors from to hsh cc parent $ OrderedVals vals

    case contract' ^. CC.constructor of
      Just theFunction -> do
        let theModifierNames = map fst $ (CC._funcModifiers theFunction)
        !theModifiers' <- forM theModifierNames $ \name -> do
          case M.lookup name (contract' ^. CC.modifiers) of
            Just theModifier -> do
              return $ Just theModifier
            Nothing -> do
              if name `elem` contract' ^. CC.parents then return Nothing else missingField "modifier not found" name
        let theModifiers = catMaybes theModifiers'
        !commands <- case CC._funcContents theFunction of
          Nothing -> missingField "contract constructor has been declared but not defined" contractName'
          Just cms -> pure cms
        -- let modifierArgs = map CC.modifierArgs theModifiers
        let !modContentsList = map (\m -> fromMaybe (missingField "Function call: Modifier has been declared but not defined" m) (CC._modifierContents m)) theModifiers
        _ <- runModifiersAndStatements modContentsList commands
        pure ()
      Nothing -> return ()

  return ()

-- Note: this is intentionally nonstrict in `theType`
addLocalVariable :: MonadSM m => SVMType.Type -> SolidString -> Value -> m ()
addLocalVariable theType name value = do
  --  initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack name) value
  newVariable <- liftIO $ fmap Variable $ newIORef value
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    [] -> internalError "addLocalVariable called with an empty stack" (name, value)
    (currentSlice : rest) -> do
      let lvs NE.:| lvs' = localVariables currentSlice
      Mod.put (Mod.Proxy @[CallInfo]) $
        currentSlice
          { localVariables =
              M.insert name (theType, newVariable) lvs
                NE.:| lvs'
          } :
        rest

runTheCall ::
  MonadSM m =>
  Address ->
  CC.Contract ->
  SolidString ->
  Keccak256 ->
  CC.CodeCollection ->
  CC.Func ->
  ValList ->
  Bool ->
  Bool ->
  m (Maybe Value)
runTheCall address' contract' funcName hsh cc theFunction argVals' ro ff = do
  let !returnNamesAndTypes = [(n, t) | (Just n, CC.IndexedType _ t) <- CC._funcVals theFunction]
      !theModifierNames = map fst $ (CC._funcModifiers theFunction)
  !returns <- traverse (\(n, t) -> ((n,) . (t,)) <$> createDefaultValue cc contract' t) returnNamesAndTypes

  theModifiers' <- forM theModifierNames $ \name -> do
    case M.lookup name (contract' ^. CC.modifiers) of
      Just theModifier -> do
        return $ Just theModifier
      Nothing -> if name `elem` contract' ^. CC.parents then return Nothing else missingField "modifier not found" name
  let !theModifiers = catMaybes theModifiers'

  argVals <- validateFunctionArguments theFunction argVals' >>= \case
    Just (_, av) -> pure av
    Nothing -> typeError
      "the argument values do not match up with the function signature" 
      (let valList' = case argVals' of OrderedVals xs -> xs; NamedVals ys -> map snd ys 
       in show $ zip (valList') (map (CC.indexedTypeType . snd) (CC._funcArgs theFunction)))

  let !args = case argVals of
        OrderedVals vs ->
          let argMeta =
                map (\(n, CC.IndexedType _ t) -> (fromMaybe "" n, t)) $
                  CC._funcArgs theFunction
              go [(n, SVMType.Variadic)] [SVariadic vs'] = [(n, (SVMType.Variadic, SVariadic vs'))]
              go [(n, SVMType.Variadic)] vs' = [(n, (SVMType.Variadic, SVariadic vs'))]
              go [] _ = []
              go _ [] = []
              go ((n,t):nts) (v:vs') =
                let v' = coerceType contract' t v
                 in (n,(t,v')) : go nts vs' 
           in go argMeta vs
        NamedVals ns ->
          let strTypes = M.fromList $ map (\(maybeName, y) -> (fromMaybe "" maybeName, y)) $ CC._funcArgs theFunction
              typeAndVal =
                M.merge
                  (M.mapMissing (curry $ invalidArguments "missing argument"))
                  (M.mapMissing (curry $ invalidArguments "extra argument"))
                  (M.zipWithMatched $ \_k t v -> (t, v))
                  strTypes
                  $ M.fromList ns
              -- These probably don't need to be sorted by argument index, as they are turned into a map
              -- when added to the call info.
              sortedArgs =
                map snd . sortWith fst
                  . map (\(n, (CC.IndexedType i t, v)) -> (i, (n, (t, v))))
                  $ M.toList typeAndVal
           in sortedArgs
  let locals = args ++ returns
  localVars1 <-
    forM locals $ \(n, (t, v)) -> do
      newVar <- liftIO $ fmap Variable $ newIORef v
      return (n, (t, newVar))

  val' <- withCallInfo address' contract' funcName hsh cc (M.fromList localVars1) ro ff $ do -- [(n, (t, Constant v)) | (n, (t, v)) <- locals]
    matchedArgvals <- forM theModifiers $ \modi -> do
      let !margList =
            CC.OrderedArgs
              . fromMaybe []
              $ M.lookup (T.unpack (CC._modifierSelector modi)) $ M.fromList $ CC._funcModifiers theFunction
      margVals <- argsToVals margList
      case margVals of
        OrderedVals vs -> do
          let argMeta = map (\(n, CC.IndexedType _ t) -> (n, t)) $ CC._modifierArgs modi
          return (zipWith (\(n, t) v -> (n, (t, v))) argMeta vs)
        NamedVals ns -> do
          let strTypes = M.fromList $ CC._modifierArgs modi
              typeAndVal =
                M.merge
                  (M.mapMissing (curry $ invalidArguments "missing argument"))
                  (M.mapMissing (curry $ invalidArguments "extra argument"))
                  (M.zipWithMatched $ \_k t v -> (t, v))
                  strTypes
                  $ M.mapKeys T.pack $ M.fromList ns
              -- These probably don't need to be sorted by argument index, as they are turned into a map
              -- when added to the call info.
              !sortedArgs =
                map snd . sortWith fst
                  . map (\(n, (CC.IndexedType i t, v)) -> (i, (n, (t, v))))
                  $ M.toList typeAndVal
          return sortedArgs
    -- ++ (map (\(x,y) -> (T.unpack x, y)) (concat matchedArgvals)) --modArgsToBeLocals

    onTraced $ do
      liftIO $ putStrLn $ "            args: " ++ show (map fst args)
      when (not $ null returns) $ liftIO $ putStrLn $ "    named return: " ++ show (map fst returns)

    -- let myCombinerForEfficiency xs [] = return xs
    --     myCombinerForEfficiency xs ((n,(t,v)):ys) = do
    --       newVar <- liftIO $ fmap Variable $ newIORef v
    --       myCombinerForEfficiency ((n, (t, newVar)) : xs) ys

    forM_ (map (\(x, y) -> (T.unpack x, y)) (concat matchedArgvals)) $ \(n, (t, v)) -> do
      addLocalVariable t n v

    -- theCallInfo <- getCurrentCallInfo
    -- when (True || (not $ null matchedArgvals)) $ error (show theCallInfo)
    let !commands = fromMaybe (missingField "Function call: function has been declared but not defined" funcName) $ CC._funcContents theFunction
    let modContentsList = map (\m -> fromMaybe (missingField "Function call: Modifier has been declared but not defined" m) (CC._modifierContents m)) theModifiers
    val <- runModifiersAndStatements modContentsList commands

    let findNamedReturns = do
          case returns of
            [] -> return Nothing
            [(name, _)] -> do
              -- We have to break this up because
              -- SolidVM cannot distinguish between
              -- a value and single-tupled value
              currentCallInfo <- getCurrentCallInfo
              let mReturnVar = M.lookup name . NE.head $ localVariables currentCallInfo
              case mReturnVar of
                Nothing -> unknownVariable "findNamedReturns" name
                Just returnVar -> fmap Just . forceLoadVar =<< getVar (snd returnVar)
            xs ->
              Just . STuple . V.fromList <$> do
                currentCallInfo <- getCurrentCallInfo
                for (fst <$> xs) $ \name -> do
                  let mReturnVar = M.lookup name . NE.head $ localVariables currentCallInfo
                  case mReturnVar of
                    Nothing -> unknownVariable "findNamedReturns" name
                    Just returnVar -> fmap Constant . forceLoadVar =<< getVar (snd returnVar)
    val' <- case val of
      Nothing -> findNamedReturns
      Just SNULL -> findNamedReturns
      Just {} -> traverse forceLoadVar val
    pure val'

  return val'

logAssigningVariable :: MonadSM m => Value -> m ()
logAssigningVariable v = do
  valueString <- showSM v
  cntrct <- getCurrentContract
  onTracedSM cntrct $ liftIO $ putStrLn $ "            %%%% assigning variable: " ++ valueString

logVals :: (Show a, Show b, MonadIO m) => a -> b -> m ()
logVals val1 val2 =
  onTraced . liftIO $
    printf
      "            %%%% val1 = %s\n\
      \            %%%% val2 = %s\n"
      (show val1)
      (show val2)

--TODO: It would be nice to hold type information in the return value....  Unfortunately to be backwards compatible with the old API, for now we can not include this.
-- change the return type from ByteSTring to String
encodeForReturn :: MonadSM m => Value -> m String
encodeForReturn v =
  case v of
    STuple {} -> encodeForReturn' v
    _ -> do
      v' <- encodeForReturn' v
      return $ "(" <> v' <> ")"

encodeForReturn' :: MonadSM m => Value -> m String
encodeForReturn' (SInteger i) = return $ show i
encodeForReturn' (SEnumVal _ _ v) = return $ show v
encodeForReturn' (SAccount a _) = return $ "\"" ++ (show $ a ^. namedAccountAddress) ++ "\""
encodeForReturn' (SContract _ a) = return $ "\"" ++ (show $ a ^. namedAccountAddress) ++ "\""
encodeForReturn' (SBool b) = return $ if b then "true" else "false"
encodeForReturn' (SString s) = return $ show s
{- The following comments are just for previous encodeForReturn function to return ByteString type.
-- in the case of tuples, we need to follow the EVM/Solidity encoding convention:
--   1) starting at the first value to encode, check if it is fixed length type (32), or
--      dynamic (right now, this group is only strings since we don't return arrays).
--   2) if a fixed type, encode it directly into the next 32 characters in the bytestring
--   3) if dynamic:
--      a) encode an offset value into the next 32 characters.
--      b) at that offset, put the encoded string's length in the first 32 characters,
--         followed by the encoded string
--   4) repeat for the remaining values
--
--   The headers of the bytestring are the initial (tuple_length * 32) characters.
--   They are either encoded simple values, or offsets. If some are offsets (to
--   encoded strings), then they point to characters beyond the (tuple_length * 32)
--   In other words, the final bytestring is headers `B.append` encodedStrings
--
--
--   As an example, return type (string, uint, string) would have the following encoding:
--
--                                            (offsetStr1)            (offsetStr2)
-- Size:  |     32    |     32    |     32    |    32    | str1EncLen |    32    | str2EncLen |
-- Value: |offset_str1|encoded_int|offset_str2|str1EncLen|   str1Enc  |str2EncLen|   str2Enc  |
-}
encodeForReturn' (SArray items) = do
  encodedItems <- mapM (encodeForReturn' <=< getVar) $ V.toList items
  return $ "[" ++ (intercalate "," encodedItems) ++ "]" --[,]
encodeForReturn' (STuple items) = do
  encodedItems <- mapM (encodeForReturn' <=< getVar) $ V.toList items

  return $ "(" ++ (intercalate "," encodedItems) ++ ")"
encodeForReturn' (SDecimal d) = return $ show d 
encodeForReturn' (SStruct _ vs) = do
  let encodePair k v = fmap (\v' -> show (labelToString k) ++ ": " ++ v')
                     . encodeForReturn' =<< forceLoadVar =<< getVar v
  encodedItems <- mapM (uncurry encodePair) $ M.toList vs
  pure $ "{" ++ intercalate "," encodedItems ++ "}"
encodeForReturn' SNULL = pure "[]"
encodeForReturn' x = todo "Cannot encode this return type: " x

--formatAddressWithoutColor : padded the address with 40 bytes
solidityExceptionHandlerHelper :: (MonadSM m, Ord k, IsString k) => M.Map k (Maybe (SolidString, SVMType.Type), [CC.Statement]) -> t1 -> t2 -> Integer-> (t1 -> t2 -> m (Maybe Value))-> m (Maybe Value)
solidityExceptionHandlerHelper cbm s1 s2 errCode errFunc = do
  case M.lookup "Panic" cbm of
    Nothing -> do
      case M.lookup "Nill" cbm of
        Nothing -> errFunc s1 s2
        Just (_, stmts) -> do
          res' <-  runStatementBlock stmts
          return res'
    Just (mVar, block) -> do
      case mVar of
        Nothing -> do
          res' <-  runStatementBlock block
          return res'
        Just (varName, varType) -> do
          addLocalVariable varType varName (SInteger errCode)
          res <- runStatementBlock block
          return res

solidityExceptionHandlerHelper' :: (MonadSM m, Ord k, IsString k) => M.Map k (Maybe (SolidString, SVMType.Type), [CC.Statement]) -> t1 -> Integer-> (t1 -> m (Maybe Value))-> m (Maybe Value)
solidityExceptionHandlerHelper' cbm s1 errCode errFunc = do
  case M.lookup "Panic" cbm of
    Nothing -> do
      case M.lookup "Nill" cbm of
        Nothing -> errFunc s1
        Just (_, stmts) -> do
          res' <-  runStatementBlock stmts
          return res'
    Just (mVar, block) -> do
      case mVar of
        Nothing -> do
          res' <-  runStatementBlock block
          return res'
        Just (varName, varType) -> do
          addLocalVariable varType varName (SInteger errCode)
          res <- runStatementBlock block
          return res

solidityExceptionHandlerHelper'' :: (MonadSM m, Ord k, IsString k) => M.Map k (Maybe (SolidString, SVMType.Type), [CC.Statement]) -> t1 -> t2 -> t3-> Integer-> (t1 -> t2 -> t3 -> m (Maybe Value))-> m (Maybe Value)
solidityExceptionHandlerHelper'' cbm s1 s2 vals errCode errFunc = do
  case M.lookup "Panic" cbm of
    Nothing -> do
      case M.lookup "Nill" cbm of
        Nothing -> errFunc s1 s2 vals
        Just (_, stmts) -> do
          res' <-  runStatementBlock stmts
          return res'
    Just (mVar, block) -> do
      case mVar of
        Nothing -> do
          res' <-  runStatementBlock block
          return res'
        Just (varName, varType) -> do
          addLocalVariable varType varName (SInteger errCode)
          res <- runStatementBlock block
          return res

solidityExceptionHandlerHelperRequire :: (MonadSM m, Ord k, IsString k) => M.Map k (Maybe (SolidString, SVMType.Type), [CC.Statement]) -> Maybe String -> m (Maybe Value)
solidityExceptionHandlerHelperRequire cbm s1  = do
  case M.lookup "Error" cbm of
          Nothing -> do
            case M.lookup "Nill" cbm of
              Nothing -> do
                _ <- require False s1
                return Nothing
              Just (_, stmts) -> do
                res' <-  runStatementBlock stmts
                return res'
          Just (mVar, block) -> do
            case mVar of
              Nothing -> do
                res' <-  runStatementBlock block
                return res'
              Just (varName, varType) -> do
                addLocalVariable varType varName (SString (fromMaybe "Require Error" s1))
                res <- runStatementBlock block
                return res

solidityExceptionHandlerHelperAssert :: (MonadSM m, Ord k, IsString k) => M.Map k (Maybe (SolidString, SVMType.Type), [CC.Statement]) -> m (Maybe Value)
solidityExceptionHandlerHelperAssert cbm  = do
  case M.lookup "Error" cbm of
        Nothing -> do
          case M.lookup "Nill" cbm of
            Nothing -> do
              _ <- assert False
              return Nothing
            Just (_, stmts) -> do
              res' <-  runStatementBlock stmts
              return res'
        Just (mVar, block) -> do
          case mVar of
            Nothing -> do
              res' <-  runStatementBlock block
              return res'
            Just (varName, varType) -> do
              addLocalVariable varType varName (SString "Assertion Error")
              res <- runStatementBlock block
              return res
{- BEN WILL REFACTOR THIS SOMEDAY -}
solidityExceptionHandler :: MonadSM m => (M.Map String (Maybe (String, SVMType.Type), [CC.Statement])) -> SolidException -> m (Maybe Value)
solidityExceptionHandler catchBlockMap ex = 
  case ex of
    (InternalError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 1 internalError
      return res
    (TypeError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 2 typeError
      return res
    (InvalidArguments s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 3 invalidArguments
      return res
    (IndexOutOfBounds s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 4 indexOutOfBounds
      return res
    (TODO s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 5 todo
      return res
    (MissingField s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 6 missingField
      return res
    (MissingType s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 7 missingType
      return res
    (DuplicateDefinition s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 8 duplicateDefinition
      return res
    (ArityMismatch s1 i1 i2) -> do
      res <- solidityExceptionHandlerHelper'' catchBlockMap s1 i1 i2 9 arityMismatch
      return res
    (UnknownFunction s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 10 unknownFunction
      return res
    (UnknownVariable s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 11 unknownVariable
      return res
    (DivideByZero s1) -> do
      res <- solidityExceptionHandlerHelper' catchBlockMap s1 12 divideByZero
      return res
    (Require s1) -> do
      res <- solidityExceptionHandlerHelperRequire catchBlockMap s1
      return res
    (Assert) -> do
      res <- solidityExceptionHandlerHelperAssert catchBlockMap 
      return res
    (MissingCodeCollection s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 13 missingCodeCollection
      return res
    (InaccessibleChain s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 14 inaccessibleChain
      return res
    (InvalidWrite s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 15 invalidWrite
      return res
    (InvalidCertificate s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 16 invalidCertificate
      return res
    (MalformedData s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 17 malformedData
      return res
    (TooMuchGas s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 18 tooMuchGas
      return res
    (PaymentError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 19 paymentError
      return res
    (ParseError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 20 parseError
      return res
    (UnknownConstant s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 21 unknownConstant
      return res
    (UnknownStatement s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 22 unknownStatement
      return res
    (ReservedWordError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 23 reservedWordError
      return res
    (ModifierError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 24 modifierError
      return res
    (ImmutableError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 25 immutableError
      return res
    (FailedToAttainRunTimCode s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 26 getRunTimeCodeError
      return res
    (TooManyResultsError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 27 tooManyResultsError
      return res
    (TooManyCooks s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 28 tooManyCooks
      return res
    (UserDefinedError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 29 userDefinedError
      return res
    (InvalidChain s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 30 invalidChain
      return res
    (GeneralMetaProgrammingError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 31 generalMetaProgrammingError
      return res
    (MissingCertificate s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 32 missingCertificate
      return res
    (RevertError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 33 revertError
      return res
    (CustomError s1 s2 vals) -> do
      let name = T.unpack $ T.replace "\"" "" $ T.pack s2
      case M.lookup name catchBlockMap of
        Nothing -> solidityExceptionHandlerHelper'' catchBlockMap s1 name vals 34 customError 
        Just (Nothing, _) -> solidityExceptionHandlerHelper'' catchBlockMap s1 name vals 34 customError 
        Just (Just (name', type'), block) -> do
          mapM_ (\x -> addLocalVariable type' name' x) $ map fromBasic vals
          res <- runStatementBlock block
          return res
    (DuplicateContract s1) -> do
      res <- solidityExceptionHandlerHelper' catchBlockMap s1 35 duplicateContract
      return res
    (OldForeignPragmaError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 36 oldForeignPragmaError
      return res

solidVMExceptionHelper :: (MonadSM m) => M.Map String (Maybe [String], [CC.Statement]) -> m (Maybe Value) -> m (Maybe Value)
solidVMExceptionHelper x y = case M.lookup "" x of
  Nothing -> y
  Just (_, block) -> do
    res <- runStatementBlock block
    return res

solidVMExceptionHandler :: (MonadSM m) => (M.Map String (Maybe [String], [CC.Statement])) -> SolidException -> m (Maybe Value)
solidVMExceptionHandler catchBlockMap ex =
  case ex of
    (InternalError s1 s2) -> do
      case M.lookup "InternalError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ internalError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (InvalidArguments s1 s2) ->
      case M.lookup "InvalidArguments" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ invalidArguments s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (IndexOutOfBounds s1 s2) ->
      case M.lookup "IndexOutOfBounds" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ indexOutOfBounds s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (ParseError s1 s2) ->
      case M.lookup "ParseError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ parseError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (Require s1) ->
      case M.lookup "Require" catchBlockMap of
        Nothing -> do
          case M.lookup "" catchBlockMap of
            Nothing -> do
              _ <- require False s1
              return Nothing
            Just (_, stmts) -> do
              res' <- runStatementBlock stmts
              return res'
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (Assert) ->
      case M.lookup "Assert" catchBlockMap of
        Nothing -> do
          case M.lookup "" catchBlockMap of
            Nothing -> do
              _ <- assert False
              return Nothing
            Just (_, stmts) -> do
              res' <- runStatementBlock stmts
              return res'
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (UnknownFunction s1 s2) ->
      case M.lookup "UnknownFunction" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ unknownFunction s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (UnknownConstant s1 s2) ->
      case M.lookup "UnknownConstant" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ unknownConstant s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (UnknownVariable s1 s2) ->
      case M.lookup "UnknownVariable" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ unknownVariable s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (UnknownStatement s1 s2) ->
      case M.lookup "UnknownStatement" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ unknownStatement s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (DivideByZero s1) ->
      case M.lookup "DivideByZero" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ divideByZero s1
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (MissingCodeCollection s1 s2) ->
      case M.lookup "MissingCodeCollection" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ missingCodeCollection s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (InaccessibleChain s1 s2) ->
      case M.lookup "InaccessibleChain" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ inaccessibleChain s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (InvalidWrite s1 s2) ->
      case M.lookup "InvalidWrite" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ invalidWrite s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (InvalidCertificate s1 s2) ->
      case M.lookup "InvalidCertificate" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ invalidCertificate s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (MalformedData s1 s2) ->
      case M.lookup "MalformedData" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ malformedData s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (TooMuchGas s1 s2) ->
      case M.lookup "TooMuchGas" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ tooMuchGas s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (PaymentError s1 s2) ->
      case M.lookup "PaymentError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ paymentError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (TooManyResultsError s1 s2) ->
      case M.lookup "TooManyResultsError" catchBlockMap of
        Nothing -> tooManyResultsError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (TooManyCooks s1 s2) ->
      case M.lookup "TooManyCooks" catchBlockMap of
        Nothing -> tooManyCooks s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (GeneralMetaProgrammingError s1 s2) ->
      case M.lookup "GeneralMetaProgrammingError" catchBlockMap of
        Nothing -> generalMetaProgrammingError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (InvalidChain s1 s2) ->
      case M.lookup "InvalidChain" catchBlockMap of
        Nothing -> invalidChain s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (CustomError s1 s2 vals) -> do
      let name = T.unpack $ T.replace "\"" "" $ T.pack s2
      case M.lookup name catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ customError s1 name vals
        Just (args, block) -> do
          ctract <- getCurrentContract
          (_, cc) <- getCurrentCodeCollection
          let basicToVals = map (\x -> fromBasic x) vals
              zipped = case M.lookup name $ CC._errors ctract of
                Just e -> zip e basicToVals
                Nothing -> case M.lookup name $ CC._flErrors cc of
                  Just e -> zip e basicToVals
                  Nothing -> invalidArguments "Invalid error type." name
              argsToSolidString = case args of
                Just a -> map stringToLabel a
                Nothing -> []
          _ <-
            if length args > 0
              then mapM (\(x, ((_, (CC.IndexedType _ y), _), z)) -> addLocalVariable y x z) $ zip argsToSolidString zipped
              else pure $ [()]
          res <- runStatementBlock block
          return res
    (TypeError s1 s2) -> do
      case M.lookup "TypeError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ typeError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (TODO s1 s2) -> do
      case M.lookup "TODO" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ todo s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (MissingField s1 s2) -> do
      case M.lookup "MissingField" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ missingField s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (RevertError s1 s2) -> do
      case M.lookup "RevertError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ revertError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (MissingType s1 s2) -> do
      case M.lookup "MissingType" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ missingType s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (DuplicateDefinition s1 s2) -> do
      case M.lookup "DuplicateDefinition" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ duplicateDefinition s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (DuplicateContract s1) -> do
      case M.lookup "DuplicateContract" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ duplicateContract s1
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (ArityMismatch s1 i1 i2) -> do
      case M.lookup "ArityMismatch" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ arityMismatch s1 i1 i2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (ModifierError s1 s2) -> do
      case M.lookup "ModifierError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ modifierError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (ReservedWordError s1 s2) -> do
      case M.lookup "ReservedWordError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ reservedWordError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (ImmutableError s1 s2) -> do
      case M.lookup "ImmutableError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ immutableError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (FailedToAttainRunTimCode s1 s2) -> do
      case M.lookup "FailedToAttainRunTimCode" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ getRunTimeCodeError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (OldForeignPragmaError s1 s2) -> do
      case M.lookup "OldForeignPragmaError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ oldForeignPragmaError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res   
    (UserDefinedError s1 s2) -> do
      case M.lookup "UserDefinedError" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ userDefinedError s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res
    (MissingCertificate s1 s2) -> do
      case M.lookup "MissingCertificate" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ missingCertificate s1 s2
        Just (_, block) -> do
          res <- runStatementBlock block
          return res

-- checks if an argument list is valid for a given function signature
validateFunctionArguments:: MonadSM m => CC.Func -> ValList -> m (Maybe (CC.Func, ValList))
validateFunctionArguments func argVals = checkFunc $ func : CC._funcOverload func
  where
    checkFunc [] = pure Nothing
    checkFunc (x:xs) = testMatch x >>= \case
      Just argVals' -> pure $ Just (x, argVals') 
      Nothing -> checkFunc xs
    argValsLength = case argVals of
      OrderedVals xs -> length xs
      NamedVals xs -> length xs
    testMatch :: MonadSM m => CC.Func -> m (Maybe ValList)
    testMatch tf = mapArgs tf >>= \case
      Nothing -> pure Nothing
      Just argMapping -> sequence <$> traverse marshalValue (snd <$> argMapping) >>= \case
        Just vals' -> pure . Just $ OrderedVals vals'
        Nothing -> pure . bool Nothing (Just argVals) $ testValidVariadic tf
    testValidVariadic :: CC.Func -> Bool
    testValidVariadic tf =
      case unsnoc (map snd (CC._funcArgs tf)) of
        Just ([], x) | CC.indexedTypeType x == SVMType.Variadic -> True  
        Just (xs, x) | CC.indexedTypeType x == SVMType.Variadic -> argValsLength >= length xs
        _ -> False
    marshalValue :: MonadSM m => (SVMType.Type, Value) -> m (Maybe Value)
    marshalValue (t, v) =
      -- These cases might not be all inclusive of all valid combinations.
      case (v, t) of
        (SInteger i, SVMType.Int _ _) -> pure . Just $ SInteger i
        (SInteger i, SVMType.String _) -> pure . Just . SString $ show i
        (SInteger i, SVMType.Address b) -> pure . Just $ SAccount (unspecifiedChain $ fromInteger i) b
        (SInteger i, SVMType.Account b) -> pure . Just $ SAccount (unspecifiedChain $ fromInteger i) b
        (SInteger i, SVMType.UnknownLabel _ _) -> pure . Just $ SAccount (unspecifiedChain $ fromInteger i) False
        (SInteger i, SVMType.Decimal) -> pure . Just . SDecimal $ fromInteger i
        (SDecimal d, SVMType.Decimal) -> pure . Just $ SDecimal d
        (SString s, SVMType.String _) -> pure . Just $ SString s
        (SString s, SVMType.Bytes _ _) -> pure . Just $ SString s
        (SString s, SVMType.Address b) -> pure $ flip SAccount b . unspecifiedChain <$> stringAddress s
        (SString s, SVMType.Account b) -> pure $ flip SAccount b . unspecifiedChain <$> stringAddress s
        (SBool b, SVMType.Bool) -> pure . Just $ SBool b
        (SAccount a _, SVMType.Address b) -> pure . Just $ SAccount a b
        (SAccount a _, SVMType.Account b) -> pure . Just $ SAccount a b
        (SEnumVal r x y, SVMType.UnknownLabel u _) -> pure . bool Nothing (Just $ SEnumVal r x y) $ r == u
        (SStruct r x, SVMType.UnknownLabel u _) -> pure . bool Nothing (Just $ SStruct r x) $ r == u
        (SContract r x, SVMType.UnknownLabel u _) -> pure . bool Nothing (Just $ SContract r x) $ r == u
        (SArray vs, SVMType.Array y ml) ->
          if (Just $ V.length vs) `SVMType.maybeEq` (fromIntegral <$> ml)
            then fmap SArray . sequence <$> traverse (fmap (fmap Constant) . marshalValue . (y,) <=< getVar) vs
            else pure Nothing
        (SArray vs, SVMType.Variadic) -> Just . SVariadic . V.toList <$> traverse getVar vs
        (SVariadic x, SVMType.Variadic) -> pure . Just $ SVariadic x
        (SVariadic vs, SVMType.Array y ml) ->
          if (Just $ length vs) `SVMType.maybeEq` (fromIntegral <$> ml)
            then fmap (SArray . V.fromList . map Constant) . sequence <$> traverse (marshalValue . (y,)) vs
            else pure Nothing
        (r@(SReference addressedPath), _) -> do
          refType <- getXabiValueType addressedPath
          if (refType == t)
            then pure $ Just r
            else case (refType, t) of
              (SVMType.UnknownLabel x _, SVMType.UnknownLabel y _) -> pure . bool Nothing (Just r) $ x == y
              (SVMType.Array x _, SVMType.Array y _) -> pure . bool Nothing (Just r) $ x == y
              _ -> pure Nothing
        _ -> pure Nothing
    mapArgs :: MonadSM m => CC.FuncF a -> m (Maybe [(String, (SVMType.Type, Value))])
    mapArgs theFunc = case argVals of
      OrderedVals vs ->
        let go [(n, SVMType.Variadic)] [SVariadic args] = pure $ Just [(n, (SVMType.Variadic, SVariadic args))]
            go [(n, SVMType.Variadic)] args = pure $ Just [(n, (SVMType.Variadic, SVariadic args))]
            go nts [SVariadic args] = go nts args
            go nts@(_:_:_) [SArray args] = go nts . V.toList =<< traverse getVar args
            go ((n,t):nts) (v:args) = (((n, (t, v)):) <$>) <$> go nts args
            go [] [] = pure $ Just []
            go _ _ = pure Nothing
            argMeta =
              map (\(n, CC.IndexedType _ t) -> (fromMaybe "" n, t)) $
                CC._funcArgs theFunc
         in go argMeta vs
      NamedVals ns ->
        let strTypes = M.fromList $ map (\(maybeName, y) -> (fromMaybe "" maybeName, y)) $ CC._funcArgs theFunc
            typeAndVal =
              M.merge
                (M.dropMissing)
                (M.dropMissing)
                (M.zipWithMatched $ \_k t v -> (t, v))
                strTypes
                $ M.fromList ns
            sortedArgs =
              map snd . sortWith fst
                . map (\(n, (CC.IndexedType i t, v)) -> (i, (n, (t, v))))
                $ M.toList typeAndVal
          in pure $ Just sortedArgs
