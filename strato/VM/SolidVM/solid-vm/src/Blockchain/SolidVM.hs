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

module Blockchain.SolidVM
  ( SolidVMBase,
    call,
    create,
    callReturnEnv,
    createReturnEnv,
  )
where

import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.DB.ModifyStateDB (pay)
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockHeader (BlockHeader)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.ExecResults
import Blockchain.Data.RLP
import Blockchain.Data.Transaction (whoSignedThisTransactionEcrecover)
import Blockchain.Data.Util (integer2Bytes)
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
import SolidVM.Solidity.StaticAnalysis.Typechecker (showType)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Delta
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Util (byteString2Integer)
import Blockchain.Stream.Action (Action)
import Blockchain.VMContext
import Blockchain.VMOptions
import Blockchain.Strato.Model.Options (computeNetworkID)
import Control.Applicative
import Control.DeepSeq (force)
import Control.Exception (throw)
import Control.Lens hiding (Context, assign, from, to, uncons, unsnoc)
import Control.Monad
import qualified Control.Monad.Catch as EUnsafe
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import Crypto.ECC (Curve_P256R1)
import Crypto.Error
import qualified Crypto.PubKey.ECC.P256 as P256
import Crypto.PubKey.ECDSA (signatureFromIntegers, verifyDigest)
import "crypton" Crypto.Hash (SHA256, digestFromByteString)
import qualified Crypto.Hash.RIPEMD160 as RIPEMD160
import qualified Crypto.Hash.SHA256 as SHA256
import Data.Bits
import Data.Bool (bool)
import qualified Data.ByteString        as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Decimal
import Data.Char (isDigit)
import Data.Foldable (for_)
import Data.Function (on)
import Data.List
import qualified Data.List.NonEmpty as NE
import qualified Data.Map as M
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
--import Blockchain.DB.RawStorageDB
--import Blockchain.Data.BlockSummary
--import Blockchain.DB.MemAddressStateDB

import Network.Haskoin.Crypto.BigWord ()
import qualified Numeric (showHex)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
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
runExpr exprText = withoutDebugging . withStaticCallInfo $ do
  -- TODO: allow write access once we figure out how to discard changes
  let eExpr = runParser expression initialParserState "" (T.unpack exprText)
  case eExpr of
    Left pe -> pure . Left . T.pack $ show pe
    Right expr -> do
      eRes <- EUnsafe.try $ do
        var <- expToVar expr
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
            Env.runningTests = isRunningTests
          }
  let gasInfo' =
        GasInfo
          { _gasLeft = availableGas,
            _gasUsed = 0,
            _gasInitialAllotment = availableGas,
            _gasMetadata = ""
          }

  fmap (fmap $ either solidvmErrorResults id) . runSM (Just code) env' gasInfo' $ do

    (hsh, cc) <- codeCollectionFromSource isRunningTests True $ DT.encodeUtf8 initCode
    addNewCodeCollection hsh cc
    let eArgExps = traverse (runParser parseArg initialParserState "" . T.unpack) argsStrings
        !argExps = either (parseError "create arguments") id eArgExps
    argVals <- argsToVals argExps

    create' sender' newAddress hsh cc (T.unpack contractName) argVals

create' :: MonadSM m => Address -> Address -> Keccak256 -> CC.CodeCollection -> SolidString -> ValList -> m ExecResults
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

  -- Run the constructor
  runTheConstructors creator newAddress ch cc contractName' valList

  onTraced $ liftIO $ putStrLn $ C.green $ "Done Creating Contract: " ++ show newAddress ++ " of type " ++ labelToString contractName'

  -- I'm showing these strings because I like them to be in quotes in the logs :)
  multilineLog "create'/versioning" $ boringBox ["Contract Name: " ++ (C.yellow contractName')]

  finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
  finalAct <- Mod.get (Mod.Proxy @Action)
  let (newV, remV) = fromDelta . getDeltasFromEvents $ toList finalEvs
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
        erNewValidators = newV,
        erRemovedValidators = remV
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
            Env.runningTests = isRunningTests
          }

  let gasInfo' =
        GasInfo
          { _gasLeft = availableGas,
            _gasUsed = 0,
            _gasInitialAllotment = availableGas,
            _gasMetadata = ""
          }

  fmap (fmap $ either solidvmErrorResults id) . runSM Nothing env' gasInfo' $ do
    --requireOriginCert origin'
    let -- maybeSrcLength = M.lookup "srcLength" =<< metadata
        -- !srcLength = maybe 0 (\sl -> read (T.unpack sl) :: Int) maybeSrcLength
        srcLength = 0
        eArgExps = traverse (runParser parseArg (initialParserStateWithLength srcLength) "" . T.unpack) argsStrings
        !argExps = either (parseError "call arguments") id eArgExps
    argVals <- argsToVals argExps

    maybeVal <-
      call' sender' codeAddress (fromMaybe CC.DefaultCall mFuncCallType) (textToLabel funcName) argVals

    returnVal <-
      case maybeVal of
        Nothing -> return "()"
        Just ret -> encodeForReturn ret

    finalAct <- Mod.get (Mod.Proxy @Action)
    finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
    let (newV, remV) = fromDelta . getDeltasFromEvents $ toList finalEvs

    return $
      ExecResults
        { erRemainingTxGas = 0, --Just use up all the allocated gas for now....
          erRefund = 0,
          erReturnVal = Just returnVal,
          erTrace = [],
          erLogs = [],
          erEvents = toList finalEvs,
          erNewContractAddress = Nothing,
          erSuicideList = S.empty,
          erAction = Just $ finalAct,
          erException = Nothing, -- tells me if theres an exception
          erPragmas = [],
          erNewValidators = newV,
          erRemovedValidators = remV
        }

call' ::
  MonadSM m =>
  Address ->
  Address ->
  CC.FunctionCallType ->
  SolidString ->
  ValList ->
  m (Maybe Value)
call' from to' fnCalltype functionName valList = do
  (isExternal, storageAddress, codeAddress) <- case fnCalltype of
    CC.DelegateCall -> return (True, from, to')
    CC.RawCall -> return (True, to', to')
    _ -> (from /= to', to',) <$> do
      if from == to'
        then do
          mCallInfo <- getCurrentCallInfoIfExists
          case mCallInfo of
            Just callInfo -> pure $ currentCodeAddress callInfo
            _ -> pure to'
        else pure to'
  let shouldPushSender = bool False (fnCalltype /= CC.DelegateCall) isExternal
  (contract, hsh, cc) <- getCodeAndCollection codeAddress

  initializeAction storageAddress

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
        when (isExternal && isForbidden) $
          unknownFunction "logFunctionCall" (functionName, "asdf2" :: String) -- contract) -- ^. CC.contractName)
        let ro = case mCallInfo of
              Nothing -> False
              Just ci -> readOnly ci
        pure . bool id (pushSender from) shouldPushSender $
          runTheCall storageAddress codeAddress contract functionName' hsh cc theFunction valList ro False
      -- Handles .call() and .delegatecall() logic
      (Just theFunction, _) -> do
        let isForbidden = theFunction ^. CC.funcVisibility == Just CC.Private || theFunction ^. CC.funcVisibility == Just CC.Internal
        when (isExternal && isForbidden) $
          unknownFunction "logFunctionCall" (functionName, "asdf" :: String) -- contract ^. CC.contractName)
        validateFunctionArguments theFunction valList >>= \case
          Just (theFunction', valList') -> do
            mCallInfo <- getCurrentCallInfoIfExists
            let ro = case mCallInfo of
                  Nothing -> False
                  Just ci -> readOnly ci
            pure . bool id (pushSender from) shouldPushSender $
              runTheCall storageAddress codeAddress contract functionName' hsh cc theFunction' valList' ro False
          _ -> case M.lookup "fallback" functionsIncludingConstructor of
            Just fallbackFunc -> do
              mCallInfo <- getCurrentCallInfoIfExists
              let ro = case mCallInfo of
                    Nothing -> False
                    Just ci -> readOnly ci
              pure . bool id (pushSender from) shouldPushSender $
                runTheCall storageAddress codeAddress contract functionName' hsh cc fallbackFunc valList ro False
            _ -> unknownFunction "logFunctionCall" (functionName, valList) -- contract ^. CC.contractName)
      -- Maybe the function is actually a getter
      _ -> case M.lookup functionName $ contract ^. CC.storageDefs of
        Just CC.VariableDecl {..} -> do
          let args' = fromMaybe [] $ case (_varType, valList) of
                ((SVMType.Array _ _), oa) -> for oa $ \case
                  SInteger n -> Just . MS.Index . BC.pack $ show n
                  _ -> Nothing
                ((SVMType.Mapping _ _ _), oa) ->
                  traverse convertValueToStoragePathPiece oa
                _ -> Nothing
              returnType = \case
                SVMType.Array t _ -> returnType t
                SVMType.Mapping _ _ t -> returnType t
                t -> t
              isForbidden = case _varVisibility of
                Just CC.Public -> False
                _ -> True
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
          when (isExternal && isForbidden) $
            unknownFunction "logFunctionCall" (functionName, "asdf4" :: String) -- contract ^. CC.contractName)
          -- TODO: this should only exist if the storage variable is declared "public",
          -- right now I just ignore this and allow anything to be called as a getter
          case args' of
            [] -> do
              let path = AddressPath storageAddress $ MS.singleton $ BC.pack $ labelToString functionName
              withCallInfo storageAddress codeAddress contract functionName hsh cc M.empty True False $ case returnType _varType of
                SVMType.Struct _ s -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                SVMType.UnknownLabel s -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                _ -> pure $ handleSimple path
            _ -> do
              let path = apSnocList (AddressPath storageAddress . MS.singleton $ BC.pack $ labelToString functionName) args'
              withCallInfo storageAddress codeAddress contract functionName hsh cc M.empty True False $ case returnType _varType of
                SVMType.Struct _ s -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                SVMType.UnknownLabel s -> pure $ (<|>) <$> handleStruct s path <*> handleSimple path
                _ -> pure $ handleSimple path
        Nothing -> case M.lookup "fallback" functionsIncludingConstructor of
          Just fallbackFunc -> do
            mCallInfo <- getCurrentCallInfoIfExists
            let ro = case mCallInfo of
                  Nothing -> False
                  Just ci -> readOnly ci
            pure . bool id (pushSender from) shouldPushSender $
              runTheCall storageAddress codeAddress contract functionName hsh cc fallbackFunc valList ro False
          _ -> unknownFunction "logFunctionCall" (functionName, "asdf5" :: String) -- ^. CC.contractName)

  when (fnCalltype == CC.DelegateCall) $ do
    codeContractName <- do
      ch <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) codeAddress
      let n = case ch of
                SolidVMCode n' _ -> n'
                _ -> ""
      return n
    addDelegatecall storageAddress codeAddress Nothing (T.pack codeContractName)
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

callWithResult :: MonadSM m => Address -> Address -> CC.FunctionCallType -> SolidString -> ValList -> m (Maybe Value)
callWithResult from to fnCalltype functionName valList = call' from to fnCalltype functionName valList

logFunctionCall :: MonadSM m => ValList -> Address -> CC.Contract -> SolidString -> m (Maybe Value) -> m (Maybe Value)
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

argsToVals :: MonadSM m => CC.ArgList -> m ValList
argsToVals args = do
    vals <- traverse (getVar <=< expToVar) args
    pure $ case reverse vals of
      SVariadic vs : rest -> reverse rest ++ vs
      _ -> vals

-- | Get values from pre-computed Variables (avoids re-evaluating expressions)
argsToValsFromVars :: MonadSM m => [Variable] -> m ValList
argsToValsFromVars vars = do
    vals <- traverse getVar vars
    pure $ case reverse vals of
      SVariadic vs : rest -> reverse rest ++ vs
      _ -> vals


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
  --    revert("error message")

  --    revert customError(args);
  --    revert customError("error message")
  solidVMBreakpoint pos
  g <- getCurrentContract
  currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
  case mString of
    Just name -> do
      err <- case M.lookup name $ CC._errors g of
        Just _ -> do
          argVals <- mapM (getVar <=< expToVar) theArgs
          let listOfVals = mapMaybe (\x -> toBasic currentBlockNum x) argVals

          return $ customError "Reverting based on  Error Method:" name listOfVals
        Nothing -> do revertError "REVERT: to initial state" name
      pure $ err
    Nothing -> do
      argVals <- mapM (getVar <=< expToVar) theArgs
      let listOfVals = mapMaybe (\x -> toBasic currentBlockNum x) argVals
      return $ revertError "REVERT" listOfVals

-- Assignment to an index into an array or mapping
runStatement st@(CC.SimpleStatement (CC.ExpressionStatement ep@(CC.Binary _ "=" dst@(CC.IndexAccess _ parent (Just indExp)) src)) pos) = do
  solidVMBreakpoint pos
  srcVar <- expToVar src
  srcVal <- getVar srcVar

  cntrct <- getCurrentContract
  onTracedSM cntrct $ do
    valString <- showSM srcVal
    withSrcPos pos $ "    Setting: " ++ unparseExpression dst ++ " = " ++ valString

  pVar <- expToVar parent
  pVal <- weakGetVar pVar

  -- If it's an array, calling (expToVar dst) gives us
  -- the value at the index, NOT a reference that we can
  -- assign to....so we need to make a new vector and reset the whole array
  case pVal of
    SArray fs -> do
      indVal <- getVar =<< expToVar indExp
      case indVal of
        SInteger ind -> do
          when ((ind >= toInteger (V.length fs) || 0 > ind)) (invalidWrite "Cannot assign a value outside the allocated space for an array" (unparseStatement st))
          let newVec = fs V.// [(fromIntegral ind, srcVar)]
          setVar pVar (SArray newVec)
          return Nothing
        _ -> typeError ("array index value (" ++ (show indVal) ++ ") is not an integer") (unparseStatement st)
    SMap theMap -> do
      theIndex <- getVar =<< expToVar indExp
      let newMap = M.insert theIndex srcVar theMap
      setVar pVar (SMap newMap)
      return Nothing
    SBytes bs -> do
      indVal <- getVar =<< expToVar indExp
      case (indVal, srcVal) of
        (SInteger ind, SInteger val) -> do
          let ind' = fromIntegral ind
          when ((ind' >= B.length bs || 0 > ind')) (invalidWrite "Cannot assign a value outside the allocated space for a bytestring" (unparseExpression ep))
          let (pre', post) = B.splitAt ind' bs
              newVal = SBytes $ B.concat
                [ pre'
                , B.singleton . fromIntegral $ val .&. 0xff
                , maybe "" snd $ B.uncons post
                ]
          setVar pVar newVal
          pure Nothing
        (_, SInteger _) -> typeError ("bytestring index value (" ++ (show indVal) ++ ") is not an integer") (unparseExpression ep)
        _ -> typeError ("bytestring element cannot be set to a non-integer (" ++ (show srcVal) ++ ")") (unparseExpression ep)
    _ -> do
      -- If it's a mapping, (expToVar dst) IS a reference, so we can set directly to it
      dstVar <- expToVar dst
      setVar dstVar srcVal
      return Nothing
runStatement st@(CC.SimpleStatement (CC.ExpressionStatement (CC.Binary _ "=" (CC.IndexAccess _ _ Nothing) _)) pos) = do
  solidVMBreakpoint pos
  missingField "index value cannot be empty" (unparseStatement st)
runStatement (CC.SimpleStatement (CC.ExpressionStatement (CC.Binary _ "=" dst src)) pos) = do
  solidVMBreakpoint pos
  dstVar <- expToVar dst
  srcVal <- getVar =<< expToVar src

  setVar dstVar srcVal

  cntrct <- getCurrentContract
  onTracedSM cntrct $ do
    valString <- showSM srcVal
    withSrcPos pos $ "    Setting: " ++ unparseExpression dst ++ " = " ++ valString

  return Nothing

runStatement (CC.SimpleStatement (CC.ExpressionStatement e) pos) = do
  solidVMBreakpoint pos
  _ <- getVar =<< expToVar e
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
        rhs <- weakGetVar =<< expToVar e
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

  case (entries, value) of
    ([CC.VarDefEntry _ _ name _], _) -> addLocalVariable name value
    ([CC.BlankEntry], _) -> parseError "cannot declare single nameless variable" s
    (_, STuple variables) -> do
      checkArity "var declaration tuple" (V.length variables) (length entries)
      let nonBlanks = [(n, v) | (CC.VarDefEntry _ _ n _, v) <- zip entries $ V.toList variables]
      --We get the values first so in the case of (x,y) = (y,x) we can still set the variables to the correct values
      nonBlanks' <- forM nonBlanks $ \(n, v) -> do
        v' <- getVar v
        return (n, v')
      forM_ nonBlanks' $ \(name', v) -> do
        logAssigningVariable v
        addLocalVariable name' v
    _ -> typeError "VariableDefinition expected a tuple" $ show value

  return Nothing
runStatement (CC.SolidityTryCatchStatement tryExpression returnsDecl statementsForSuccess catchBlockMap pos) = do
  solidVMBreakpoint pos
  -- currentCallInfo <- getCurrentCallInfo

  mRes <- EUnsafe.try $ do
    expResultVal <- getVar =<< expToVar tryExpression
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
          vecOfVars <- case aRealVal of
            STuple vec -> pure vec
            v -> pure . V.singleton $ Constant v
          let vars = V.toList vecOfVars
          if length vars /= length returnsDecl
            then typeError "try/catch statement expected a tuple of the same length as the returns statement" $ show (tryExpression, aRealVal)
            else do
              forM_ (zip vars xs) $ \(var, (name, _)) -> do
                val <- getVar var
                addLocalVariable name val
              sfsRes' <- runStatementBlock statementsForSuccess
              return sfsRes'
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
  conditionResult <- getBool =<< expToVar condition

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

  while (getBool =<< expToVar condition) $! do
    onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
    result <- runStatementBlock code
    return result

runStatement (CC.DoWhileStatement code condition pos) = do
  solidVMBreakpoint pos
  doWhile (getBool =<< expToVar condition) $! do
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

  let condition = getBool =<< expToVar conditionExp

  while condition $! do
    onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
    result <- runStatementBlock code
    _ <- getVar =<< expToVar loopExp
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
      var <- expToVar e
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
  argVals <- mapM (getVar <=< expToVar) args
  currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
  let listOfVals = mapMaybe (\x -> toBasic currentBlockNum x) argVals
  customError "Custom user error thrown" name listOfVals
runStatement (CC.AssemblyStatement (CC.MloadAdd32 dst src) pos) = do
  solidVMBreakpoint pos
  srcVar <- expToVar (CC.Variable pos $ textToLabel src)
  dstVar <- expToVar (CC.Variable pos $ textToLabel dst)

  -- TODO(tim): should this hex encode src and pad?
  setVar dstVar =<< getVar srcVar
  return Nothing
runStatement st@(CC.EmitStatement eventName exptups pos) = do
  -- emit MemberAdded(<address>, <enode>);
  solidVMBreakpoint pos
  exps <- mapM (expToVar . snd) exptups
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
          -- pair up field names with values one-by-one (no type checking tho, lol)
          -- let pairs = zip (map (T.unpack . fst) $ CC._eventLogs ev) expStrs

          let evArgs = zipWith (\(CC.EventLog name _ (CC.IndexedType _ idxType _)) value ->
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
                "Contract: " ++ C.yellow (labelToString $ CC._contractName curCnct)
              ]

          bHash <- blockHeaderHash . Env.blockHeader <$> getEnv
          txSender <- Env.origin <$> getEnv
          let contractName' = labelToString $ CC._contractName curCnct
          addEvent $ Event bHash txSender contractName' address eventName evArgs
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

expToPath :: MonadSM m => CC.Expression -> m AddressPath
expToPath (CC.Variable _ x) = do
  callInfo <- getCurrentCallInfo
  let path = MS.singleton $ BC.pack $ labelToString x
  case x `M.lookup` NE.head (localVariables callInfo) of
    Just var -> do
      val <- weakGetVar var
      case val of
        SReference apt -> return apt
        _ -> typeError "expToPath should never be called for a local variable" ((show x) ++ " = " ++ show val)
    Nothing -> return $ AddressPath (currentAddress callInfo) path
expToPath x@(CC.IndexAccess _ parent mIndex) = do
  parPath <- do
    parvar <- expToVar parent
    case parvar of
      Constant (SReference apt) -> return apt
      _ -> expToPath parent

  idx <- getVar =<< maybe (typeError "empty index is only valid at type level" $ show x) expToVar mIndex
  currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
  -- Helium network ID = 114784819836269
  -- Blocks before 25000 on helium have TXs that relied on the buggy behavior, so preserve it there
  let isHeliumPreFork = computeNetworkID == 114784819836269 && currentBlockNum < 25000
  pure . apSnoc parPath $ case idx of
    SAddress a _ -> MS.Index . BC.pack $ show a
    SInteger i -> MS.Index . BC.pack $ show i
    SBool b -> MS.Index $ bool "false" "true" b
    SString s -> MS.Index . DT.encodeUtf8 $ T.pack s
    SBytes bs -> MS.Index bs  -- bytes32 keys in mappings
    SReference _
      | isHeliumPreFork -> typeError "invalid index" $ show idx  -- Preserve old buggy behavior for pre-fork blocks
      | otherwise -> MS.Index . BC.pack $ "0"  -- Uninitialized storage defaults to 0
    _ -> typeError "invalid index" $ show idx
expToPath (CC.MemberAccess _ parent field) = do
  apt <- do
    parvar <- expToVar parent
    case parvar of
      _ -> expToPath parent
  return . apSnoc apt . MS.Field $ BC.pack $ labelToString field
expToPath x = todo "expToPath/unhandled" x

expToVar :: MonadSM m => CC.Expression -> m Variable
expToVar x = do
  -- liftIO $ putStrLn $ C.cyan $ "expToVar: " ++ show x
  v <- expToVar' x
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

expToVar' :: MonadSM m => CC.Expression -> m Variable
expToVar' (CC.NumberLiteral _ v Nothing) = return . Constant $ SInteger v
expToVar' (CC.NumberLiteral _ v (Just nu)) =
  case nu of
    CC.Wei -> return . Constant $ SInteger v
    CC.Szabo -> return . Constant $ SInteger (v * (10 ^ (12 :: Integer)))
    CC.Finney -> return . Constant $ SInteger (v * (10 ^ (15 :: Integer)))
    CC.Ether -> return . Constant $ SInteger (v * (10 ^ (18 :: Integer)))
expToVar' (CC.StringLiteral _ s) = return $ Constant $ SString s
expToVar' (CC.DecimalLiteral _ v) = return $ Constant $ SDecimal $ CC.unwrapDecimal v
expToVar' (CC.AddressLiteral _ a) = return $ Constant $ SAddress a False
expToVar' (CC.BoolLiteral _ b) = return $ Constant $ SBool b
expToVar' (CC.HexaLiteral _ a) = return $ Constant $ SBytes $ either (parseError "Couldn't parse hexadecimal literal: ") id . B16.decode $ BC.pack a
expToVar' (CC.ObjectLiteral _ fields) = do
  -- Convert each field expression to a variable
  fieldVars <- mapM expToVar fields
  return $ Constant $ SStruct (stringToLabel "") fieldVars
expToVar' (CC.InlineBoundsCheck _ mL mU expr) = do
  var <- expToVar expr
  value <- getInt var
  when (fromMaybe False $ (value <) <$> mL) $ arithmeticException "underflow: " (mL, value)
  when (fromMaybe False $ (value >) <$> mU) $ arithmeticException "overflow: " (mU, value)
  pure var
expToVar' (CC.Variable _ "bytes32ToString") = return $ Constant $ SHexDecodeAndTrim
expToVar' (CC.Variable _ "addressToAsciiString") = return $ Constant SAddressToAscii
expToVar' (CC.Variable _ "now") = Constant . SInteger . round . utcTimeToPOSIXSeconds . BlockHeader.timestamp . Env.blockHeader <$> getEnv
expToVar' (CC.Variable _ name) = do
  var <- getVariableOfName name
  -- Handle deferred constants (complex expressions evaluated on access)
  case var of
    Constant (SDeferredConstant constName) -> do
      contract <- getCurrentContract
      (_, cc) <- getCurrentCodeCollection
      let constMap = cc ^. CC.flConstants
      case M.lookup constName $ (contract ^. CC.constants) `M.union` constMap of
        Just constDecl -> expToVar (constDecl ^. CC.constInitialVal)
        Nothing -> unknownConstant "deferred constant lookup" constName
    _ -> return var
expToVar' (CC.Unitary _ "-" e) = do
  var <- expToVar e
  value <- getRealNum var
  case value of
    Left v -> return $ Constant $ SInteger (v * (-1))
    Right v -> return $ Constant $ SDecimal $ v * (-1)
expToVar' (CC.PlusPlus _ e) = do
  var <- expToVar e
  value <- getInt var

  logAssigningVariable $ SInteger value
  setVar var $ SInteger $ value + 1
  return $ Constant $ SInteger value
expToVar' (CC.Unitary _ "++" e) = do
  var <- expToVar e
  value <- getInt var
  let next = SInteger $ value + 1
  logAssigningVariable next

  setVar var next
  return $ Constant next
expToVar' (CC.MinusMinus _ e) = do
  var <- expToVar e
  value <- getInt var
  logAssigningVariable $ SInteger value
  setVar var . SInteger $ value - 1
  return $ Constant $ SInteger value
expToVar' (CC.Unitary _ "--" e) = do
  var <- expToVar e
  value <- getInt var
  let next = SInteger $ value - 1
  logAssigningVariable next
  setVar var next
  return $ Constant next
expToVar' (CC.Binary _ "+=" lhs rhs) = addAndAssign lhs rhs
expToVar' (CC.Binary _ "-=" lhs rhs) = binopAssign' (-) (-) lhs rhs (\a b -> 1 + (max `on` byteWidth) a b)
expToVar' (CC.Binary _ "*=" lhs rhs) = binopAssign' (*) (*) lhs rhs ((+) `on` byteWidth)
expToVar' ex@(CC.Binary _ "/=" lhs rhs) = do
  rhs' <- getRealNum =<< expToVar rhs
  case rhs' of
    Left 0 -> divideByZero $ unparseExpression ex
    Right 0 -> divideByZero $ unparseExpression ex
    _ -> binopDivide (div) (/) lhs rhs
expToVar' ex@(CC.Binary _ "%=" lhs rhs) = do
  rhs' <- getRealNum =<< expToVar rhs
  case rhs' of
    Left 0 -> divideByZero $ unparseExpression ex
    Right 0 -> divideByZero $ unparseExpression ex
    _ -> binopAssign' rem decMod lhs rhs (const byteWidth)
expToVar' (CC.Binary _ "|=" lhs rhs) = binopAssign (.|.) lhs rhs (max `on` byteWidth)
expToVar' (CC.Binary _ "&=" lhs rhs) = binopAssign (.&.) lhs rhs (max `on` byteWidth)
expToVar' (CC.Binary _ "^=" lhs rhs) = binopAssign xor lhs rhs (max `on` byteWidth)
expToVar' (CC.Binary _ ">>=" lhs rhs) = do
  binopAssign (\x i -> x `shiftR` fromInteger i) lhs rhs (const . byteWidth)
expToVar' (CC.Binary _ "<<=" lhs rhs) = do
  binopAssign (\x i -> x `shiftL` fromInteger i) lhs rhs (\a b -> byteWidth a + b)
expToVar' (CC.Binary _ ">>>=" lhs rhs) = do
  binopAssign (\x i -> fromInteger (toInteger ((fromInteger x) :: Word256)) `shiftR` fromInteger i) lhs rhs (const . byteWidth)
expToVar' (CC.MemberAccess _ (CC.FunctionCall x (CC.Variable _ "type") [CC.Variable _ name]) "runTimeCode") = do
  (_, cc) <- getCurrentCodeCollection
  return $
    Constant $
      SString $ case M.lookup name $ cc ^. CC.contracts of -- (_contracts cc) of
        Just contract -> unparseContract contract
        _ -> getRunTimeCodeError "Failed to get contract runtime code " x
expToVar' (CC.MemberAccess _ (CC.Variable _ "Util") "bytes32ToString") = do
  return $ Constant $ SHexDecodeAndTrim
expToVar' (CC.MemberAccess _ (CC.Variable _ "Util") "b32") = do
  --TODO- remove this hardcoded case
  return $ Constant $ SFunction "identity" Nothing
expToVar' (CC.MemberAccess _ (CC.Variable _ "string") "concat") = do
  return $ Constant $ SStringConcat
expToVar' x@(CC.MemberAccess _ expr name) = do
  var <- expToVar expr
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
    (SBuiltinVariable "msg", "sender") -> (Constant . ((flip SAddress) False) . Env.sender) <$> getEnv
    (SBuiltinVariable "msg", "data") -> do
      contract' <- getCurrentContract
      functionName <- getCurrentFunctionName
      callInfo <- getCurrentCallInfo
      let argList = maybe [] CC._funcArgs $ contract' ^. CC.functions . at functionName
          localVars = NE.head $ localVariables callInfo
      argVals <- forM argList (\(n, _) -> getVar $ localVars M.! (fromMaybe "" n))
      return . Constant $ SVariadic argVals
    (SBuiltinVariable "msg", "sig") -> do
      functionName <- getCurrentFunctionName
      return . Constant $ SString functionName
    (SBuiltinVariable "tx", "origin") -> (Constant . ((flip SAddress) False) . Env.origin) <$> getEnv
    (SStruct _ theMap, fieldName) -> case M.lookup fieldName theMap of
      Nothing -> missingField "struct member access" fieldName
      Just v -> return v
    (SContractDef contractName', constName) -> do
      --TODO- move all variable name resolution by contract to a function
      (_, cc) <- getCurrentCodeCollection
      cont <- case M.lookup contractName' $ cc ^. CC.contracts of
        Nothing -> missingType "contract function lookup" contractName'
        Just ct -> pure ct
      case constName `M.lookup` CC._functions cont of
        Just _ -> return $ Constant . SFunction constName $ Just cont
        Nothing -> case constName `M.lookup` CC._constants cont of
          Nothing -> case constName `M.lookup` (cc ^. CC.flConstants) of
            Just (CC.ConstantDecl _ _ constExp _) -> expToVar constExp
            Nothing -> case constName `M.lookup` CC._structs cont of
              Just _ -> pure . Constant $ SStructDef constName
              Nothing -> case constName `M.lookup` CC._storageDefs cont of
                Just _ -> do
                  -- Storage variables from parent contracts are stored in the current contract
                  addr <- getCurrentAddress
                  return . Constant . SReference $ AddressPath addr (MS.singleton $ BC.pack $ labelToString constName)
                Nothing -> unknownConstant "member access" (labelToString contractName' ++ "." ++ labelToString constName)
          Just (CC.ConstantDecl _ _ constExp _) -> expToVar constExp
    (SBuiltinVariable "block", "proposer") -> do
      env' <- getEnv
      let acc = Env.proposer env'
      return $ Constant (flip SAddress False acc)
    (SBuiltinVariable "block", "timestamp") -> do
      env' <- getEnv
      let baseTimestamp = utcTimeToPOSIXSeconds $ BlockHeader.timestamp $ Env.blockHeader env'
      return $ Constant $ SInteger $ round baseTimestamp
    (SBuiltinVariable "block", "number") -> (Constant . SInteger . BlockHeader.number . Env.blockHeader) <$> getEnv
    (SBuiltinVariable "block", "coinbase") -> Constant . flip SAddress False . Env.proposer <$> getEnv
    (SBuiltinVariable "block", "difficulty") ->
      (Constant . SInteger . BlockHeader.difficulty . Env.blockHeader) <$> getEnv
    (SBuiltinVariable "block", "gaslimit") ->
      (Constant . SInteger . BlockHeader.gasLimit . Env.blockHeader) <$> getEnv
    (SBuiltinVariable "block", "chainid") ->
      return $ Constant $ SInteger computeNetworkID
    (SBuiltinVariable "super", method) -> do
      ctract <- getCurrentContract
      (_, cc) <- getCurrentCodeCollection
      let parents' = either (throw . fst) id $ CC.getParents cc ctract
      case filter (elem method . M.keys . CC._functions) parents' of
        [] -> typeError "cannot use super without a parent contract" $ show (method, ctract)
        (p:_) -> case M.lookup method $ CC._functions p of
          Nothing -> internalError (concat
            [ "Haskell has duped us - could not find "
            , method
            , " inside parent contract: "
            ]) (p ^. CC.functions)
          Just _ -> pure . Constant . SFunction method $ Just p
    (SAddress a _, n) -> evaluateAddressMember a False n
    (SContractItem a _, n) -> evaluateAddressMember a False n
    (SContract _ a, n) -> evaluateAddressMember a True n
    (r@(SReference _), "push") -> return $ Constant $ SPush r Nothing
    (a@(SArray _), "push") -> return $ Constant $ SPush a (Just var)
    (SNULL, "push") -> case var of
      Constant r -> pure . Constant $ SPush r Nothing
      _ -> pure . Constant $ SPush (SArray V.empty) (Just var)
    (SArray theVector, "length") -> return $ Constant $ SInteger $ fromIntegral $ V.length theVector
    (SString s, "length") -> return . Constant . SInteger . fromIntegral $ length s
    (SBytes bs, "length") -> return . Constant . SInteger . fromIntegral $ B.length bs
    (SNULL, "length") -> return . Constant $ SInteger 0
    (SReference p, itemName) -> return . Constant . SReference $ apSnoc p $ MS.Field $ BC.pack $ labelToString itemName
    ((SUserDefined alias notSure actualType), "wrap") -> return . Constant $ (SUserDefined alias notSure actualType) -- return $ Constant . SUserDefined alias val actualType
    m -> typeError ("illegal member access: " ++ (unparseExpression x)) ("parsed as " ++ show m ++ "with full exp" ++ show x)
expToVar' x@(CC.IndexAccess _ _ (Nothing)) = missingField "index value cannot be empty" (unparseExpression x)
-- TODO(tim): When this is a string constant, we can index into the string directly for SInteger
expToVar' x@(CC.IndexAccess _ parent (Just mIndex)) = do
  var <- expToVar parent

  case var of
    (Constant (SReference _)) -> Constant . SReference <$> expToPath x
    --    (Constant (SArray theVector)) -> do
    _ -> do
      theIndex <- getVar =<< expToVar mIndex
      val <- getVar var
      case (val, theIndex) of
        (SArray theVector, SInteger i) -> do
          if (fromIntegral i) >= length theVector
            then indexOutOfBounds ("index value was " ++ (show i) ++ ", but the array length was " ++ (show $ length theVector)) $ unparseExpression x
            else return $ theVector V.! fromIntegral i
        (SBytes bs, SInteger i) -> case bs B.!? fromIntegral i of
          Just w -> pure . Constant . SInteger $ fromIntegral w
          Nothing -> indexOutOfBounds ("index value was " ++ (show i) ++ ", but the bytes length was " ++ (show $ B.length bs)) $ unparseExpression x
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
            Just (SAddress _ p) -> pure $ Constant $ SAddress 0x0 p
            Just (SStruct n _) -> pure $ Constant $ SStruct n M.empty
            Just (SEnumVal t n _) -> pure $ Constant $ SEnumVal t n 0
            Just (SArray _) -> pure $ Constant $ SArray mempty
            Just (SContractItem _ n) -> pure $ Constant $ SContractItem 0x0 n
            Just (SMap _) -> pure $ Constant $ SMap M.empty
            _ -> internalError "Type of Mapping not allowed" theMap
        (SReference _, _) -> Constant . SReference <$> expToPath x
        _ -> typeError "unsupported types for index access" $ show (val, theIndex, unparseExpression x)
--    _ -> error $ "unknown case in expToVar' for IndexAccess: " ++ show var

expToVar' (CC.Binary _ "+" expr1 expr2) = expToVarAdd expr1 expr2
expToVar' (CC.Binary _ "-" expr1 expr2) = expToVarArith (-) (-) expr1 expr2 (\a b -> 1 + (max `on` byteWidth) a b)
expToVar' (CC.Binary _ "*" expr1 expr2) = expToVarArith (*) (*) expr1 expr2 ((+) `on` byteWidth)
expToVar' ex@(CC.Binary _ "/" expr1 expr2) = do
  rhs <- getRealNum =<< expToVar expr2
  case rhs of
    Left 0 -> divideByZero $ unparseExpression ex
    Right 0 -> divideByZero $ unparseExpression ex
    _ -> expToVarDivide (div) (/) expr1 expr2
--modified to use decimal division
expToVar' ex@(CC.Binary _ "%" expr1 expr2) = do
  rhs <- getRealNum =<< expToVar expr2
  case rhs of
    Left 0 -> divideByZero $ unparseExpression ex
    Right 0 -> divideByZero $ unparseExpression ex
    _ -> expToVarArith rem decMod expr1 expr2 (const byteWidth)
expToVar' (CC.Binary _ "|" expr1 expr2) = expToVarInteger expr1 (.|.) expr2 SInteger (max `on` byteWidth)
expToVar' (CC.Binary _ "&" expr1 expr2) = expToVarInteger expr1 (.&.) expr2 SInteger (max `on` byteWidth)
expToVar' (CC.Binary _ "^" expr1 expr2) = expToVarInteger expr1 xor expr2 SInteger (max `on` byteWidth)
expToVar' (CC.Binary _ "**" expr1 expr2) = expToVarInteger expr1 (^) expr2 SInteger (\a b -> byteWidth a * b)
expToVar' (CC.Binary _ "<<" expr1 expr2) = expToVarInteger expr1 (\x i -> x `shift` fromInteger i) expr2 SInteger (\a b -> byteWidth a + b)
expToVar' (CC.Binary _ ">>" expr1 expr2) = expToVarInteger expr1 (\x i -> x `shiftR` fromInteger i) expr2 SInteger (const . byteWidth)
expToVar' (CC.Binary _ ">>>" expr1 expr2) = expToVarInteger expr1 (\x i -> fromInteger (toInteger ((fromInteger x) :: Word256)) `shiftR` fromInteger i) expr2 SInteger (const . byteWidth)
expToVar' (CC.Unitary _ "!" expr) = do
  (Constant . SBool . not) <$> (getBool =<< expToVar expr)
expToVar' (CC.Unitary _ "delete" expr) = do
  p <- expToVar expr
  deleteVar p
  return $ Constant SNULL
expToVar' (CC.Binary _ "!=" expr1 expr2) = do
  --TODO- generalize all of these Binary operations to a single function
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  ctract <- getCurrentContract
  (_, cc) <- getCurrentCodeCollection
  onTraced $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  return . Constant . SBool . not $ valEquals ctract cc val1 val2
expToVar' (CC.Binary _ "==" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  ctract <- getCurrentContract
  (_, cc) <- getCurrentCodeCollection
  logVals val1 val2
  return . Constant . SBool $ valEquals ctract cc val1 val2
expToVar' (CC.Binary _ "<" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 < i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 < v2
    _ -> typeError "binary '<' on non-ints" $ show (val1, val2)
expToVar' (CC.Binary _ ">" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 > i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 > v2
    _ -> typeError "binary '>' on non-ints" $ show (val1, val2)
expToVar' (CC.Binary _ ">=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 >= i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 >= v2
    _ -> typeError "binary '>=' used on non-ints" $ show (val1, val2)
expToVar' (CC.Binary _ "<=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (defaultToInt val1, defaultToInt val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 <= i2
    (SDecimal v1, SDecimal v2) -> return $ Constant $ SBool $ v1 <= v2
    _ -> typeError "binary '<=' used on non-ints" $ show (val1, val2)
expToVar' (CC.Binary _ "&&" expr1 expr2) = do
  b1 <- getBool =<< expToVar expr1

  -- Only evaluate expr2 if b1 is True, otherwise return False
  if b1
    then do
      b2 <- getBool =<< expToVar expr2
      logVals b1 b2
      return $ Constant $ SBool b2
    else return $ Constant $ SBool False
expToVar' (CC.Binary _ "||" expr1 expr2) = do
  b1 <- getBool =<< expToVar expr1

  -- Only evaluate expr2 if b1 is False, otherwise return True
  if b1
    then return $ Constant $ SBool True
    else do
      b2 <- getBool =<< expToVar expr2
      logVals b1 b2
      return $ Constant $ SBool b2
expToVar' (CC.TupleExpression _ exps) = do
  -- Or should STuple be a Vector of Maybe?
  vars <- for exps $ maybe (return $ Constant SNULL) $ expToVar
  return $ Constant $ STuple $ V.fromList vars
expToVar' (CC.ArrayExpression _ exps) = do
  vars <- for exps expToVar
  --  return $ Constant $ SArray (error "array type from array literal not known") $ V.fromList vars
  return $ Constant $ SArray $ V.fromList vars
expToVar' (CC.Ternary _ condition expr1 expr2) = do
  c <- getBool =<< expToVar condition
  expToVar $ if c then expr1 else expr2
expToVar' (CC.FunctionCall _ (CC.NewExpression _ SVMType.Bytes {} _) args) = do
  case args of
    [a] -> do
      len <- getInt =<< expToVar a
      return . Constant . SBytes $ B.replicate (fromIntegral len) 0
    _ -> arityMismatch "newBytes" 1 (length args)
expToVar' (CC.FunctionCall _ (CC.NewExpression _ (SVMType.Array {SVMType.entry = t}) _) args) = do
  case args of
    [a] -> do
      len <- getInt =<< expToVar a
      ctract <- getCurrentContract
      cc <- snd <$> getCurrentCodeCollection
      v <- createDefaultValue cc ctract t
      Constant . SArray . V.fromList <$> traverse (const $ createVar v) [1..len]
    _ -> arityMismatch "new array" 1 (length args)
expToVar' (CC.FunctionCall _ (CC.NewExpression _ (SVMType.UnknownLabel contractName') Nothing) args) = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "Invalid contract creation during read-only access" $ "contractName: " ++ show contractName' ++ ", args: " ++ show args
  creator <- getCurrentAddress
  (hsh, cc) <- getCurrentCodeCollection
  newAddress <- getNewAddress creator
  argVals <- argsToVals args
  execResults <- create' creator newAddress hsh cc contractName' argVals
  return $
    Constant $
      SContract contractName' $
          fromMaybe (internalError "a call to create did not create an address" execResults) $
            erNewContractAddress execResults
expToVar' (CC.FunctionCall _ (CC.NewExpression _ (SVMType.UnknownLabel contractName') (Just saltExpression)) args) = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "Invalid contract creation during read-only access" $ "contractName: " ++ show contractName' ++ ", args: " ++ show args
  creator <- getCurrentAddress
  (hsh, cc) <- getCurrentCodeCollection
  salt <- getVar =<< expToVar saltExpression
  argVals <- argsToVals args
  newAddress <- getNewAddressWithSalt creator salt hsh (SString contractName' : argVals)
  $logDebugS "DEBUG" $ T.pack $ (show hsh) ++ "  " ++ show newAddress
  execResults <- create' creator newAddress hsh cc contractName' argVals
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
          fromMaybe (internalError "a call to create did not create an address" execResults) $
            erNewContractAddress execResults
-- Handle type cast function calls like uint256(x), int128(x), bytes32(x), etc.
expToVar' (CC.FunctionCall _ (CC.Variable _ name) args)
  | ("uint" `isPrefixOf` name && all isDigit (drop 4 name)) ||
    ("int" `isPrefixOf` name && all isDigit (drop 3 name)) ||
    ("bytes" `isPrefixOf` name && not (null (drop 5 name)) && all isDigit (drop 5 name)) = do
      argVals <- argsToVals args
      case name of
        "bytes32" -> do
          currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
          -- Helium network ID = 114784819836269
          -- Blocks before 31000 on helium have TXs that relied on the buggy behavior, so preserve it there
          let isHeliumPreFork = computeNetworkID == 114784819836269 && currentBlockNum < 31000
          if isHeliumPreFork
            then unknownVariable "getVariableOfName" ("bytes32" :: String)
            else Constant <$> callBuiltin name argVals
        _ -> Constant <$> callBuiltin name argVals

-- case to catch a using statement function like _x.add(3)

expToVar' (CC.FunctionCall _ e args) = do
      -- Evaluate args ONCE and keep both values and variables
      -- This avoids double-evaluation which could cause side effects
      argVarsRaw <- traverse expToVar args
      argVals <- argsToValsFromVars argVarsRaw
      -- Helium network ID = 114784819836269
      -- Pass-by-reference for memory arrays/structs is only enabled after fork block on helium
      -- Set to high value until network upgrade is coordinated
      currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
      let heliumPassByRefForkBlock = 33918 :: Integer
      let passByRefEnabled = not (computeNetworkID == 114784819836269 && currentBlockNum < heliumPassByRefForkBlock)
      let argVars = if passByRefEnabled then argVarsRaw else []
      case e of -- FunctionCall Special Case when calling a function via Member Access
        (CC.MemberAccess _ (CC.Variable _ "Util") _) -> regularFunctionCall e argVals argVars Nothing --Because of the hardcoded Util functions
        (CC.MemberAccess ctx' expr name) -> do
          var1 <- expToVar expr
          val1 <- getVar var1
          case (val1, name) of
            (SAddress addr _, "derive") -> do
              (_, hsh, _) <- getCodeAndCollection addr
              let (salt, args'') = case argVals of
                    (SString s:SString n:vs) -> (s,) . (SString n:) $ case reverse vs of
                      SVariadic v : rest -> reverse rest ++ v
                      _ -> vs
                    _ -> typeError "derive: first two arguments must be contract name and salt " $ show args
                  newAddress =
                    getNewAddressWithSalt_unsafe
                      addr
                      salt
                      (keccak256ToByteString hsh)
                      args''
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
              return . Constant $ SAddress newAddress False
            (SAddress toAddress _, "delegatecall") -> do
              let (funcName, args') = case argVals of
                    (SString fname : a) -> (fname, a)
                    _ -> typeError "delegate call needs first argument to be a string" $ show args
              fromAddress <- getCurrentAddress
              res <- callWithResult fromAddress toAddress CC.DelegateCall funcName args'
              case res of
                Just a -> return $ Constant a
                Nothing -> return $ Constant SNULL
            (SAddress toAddress _, "call") -> do
              let (funcName, args') = case argVals of
                    (SString fname : as) -> (fname, as)
                    _ -> typeError "call needs first argument to be a string" $ show args
              fromAddress <- getCurrentAddress
              res <- callWithResult fromAddress toAddress CC.RawCall funcName args'
              case res of
                -- TODO: call() should return (bool, variadic)... (Constant BBool , Constant a)
                Just a -> return $ Constant a
                Nothing -> return $ Constant SNULL
            (SAddress toAddress _, "staticcall") -> do
              let (funcName, args') = case argVals of
                    (SString fname : a) -> (fname, a)
                    _ -> typeError "staticcall needs first argument to be a string" $ show args
              fromAddress <- getCurrentAddress
              res <- withStaticCallInfo $ callWithResult fromAddress toAddress CC.RawCall funcName args'
              case res of
                Just a -> return $ Constant a
                Nothing -> return $ Constant SNULL
            (SAddress addr _, itemName) -> regularFunctionCall e argVals argVars $ Just (return $ Constant $ SContractItem addr itemName)
            (SDecimal v, "truncate") -> case argVals of
              (SInteger n:_) -> return . Constant $ SDecimal $ roundTo' truncate (fromInteger n) v
              _ -> invalidArguments ("truncate() called with non-integer value as argument") args
            (SContractDef _, _) -> regularFunctionCall e argVals argVars Nothing
            _ -> do
              ctrct <- getCurrentContract
              contracts <- CC._contracts . snd <$> getCurrentCodeCollection
              let usingContracts = mapMaybe
                    (flip M.lookup contracts . CC._usingContract)
                    (concat . M.elems $ ctrct ^. CC.usings)
              case mapMaybe (\y -> y <$ M.lookup name (y ^. CC.functions)) usingContracts of
                [] -> regularFunctionCall e argVals argVars Nothing
                c:_ -> regularFunctionCall
                  (CC.MemberAccess ctx' (CC.Variable ctx' $ c ^. CC.contractName) name)
                  (val1 : argVals) (var1 : argVars) Nothing
        _ -> regularFunctionCall e argVals argVars Nothing
      where
        regularFunctionCall :: MonadSM m => CC.Expression -> ValList -> [Variable] -> Maybe (m Variable) -> m Variable
        regularFunctionCall expr argVals argVars mSCI = do
          var <- case mSCI of
            Just sci -> sci
            Nothing -> expToVar' expr
          case var of
            Constant (SReference (AddressPath address (MS.StoragePath pieces))) -> do
              val' <- getVar $ Constant $ SReference $ AddressPath address $ MS.StoragePath $ init pieces
              case (val', last pieces) of
                (SContract _ toAddress, MS.Field funcName) -> do
                  fromAddress <- getCurrentAddress
                  res <- callWithResult fromAddress toAddress CC.DefaultCall (stringToLabel $ BC.unpack funcName) argVals
                  case res of
                    Just v -> return $ Constant $ v
                    Nothing -> return $ Constant SNULL
                (SAddress toAddress _, MS.Field funcName) -> do
                  fromAddress <- getCurrentAddress
                  res <- callWithResult fromAddress toAddress CC.DefaultCall (stringToLabel $ BC.unpack funcName) argVals
                  case res of
                    Just v -> return $ Constant $ v
                    Nothing -> return $ Constant SNULL
                x -> todo "expToVar'/FunctionCall" x
            Constant (SFunction name Nothing) -> Constant <$> callBuiltin name argVals
            Constant (SFunction funcName (Just contract')) -> do
              ro <- readOnly <$> getCurrentCallInfo
              address <- getCurrentAddress
              codeAddr <- getCurrentCodeAddress
              (hsh, cc) <- getCurrentCodeCollection
              -- Use runTheCallWithVars for internal calls to enable pass-by-reference for memory arrays/structs
              res <- case M.lookup funcName $ contract' ^. CC.functions of
                Just func -> if (CC._funcIsFree func)
                  then do
                    validateFunctionArguments func argVals >>= \case
                      Just (mo, argVals') -> runTheCallWithVars address codeAddr contract' funcName hsh cc mo argVals' argVars ro True
                      Nothing -> runTheCallWithVars address codeAddr contract' funcName hsh cc func argVals argVars ro True
                  else do
                    validateFunctionArguments func argVals >>= \case
                      Just (mo, argVals') -> runTheCallWithVars address codeAddr contract' funcName hsh cc mo argVals' argVars ro False
                      Nothing -> case M.lookup funcName $ cc ^. CC.flFuncs of
                        Just ff -> do
                          validateFunctionArguments ff argVals >>= \case
                            Just (mo, argVals') -> runTheCallWithVars address codeAddr contract' funcName hsh cc mo argVals' argVars ro True
                            Nothing -> runTheCallWithVars address codeAddr contract' funcName hsh cc func argVals argVars ro False
                        Nothing -> runTheCallWithVars address codeAddr contract' funcName hsh cc func argVals argVars ro False
                Nothing -> unknownFunction "regularFunctionCall/SFunction" funcName
              return . Constant . fromMaybe SNULL $ res
            Constant (SStructDef structName) -> do
              contract' <- getCurrentContract
              case M.lookup structName $ contract' ^. CC.structs of
                Just vals -> do
                  return . Constant . SStruct structName . fmap Constant . M.fromList $
                    zip (map (\(a, _, _) -> a) vals) argVals
                Nothing -> do
                  cc <- getCurrentCodeCollection
                  let !vals' = fromMaybe (missingType "struct constructor not found" structName) $ M.lookup structName $ (snd cc) ^. CC.flStructs
                  return . Constant . SStruct structName . fmap Constant . M.fromList $
                    zip (map (\(a, _, _) -> a) vals') argVals
            Constant (SContractDef contractName') -> do
              decrementGas 500
              case argVals of
                [SInteger address] ->
                  --TODO- clean up this ambiguity between SAddress and SInteger....
                  return $ Constant $ SContract contractName' $ fromInteger address
                [SAddress address _] ->
                  return $ Constant $ SContract contractName' address
                [SContract _ addr] ->
                  return $ Constant $ SContract contractName' $ addr
                _ -> typeError "contract variable creation" $ show argVals

            -- Transfer wei, throw error on failure no return on success
            -- TODO: When gas gets more implemented ensure that this function does not
            --       consume more than 2300 gas
            Constant (SContractItem address' "transfer") -> do
              from <- getCurrentAddress
              case argVals of
                [SInteger amount] -> do
                  res <- pay "built-in transfer function" from address' amount
                  case res of
                    True -> return $ Constant SNULL
                    _ -> do
                      balance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy :: A.Proxy AddressState) from
                      paymentError amount (show address', balance)
                _ -> typeError "transfer arguments" $ show argVals

            -- Send Wei return bool on failure or success
            -- TODO: When gas gets more implemented ensure that this function does not
            --       consume more than 2300 gas
            Constant (SContractItem address' "send") -> do
              from <- getCurrentAddress
              success <- case argVals of
                [SInteger amount] -> do
                  res <- pay "built-in send function" from address' amount
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
                [SString arguments] -> pure $ Just arguments
                -- Throw an error if too many arguments are passed
                as@(_:_:_) -> tooManyCooks 1 (length as)
                --If nothing was given or something else, then just return the entire code
                _ -> pure $ Nothing
              --get only the contract containing the sweet succulent ContractF definition
              (!contract, _, _) <- getCodeAndCollection toAccount
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
            Constant (SContractItem address itemName) -> do
              from <- getCurrentAddress
              result <- callWithResult from address CC.DefaultCall itemName argVals
              return . Constant . fromMaybe SNULL $ result
            Constant (SContractFunction address functionName) -> do
              from <- getCurrentAddress
              result <- callWithResult from address CC.DefaultCall functionName argVals
              return . Constant . fromMaybe SNULL $ result
            Constant (SEnum enumName) -> do
              case argVals of
                [SInteger i] -> do
                  c <- getCurrentContract
                  case M.lookup enumName $ c ^. CC.enums of
                    Just theEnum -> do
                      case fst theEnum !? fromInteger i of
                        Nothing -> typeError "enum val out of range" $ show argVals
                        Just enumVal -> pure . Constant . SEnumVal enumName enumVal $ fromInteger i
                    Nothing -> do
                      (_, cc) <- getCurrentCodeCollection
                      let !theEnum' =
                            fromMaybe (missingType "enum constructor" enumName) $
                              M.lookup enumName $ cc ^. CC.flEnums
                      case fst theEnum' !? fromInteger i of
                        Nothing -> typeError "enum val out of range" $ show argVals
                        Just enumVal -> pure . Constant . SEnumVal enumName enumVal $ fromInteger i
                _ -> typeError "called enum constructor with improper args" $ show argVals
            Constant (SPush theArray mvar) -> Builtins.push theArray mvar argVals
            Constant SStringConcat -> do
                  when
                    ( any
                        ( \x -> case x of
                            (SString _) -> False
                            _ -> True
                        )
                        argVals
                    )
                    $ typeError "string concat" $ show argVals
                  let strs = (\x -> case x of (SString s) -> s; _ -> "") <$> argVals
                  deductGasForOp . fromIntegral . sum $ length <$> strs
                  return $ Constant $ SString $ concat strs
            Constant SHexDecodeAndTrim ->
              case argVals of
                -- bytes should already be hex decoded when appropriate
                [s@SString {}] -> return $ Constant s
                _ -> typeError "bytes32ToString with incorrect arguments" $ show argVals
            Constant SAddressToAscii ->
              case argVals of
                [SAddress a _] -> return . Constant . SString $ show a
                _ -> typeError "addressToAsciiString with incorrect arguments" $ show argVals
            -- It would be nice to reinterpret two element paths as a function.
            -- How can we get a to resolve to a local variable instead of a path?
            -- StorageItem [Field a, Field b] -> todo "reinterpret as a function

            _ -> typeError "cannot call non-function" $ show var


expToVar' ep@(CC.Binary _ "=" dst@(CC.IndexAccess _ parent (Just indExp)) src) = do
  !srcVar <- expToVar src
  !srcVal <- getVar srcVar

  !pVar <- expToVar parent
  !pVal <- weakGetVar pVar
  -- If it's an array, calling (expToVar dst) gives us
  -- the value at the index, NOT a reference that we can
  -- assign to....so we need to make a new vector and reset the whole array
  case pVal of
    SArray fs -> do
      indVal <- getVar =<< expToVar indExp
      case indVal of
        SInteger ind -> do
          when ((ind >= toInteger (V.length fs) || 0 > ind)) (invalidWrite "Cannot assign a value outside the allocated space for an array" (unparseExpression ep))
          let newVec = fs V.// [(fromIntegral ind, srcVar)]
          setVar pVar (SArray newVec)
          return $ Constant $ SBool True
        _ -> typeError ("array index value (" ++ (show indVal) ++ ") is not an integer") (unparseExpression ep)
    SMap theMap -> do
      theIndex <- getVar =<< expToVar indExp
      let newMap = M.insert theIndex srcVar theMap
      setVar pVar (SMap newMap)
      return $ Constant $ SBool True
    SBytes bs -> do
      indVal <- getVar =<< expToVar indExp
      case (indVal, srcVal) of
        (SInteger ind, SInteger val) -> do
          let ind' = fromIntegral ind
          when ((ind' >= B.length bs || 0 > ind')) (invalidWrite "Cannot assign a value outside the allocated space for a bytestring" (unparseExpression ep))
          let (pre', post) = B.splitAt ind' bs
              newVal = SBytes $ B.concat
                [ pre'
                , B.singleton . fromIntegral $ val .&. 0xff
                , maybe "" snd $ B.uncons post
                ]
          setVar pVar newVal
          pure $ Constant srcVal
        (_, SInteger _) -> typeError ("bytestring index value (" ++ (show indVal) ++ ") is not an integer") (unparseExpression ep)
        _ -> typeError ("bytestring element cannot be set to a non-integer (" ++ (show srcVal) ++ ")") (unparseExpression ep)
    _ -> do
      -- If it's a mapping, (expToVar dst) IS a reference, so we can set directly to it
      dstVar <- expToVar dst
      setVar dstVar srcVal
      return $ Constant srcVal
expToVar' ep@(CC.Binary _ "=" (CC.IndexAccess _ _ Nothing) _) = do
  missingField "index value cannot be empty" (unparseExpression ep)
expToVar' (CC.Binary _ "=" dst src) = do
  srcVal <- getVar =<< expToVar src
  dstVar <- expToVar dst

  setVar dstVar srcVal

  return $ Constant srcVal
expToVar' x = todo "expToVar/unhandled" x

--------------

evaluateAddressMember ::
  MonadSM m =>
  Address ->
  Bool -> -- Is SContract
  SolidString ->
  m Variable
evaluateAddressMember a _ "codehash" = do
  -- Get the chainId for the account
  -- Retreive and resolve the codehash
  codeHash' <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) a
  case codeHash' of
    SolidVMCode _ ch' -> return (Constant $ SString . keccak256ToHex $ ch')
    cp -> missingCodeCollection "Address is not a SolidVM contract" (format cp)
--Get the whole code collection when nothing is supplied to the code function
evaluateAddressMember a _ "code" = do
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
evaluateAddressMember a _ "nonce" = do
  mAddrSt <- A.lookup (A.Proxy @AddressState) a
  case mAddrSt of
    Just as -> return $ Constant $ SInteger $ addressStateNonce as
    _ -> return $ Constant $ SInteger 0
evaluateAddressMember a _ "balance" = do
  bal <- A.lookup (A.Proxy @AddressState) a
  case bal of
    Just as -> return $ Constant $ SInteger $ addressStateBalance as
    _ -> return $ Constant $ SInteger 0
-- evaluateAddressMember a _ "call" =
evaluateAddressMember a True funcName = return $ Constant $ SContractFunction a funcName
evaluateAddressMember a False itemName = do
  --return $ Constant $ SContractItem addr itemName
  from <- getCurrentAddress
  result <- callWithResult from a CC.DefaultCall itemName []
  return . Constant . fromMaybe SNULL $ result

defaultToInt :: Value -> Value
defaultToInt SNULL        = SInteger 0
defaultToInt SReference{} = SInteger 0
defaultToInt x            = x

expToVarAdd :: MonadSM m => CC.Expression -> CC.Expression -> m Variable
expToVarAdd expr1 expr2 = do
  i1' <- getVar =<< expToVar expr1
  i2' <- getVar =<< expToVar expr2
  let addEm i1 i2 = case i1 of
        SInteger a -> case defaultToInt i2 of
          SInteger b -> do
            deductGasForOp $ 1 + (max `on` byteWidth) a b
            return . Constant . SInteger $ a + b
          SDecimal b -> do
            deductGasForOp $ 1 + fromIntegral (decimalPlaces b) + (max `on` byteWidth) a (decimalMantissa b)
            return . Constant . SDecimal $ (Decimal 0 a) + b
          _ -> typeError "expToVarAdd" $ show (i1, i2)
        SDecimal a -> case defaultToInt i2 of
          SInteger b -> do
            deductGasForOp $ 1 + fromIntegral (decimalPlaces a) + (max `on` byteWidth) (decimalMantissa a) b
            return . Constant . SDecimal $ a + (Decimal 0 b)
          SDecimal b -> do
            deductGasForOp $ 1 + fromIntegral ((max `on` decimalPlaces) a b) + (max `on` byteWidth) (decimalMantissa a) (decimalMantissa b)
            return . Constant . SDecimal $ a + b
          _ -> typeError "expToVarAdd" $ show (i1, i2)
        SString a -> case i2 of
          SString b -> do
            deductGasForOp . fromIntegral $ ((+) `on` length) a b
            return . Constant . SString $ a ++ b
          SNULL -> do
            deductGasForOp . fromIntegral $ length a
            return . Constant $ SString a
          SReference{} -> do
            deductGasForOp . fromIntegral $ length a
            return . Constant $ SString a
          _ -> typeError "expToVarAdd" $ show (i1, i2)
        SBytes a -> case i2 of
          SBytes b -> do
            deductGasForOp . fromIntegral $ ((+) `on` B.length) a b
            return . Constant . SBytes $ a <> b
          SNULL -> do
            deductGasForOp . fromIntegral $ B.length a
            return . Constant $ SBytes a
          SReference{} -> do
            deductGasForOp . fromIntegral $ B.length a
            return . Constant $ SBytes a
          _ -> typeError "expToVarAdd" $ show (i1, i2)
        SNULL -> case i2 of
          SNULL -> return $ Constant SNULL
          _ -> addEm i2 i1
        SReference ap1 -> case i2 of
          SReference ap2 -> if ap1 == ap2
                              then pure . Constant $ SReference ap1
                              else pure $ Constant SNULL
          _ -> addEm i2 i1
        _ -> typeError "expToVarAdd" $ show (i1, i2)
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
  (Integer -> Integer -> Integer) ->
  m Variable
expToVarArith intOp decOp expr1 expr2 gasFormula = do
  i1 <- getVar =<< expToVar expr1
  i2 <- getVar =<< expToVar expr2
  case (defaultToInt i1, defaultToInt i2) of
    (SInteger a, SInteger b) -> do
      deductGasForOp $ gasFormula a b
      return . Constant . SInteger $ a `intOp` b
    (SDecimal a, SDecimal b) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + (gasFormula `on` decimalMantissa) a b
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      deductGasForOp $ fromIntegral maxDecimalPlaces + gasFormula (decimalMantissa a) b
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + gasFormula a (decimalMantissa b)
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "expToVarArith" $ show (i1, i2)

expToVarDivide :: MonadSM m =>
  (Integer -> Integer -> Integer) ->
  (Decimal -> Decimal -> Decimal) ->
  CC.Expression ->
  CC.Expression ->
  m Variable
expToVarDivide intOp decOp expr1 expr2 = do
  i1 <- getVar =<< expToVar expr1
  i2 <- getVar =<< expToVar expr2
  case (defaultToInt i1, defaultToInt i2) of
    (SInteger a, SInteger b) -> do
      deductGasForOp $ byteWidth a
      return . Constant . SInteger $ a `intOp` b
    (SDecimal a, SDecimal b) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + (max `on` byteWidth) (decimalMantissa a) (decimalMantissa b)
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      deductGasForOp $ fromIntegral maxDecimalPlaces + byteWidth (decimalMantissa a)
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + byteWidth a
      return $ Constant $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "expToVarDivide" $ show (i1, i2)

byteWidth :: Integer -> Integer
byteWidth = go 0 . abs
  where go w 0 = w
        go w n = let !v = w + 32 in go v (n `shiftR` 256)

-- Deduct 1 gas for every 256 bits (32 bytes) used
deductGasForOp :: MonadSM m => Integer -> m ()
deductGasForOp numBytes = decrementGas . Gas $ 1 + (numBytes `shiftR` 5)

expToVarInteger :: MonadSM m => CC.Expression -> (Integer -> Integer -> a) -> CC.Expression -> (a -> Value) -> (Integer -> Integer -> Integer) -> m Variable
expToVarInteger expr1 o expr2 retType gasFormula = do
  i1 <- getInt =<< expToVar expr1
  i2 <- getInt =<< expToVar expr2
  deductGasForOp $ gasFormula i1 i2
  return . Constant . retType $ i1 `o` i2

binopAssign' :: MonadSM m =>
  (Integer -> Integer -> Integer) ->
  (Decimal -> Decimal -> Decimal) ->
  CC.Expression ->
  CC.Expression ->
  (Integer -> Integer -> Integer) ->
  m Variable
binopAssign' intOp decOp lhs rhs gasFormula = do
  let readVal e = getVar =<< expToVar e
  delta <- readVal rhs
  curValue <- readVal lhs
  varToAssign <- expToVar lhs
  next <- case (defaultToInt curValue, defaultToInt delta) of
    (SInteger c, SInteger d) -> do
      deductGasForOp $ gasFormula c d
      pure . SInteger $ c `intOp` d
    (SDecimal a, SDecimal b) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + gasFormula (decimalMantissa a) (decimalMantissa b)
      pure $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      deductGasForOp $ fromIntegral maxDecimalPlaces + gasFormula (decimalMantissa a) b
      return $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + gasFormula a (decimalMantissa b)
      return $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "binopAssign'" $ show (curValue, delta)
  setVar varToAssign next
  return $ Constant next

binopDivide :: MonadSM m =>
  (Integer -> Integer -> Integer) ->
  (Decimal -> Decimal -> Decimal) ->
  CC.Expression ->
  CC.Expression ->
  m Variable
binopDivide intOp decOp lhs rhs = do
  let readVal e = getVar =<< expToVar e
  delta <- readVal rhs
  curValue <- readVal lhs
  varToAssign <- expToVar lhs
  next <- case (defaultToInt curValue, defaultToInt delta) of
    (SInteger c, SInteger d) -> do
      deductGasForOp $ (max `on` byteWidth) c d
      pure . SInteger $ c `intOp` d
    (SDecimal a, SDecimal b) -> do
      let maxDecimalPlaces = max (decimalPlaces a) (decimalPlaces b)
          result = a `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + (max `on` byteWidth) (decimalMantissa a) (decimalMantissa b)
      return $ SDecimal $ roundTo maxDecimalPlaces result
    (SDecimal a, SInteger b) -> do
      let maxDecimalPlaces = decimalPlaces a
          result = a `decOp` (Decimal 0 b)
      deductGasForOp $ fromIntegral maxDecimalPlaces + (max `on` byteWidth) (decimalMantissa a) b
      return $ SDecimal $ roundTo maxDecimalPlaces result
    (SInteger a, SDecimal b) -> do
      let maxDecimalPlaces = decimalPlaces b
          result = (Decimal 0 a) `decOp` b
      deductGasForOp $ fromIntegral maxDecimalPlaces + (max `on` byteWidth) a (decimalMantissa b)
      return $ SDecimal $ roundTo maxDecimalPlaces result
    _ -> typeError "binopDivide'" $ show (curValue, delta)
  setVar varToAssign next
  return $ Constant next

addAndAssign :: MonadSM m => CC.Expression -> CC.Expression -> m Variable
addAndAssign lhs rhs = do
  let readVal e = getVar =<< expToVar e
  delta <- readVal rhs
  curValue <- readVal lhs
  varToAssign <- expToVar lhs
  next <- case (defaultToInt curValue, defaultToInt delta) of
    (SInteger c, SInteger d) -> do
      deductGasForOp $ 1 + (max `on` byteWidth) c d
      pure . SInteger $ c + d
    (SString c, SString d) -> do
      deductGasForOp . fromIntegral $ ((+) `on` length) c d
      pure . SString $ c ++ d
    (SDecimal c, SDecimal d) -> do
      deductGasForOp $ 1 + fromIntegral ((max `on` decimalPlaces) c d) + (max `on` byteWidth) (decimalMantissa c) (decimalMantissa d)
      pure . SDecimal $ c + d
    (SDecimal a, SInteger b) -> do
      deductGasForOp $ 1 + fromIntegral (decimalPlaces a) + (max `on` byteWidth) (decimalMantissa a) b
      pure . SDecimal $ a + (Decimal 0 b)
    (SInteger a, SDecimal b) -> do
      deductGasForOp $ 1 + fromIntegral (decimalPlaces b) + (max `on` byteWidth) a (decimalMantissa b)
      pure . SDecimal $ (Decimal 0 a) + b
    _ -> typeError "addAndAssign" $ show (curValue, delta)
  setVar varToAssign next
  return $ Constant next

binopAssign :: MonadSM m => (Integer -> Integer -> Integer) -> CC.Expression -> CC.Expression -> (Integer -> Integer -> Integer) -> m Variable
binopAssign oper lhs rhs gasFormula = do
  let readInt e = getInt =<< expToVar e
  delta <- readInt rhs
  curValue <- readInt lhs
  varToAssign <- expToVar lhs
  deductGasForOp $ gasFormula curValue delta
  let next = SInteger $ curValue `oper` delta
  setVar varToAssign next
  return $ Constant next

-- | Convert a value to an integer. Signedness and bit size are currently ignored;
-- we discourage fixed-size integer types in SolidVM but support this function for
-- backwards compatibility with existing Solidity contracts.
intBuiltin :: Bool -> Maybe Int -> [Value] -> Value
intBuiltin _ _ [SEnumVal _ _ enumNum] = SInteger $ fromIntegral enumNum
intBuiltin _ _ [SInteger n] = SInteger n
intBuiltin _ _ [SDecimal v] = SInteger (decimalMantissa $ roundTo 0 v)
intBuiltin _ _ [SString hex] = integerToValue $ parseBaseInt hex 16
intBuiltin _ _ [SString hex, SInteger 16] = integerToValue $ parseBaseInt hex 16
intBuiltin _ _ [SString dec, SInteger 10] = integerToValue $ parseBaseInt dec 10
intBuiltin _ _ [SBytes bs] = SInteger $ byteString2Integer bs  -- bytes32 -> uint256 cast
intBuiltin _ _ [SAddress a _] = SInteger $ fromIntegral $ unAddress a  -- address -> int cast
intBuiltin _ _ [SNULL] = SInteger 0
intBuiltin _ _ [SReference{}] = SInteger 0
intBuiltin signed mSize [] = typeError (funcName ++ " called with no arguments") ""
  where
    funcName = (if signed then "int" else "uint") ++ maybe "" show mSize
intBuiltin signed mSize (arg:_) = typeError (funcName ++ " cannot convert " ++ valueTypeName arg) $
  "expected integer, decimal, enum, string, bytes, or address; got " ++ format arg
  where
    funcName = (if signed then "int" else "uint") ++ maybe "" show mSize

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
decimalBuiltin [SReference{}] = SDecimal $ Decimal 0 0
decimalBuiltin args = typeError "decimal cast - invalid args" $ show args

parseBaseInt :: String -> Integer -> Either String Integer
parseBaseInt s n =
  case n of
    10 -> readEither s
    16 ->
      let s' = case s of
                 '0':'x':rest -> rest
                 _ -> s
          prefix' = bool "0" "" . even $ length s'
       in case B16.decode (BC.pack $ prefix' ++ s') of
            Right l -> Right $ byteString2Integer l
            _ -> Left $ "numeric cast - not a hex string " <> s
    _ -> Left $ "Cannot convert string " <> s <> " to base " <> show n

callBuiltin :: MonadSM m => SolidString -> [Value] -> m Value
callBuiltin "string" [SString s] = return $ SString s
callBuiltin "string" [SAddress a _] = return . SString $ show a
callBuiltin "string" [SInteger i] = return . SString $ show i
callBuiltin "string" [SInteger i, SInteger 10] = return . SString $ show i
callBuiltin "string" [SInteger i, SInteger 16] = return . SString $ "0x" ++ Numeric.showHex i ""
callBuiltin "string" [SInteger i, SInteger 16, SInteger bytes] = return . SString $ printf ("0x%0" ++ show (2*bytes) ++ "x") i
callBuiltin "string" [SBool b] = return . SString $ bool "false" "true" b
callBuiltin "string" [SBytes bs] = pure . SString $ case DT.decodeUtf8' bs of
  Left _ -> BC.unpack bs
  Right t -> T.unpack t
callBuiltin "string" [SBytes bs, SString "utf-8"] = pure . SString $ case DT.decodeUtf8' bs of
  Left _ -> malformedData "bytestring is not UTF-8 encoded" bs
  Right t -> T.unpack t
callBuiltin "string" [SBytes bs, SString "raw"] = pure . SString $ BC.unpack bs
callBuiltin "string" [SNULL] = return $ SString ""
callBuiltin "string" [SReference{}] = return $ SString ""
callBuiltin "string" vs = typeError "string cast" $ show vs
callBuiltin "address" [SInteger a] = return . ((flip SAddress) False) $ fromIntegral a
callBuiltin "address" [SAddress na b] = return $ SAddress na b
callBuiltin "address" [SContract _ a] = return $ SAddress a False
callBuiltin "address" [ss@(SString s)] =
  maybe
    (typeError "address cast" $ show ss)
    (return . flip SAddress False)
    $ readMaybe s
callBuiltin "address" [SBytes bs] = pure . flip SAddress False . Address . bytesToWord160 $ B.unpack bs
callBuiltin "address" [SNULL] = return $ SAddress 0 False
callBuiltin "address" [SReference{}] = return $ SAddress 0 False
callBuiltin "address" vs = typeError "address cast" $ show vs
callBuiltin ("addmod") [a', b', c'] = do
  (a,b,c) <- (,,) <$> int a' <*> int b' <*> int c'
  return . SInteger $ (a + b) `mod` c
callBuiltin ("mulmod") [a', b', c'] = do
  (a,b,c) <- (,,) <$> int a' <*> int b' <*> int c'
  return . SInteger $ (a * b) `mod` c
callBuiltin ("blockhash") [bNum] = do
  blockNum <- int bNum
  when (blockNum < 0) $ invalidArguments "blockhash() only accepts arguments greater than or equal to 0" [blockNum]
  env' <- getEnv
  let curBlock = Env.blockHeader env'
  maybeTheHash <- getBlockHashWithNumber blockNum (BlockHeader.parentHash curBlock)
  maybe (invalidArguments "the block number given does not exist" [blockNum]) (return . SString . BC.unpack . keccak256ToByteString) maybeTheHash
callBuiltin ("selfdestruct") [a'] = do
  a <- getAddressVal a'
  contract' <- getCurrentAddress
  contractBalance <- addressStateBalance <$> A.lookupWithDefault (A.Proxy @AddressState) contract'
  _destroyRes <- A.adjustWithDefault_ (A.Proxy @AddressState) contract' $ \newAddressState ->
    pure newAddressState {addressStateCodeHash = SolidVMCode "Code_0" $ unsafeCreateKeccak256FromWord256 0}
  sendRes <- pay "selfdestruct function" contract' a contractBalance
  _purgeRes <- purgeStorageMap contract'
  return $ SBool sendRes
callBuiltin "account" vs = typeError "account cast" $ show vs
callBuiltin "bool" [SBool b] = return $ SBool b
callBuiltin "bool" [SString "true"] = return $ SBool True
callBuiltin "bool" [SString "false"] = return $ SBool False
callBuiltin "bool" [SNULL] = return $ SBool False
callBuiltin "bool" [SReference _] = return $ SBool False
callBuiltin "bool" vs = typeError "bool cast" $ show vs
callBuiltin "byte" [SInteger n] = return $ SInteger (n .&. 0xff)
callBuiltin "byte" [SNULL] = return $ SInteger 0
callBuiltin "byte" [SReference _] = return $ SInteger 0
callBuiltin "byte" vs = typeError "byte cast" $ show vs
callBuiltin "bytes" [SInteger i] = pure . SBytes $ integer2Bytes i
callBuiltin "bytes" [SString s] = pure . SBytes . DT.encodeUtf8 $ T.pack s
callBuiltin "bytes" [SBytes bs] = pure $ SBytes bs
callBuiltin "bytes" [SString s, SString "utf-8"] = pure . SBytes . DT.encodeUtf8 $ T.pack s
callBuiltin "bytes" [SString s, SString "raw"] = pure . SBytes $ BC.pack s
callBuiltin "bytes" [SAddress a _] = pure . SBytes . B.pack . word160ToBytes $ unAddress a
callBuiltin "bytes" [SNULL] = pure $ SBytes B.empty
callBuiltin "bytes" [SReference _] = pure $ SBytes B.empty
callBuiltin "uint" args = return $ intBuiltin False Nothing args
callBuiltin "int" args = return $ intBuiltin True Nothing args
-- Handle sized integer type casts (uint256, uint128, uint120, int256, etc.)
callBuiltin name args
  | "uint" `isPrefixOf` name && all isDigit (drop 4 name) = return $ intBuiltin False (Just $ read $ drop 4 name) args
  | "int" `isPrefixOf` name && all isDigit (drop 3 name) = return $ intBuiltin True (Just $ read $ drop 3 name) args
-- Handle sized bytes type casts (bytes1, bytes2, ..., bytes32)
-- bytes32(integer) - convert to bytes representation, padded to correct size
callBuiltin name [SInteger i]
  | "bytes" `isPrefixOf` name && not (null (drop 5 name)) && all isDigit (drop 5 name) =
      let size = read (drop 5 name) :: Int
          sizeMask = (2 ^ (8 * size)) - 1
          maskedInt = i .&. sizeMask
          bytes = integer2Bytes maskedInt
          -- Pad with leading zeros to ensure correct size (e.g., bytes32 = 32 bytes)
          paddedBytes = B.replicate (size - B.length bytes) 0 <> bytes
      in return $ SBytes paddedBytes
callBuiltin name [SString s]
  | "bytes" `isPrefixOf` name && not (null (drop 5 name)) && all isDigit (drop 5 name) =
      -- Convert string to bytes representation
      return $ SBytes $ BC.pack s
callBuiltin "decimal" args = return $ decimalBuiltin args
callBuiltin "identity" [v] = return v
callBuiltin "log" args = SNULL <$ traverse (liftIO . putStrLn <=< showSM) args
callBuiltin "keccak256" [SBytes bs] = pure . SBytes . keccak256ToByteString $ hash bs
callBuiltin "keccak256" args = pure . SString . keccak256ToHex . hash . rlpSerialize $ rlpEncodeValues args
callBuiltin "ecrecover" [h', v', r', s'] = do
    bytestringHash <- getBytesVal h'
    v <- int v'
    rIntHash <- case r' of
      SInteger r -> pure r
      SString r -> case parseBaseInt r 16 of
        Right x -> return x
        _ -> invalidArguments "parseHex: error parsing r: " r
      _ -> invalidArguments "ecrecover: r must be a hex string or an integer" r'
    sIntHash <- case s' of
      SInteger s -> pure s
      SString s -> case parseBaseInt s 16 of
        Right y -> return y
        _ -> invalidArguments "parseHex: error parsing s: " s
      _ -> invalidArguments "ecrecover: s must be a hex string or an integer" s'
    let theSignerAddress = whoSignedThisTransactionEcrecover (unsafeCreateKeccak256FromByteString bytestringHash) rIntHash sIntHash v
    let theZero :: Integer
        theZero = 0
    case theSignerAddress of
      Nothing -> return . ((flip SAddress) False) $ fromIntegral theZero
      Just theAddress -> return . ((flip SAddress) False) $ theAddress
callBuiltin "verifyP256" (h' : r' : s' : p') = getBytesVal h' >>= \h -> case digestFromByteString @SHA256 h of
  Nothing -> invalidArguments "Could not decode hash from string" h
  Just digest -> do
    pub <- case p' of
      [x', y'] -> P256.pointFromIntegers <$> ((,) <$> int x' <*> int y')
      [pub'] -> do
        pubBS' <- case pub' of
          SBytes bs -> pure bs
          SString s -> case B16.decode $ DT.encodeUtf8 $ T.pack s of
            Left e -> invalidArguments "Could not decode public key from string: invalid hex" (s, e)
            Right b -> pure b
          _ -> invalidArguments "Could not decode public key: invalid value" pub'
        pubBS <- case B.length pubBS' of
          65 -> pure $ B.drop 1 pubBS'
          64 -> pure pubBS'
          _ -> invalidArguments "Could not decode public key from bytestring: invalid length" pubBS'
        case P256.pointFromBinary pubBS of
          CryptoPassed p -> pure p
          CryptoFailed e -> invalidArguments "Could not decode public key from bytestring" (pubBS', e)
      _ -> invalidArguments "Invalid arguments for P-256 public key" p'
    (r,s) <- (,) <$> int r' <*> int s'
    sig <- case signatureFromIntegers (Mod.Proxy @Curve_P256R1) (r, s) of
      CryptoPassed sig' -> pure sig'
      CryptoFailed e -> invalidArguments "Invalid P256 signature" e
    let !isValidSig = verifyDigest (Mod.Proxy @Curve_P256R1) pub sig digest
    pure $ SBool isValidSig
callBuiltin "sha256" [SBytes bs] = pure . SBytes $ SHA256.hash bs
callBuiltin "sha256" args = pure . SString . BC.unpack . B16.encode . SHA256.hash . rlpSerialize $ rlpEncodeValues args
callBuiltin "ripemd160" [SBytes bs] = pure . SBytes $ RIPEMD160.hash bs
callBuiltin "ripemd160" args = pure . SString . BC.unpack . B16.encode . RIPEMD160.hash . rlpSerialize $ rlpEncodeValues args
callBuiltin "modExp" [b, e, m] = SInteger <$> (Builtins.modExp <$> int b <*> int e <*> int m)
callBuiltin "ecAdd" [a, b, c, d] = do
  (x1, y1, x2, y2) <- (,,,) <$> int a <*> int b <*> int c <*> int d
  let (x, y) = Builtins.ecAdd (x1, y1) (x2, y2)
  pure . STuple . V.fromList $ Constant <$> [SInteger x, SInteger y]
callBuiltin "ecMul" [a, b, c] = do
  (x1, y1, s) <- (,,) <$> int a <*> int b <*> int c
  let (x, y) = Builtins.ecMul (x1, y1) s
  pure . STuple . V.fromList $ Constant <$> [SInteger x, SInteger y]
callBuiltin "ecPairing" [SVariadic xs] =
  SBool . Builtins.ecPairing <$> traverse int xs
callBuiltin "ecPairing" [SArray xs] =
  SBool . Builtins.ecPairing <$> traverse getInt (V.toList xs)
callBuiltin "ecPairing" xs = do
  SBool . Builtins.ecPairing <$> traverse int xs
callBuiltin "poseidon" [SVariadic xs] = case length xs of
  n | n > 0 && n <= 8 -> SInteger . Builtins.poseidonHash <$> traverse int xs
  _ -> typeError "invalid args passed to poseidon" $ show xs
callBuiltin "poseidon" [SArray xs] = case V.length xs of
  n | n > 0 && n <= 8 -> SInteger . Builtins.poseidonHash <$> traverse getInt (V.toList xs)
  _ -> typeError "invalid args passed to poseidon" $ show xs
callBuiltin "poseidon" xs = case length xs of
  n | n > 0 && n <= 8 -> SInteger . Builtins.poseidonHash <$> traverse int xs
  _ -> typeError "invalid args passed to poseidon" $ show xs
callBuiltin ("payable") [a] = flip SAddress True <$> getAddressVal a
callBuiltin "require" (condVar : msg) = do
  cond <- getBoolVal condVar
  case msg of
    [] -> require cond Nothing
    (SString s : _) -> require cond (Just s)
    (m : _) -> require cond (Just $ show m)
  return SNULL
callBuiltin "assert" [cond] = pure . const SNULL =<< assert =<< getBoolVal cond

callBuiltin "create" args@(cName : src : argVals) = do
  (contractName', contractSrc) <- (,) <$> getStringVal cName <*> getStringVal src
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
  addNewCodeCollection hsh cc
  newAddress <- getNewAddress creator
  execResults <- create' creator newAddress hsh cc contractName' argVals

  --Need to check that this is a UserRegistry contract before creating cirrus table!  Add this code

  case erNewContractAddress execResults of
    Just nca -> pure $ ((flip SAddress) False) nca
    Nothing -> internalError "a call to create did not create an address" execResults
callBuiltin "create2" args@(salt : n : src : argVals) = do
  (contractName', contractSrc) <- (,) <$> getStringVal n <*> getStringVal src
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
  addNewCodeCollection hsh cc
  newAddress <- getNewAddressWithSalt creator salt hsh $ n:argVals
  execResults <- create' creator newAddress hsh cc contractName' argVals
  case erNewContractAddress execResults of
    Just nca -> pure $ ((flip SAddress) False) nca
    Nothing -> internalError "a call to create did not create an address" execResults
callBuiltin "fastForward" [secs] = do
  seconds <- int secs
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

callBuiltin x args = unknownFunction (formatBuiltinError x args) x

-- Format a helpful error message for builtin function calls
formatBuiltinError :: String -> [Value] -> String
formatBuiltinError funcName args =
  "no matching overload for '" ++ funcName ++ "'\n" ++
  "  received: (" ++ intercalate ", " (map valueTypeName args) ++ ")\n" ++
  "  arguments:\n" ++ unlines (zipWith showArg [1..] args) ++
  "  hint: builtin functions expect concrete values, not References"
  where
    showArg :: Int -> Value -> String
    showArg n v = "    " ++ show n ++ ": " ++ format v

-- Format argument mismatch error message (uses showType from Typechecker)
formatArgMismatch :: [(Value, SVMType.Type)] -> String
formatArgMismatch pairs =
  unlines $ zipWith formatOne [1..] pairs
  where
    formatOne :: Int -> (Value, SVMType.Type) -> String
    formatOne n (val, expectedType) =
      "  Argument " ++ show n ++ ": got " ++ valueTypeName val ++ ", expected " ++ T.unpack (showType expectedType)

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

  zipped <- do
        let go [(SVMType.Variadic, n)] [SVariadic vs'] = do
              let var = Constant $ SVariadic vs'
              pure [(n, (SVMType.Variadic, var))]
            go [(SVMType.Variadic, n)] vs' = do
              let var = Constant $ SVariadic vs'
              pure [(n, (SVMType.Variadic, var))]
            go [] _ = pure []
            go _ [] = pure []
            go ((t,n):tns) (v:vs') = do
              let correctedVal = coerceType contract' cc t v
              var <- createVar correctedVal
              ((n,(t,var)):) <$> go tns vs'
        map (fmap snd) <$> go argTypeNames argVals

  void . withCallInfo to to contract' "constructor" hsh cc (M.fromList zipped) False False . pushSender from $ do

    forM_ [(n, e) | (n, CC.VariableDecl _ _ (Just e) _ _ _) <- M.toList $ contract' ^. CC.storageDefs] $ \(n, e) -> do
      v <- expToVar e
      setVar (Constant (SReference (AddressPath to $ MS.StoragePath [MS.Field $ BC.pack $ labelToString n]))) =<< getVar v

    forM_ [(n, theType) | (n, CC.VariableDecl theType _ Nothing _ _ _) <- M.toList $ contract' ^. CC.storageDefs] $ \(n, theType) -> do
      case theType of
        SVMType.Mapping _ _ _ -> return ()
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
        Just args'' -> do
          vals <- traverse (getVar <=< expToVar) args''
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
    userName <- getUsername
    addDelegatecall to to (Just userName) $ T.pack contractName'

  return ()

-- Note: this is intentionally nonstrict in `theType`
addLocalVariable :: MonadSM m => SolidString -> Value -> m ()
addLocalVariable name value = do
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
              M.insert name newVariable lvs
                NE.:| lvs'
          } :
        rest

runTheCall ::
  MonadSM m =>
  Address ->
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
runTheCall addr cAddr cont fName h coll func vals r f = 
  runTheCallWithVars addr cAddr cont fName h coll func vals [] r f

-- | Like runTheCall but accepts optional Variables for pass-by-reference semantics.
-- For memory arrays/structs, if a Variable is provided, it's used directly instead
-- of creating a new IORef wrapper. This allows modifications to propagate to caller.
runTheCallWithVars ::
  MonadSM m =>
  Address ->
  Address ->
  CC.Contract ->
  SolidString ->
  Keccak256 ->
  CC.CodeCollection ->
  CC.Func ->
  ValList ->
  [Variable] ->  -- Variables for pass-by-reference (may be shorter than ValList)
  Bool ->
  Bool ->
  m (Maybe Value)
runTheCallWithVars address' codeAddr contract' funcName hsh cc theFunction argVals' argVars ro ff = do
  let !returnNamesAndTypes = [(n, t) | (Just n, CC.IndexedType _ t _) <- CC._funcVals theFunction]
      !theModifierNames = map fst $ (CC._funcModifiers theFunction)
  !returns <- traverse (\(n, t) -> (n,) <$> createDefaultValue cc contract' t) returnNamesAndTypes

  theModifiers' <- forM theModifierNames $ \name -> do
    case M.lookup name (contract' ^. CC.modifiers) of
      Just theModifier -> do
        return $ Just theModifier
      Nothing -> if name `elem` contract' ^. CC.parents then return Nothing else missingField "modifier not found" name
  let !theModifiers = catMaybes theModifiers'

  argVals <- validateFunctionArguments theFunction argVals' >>= \case
    Just (_, av) -> pure av
    Nothing ->
      let mismatchInfo = formatArgMismatch $ zip argVals' (map (CC.indexedTypeType . snd) (CC._funcArgs theFunction))
      in typeError ("argument type mismatch in '" ++ funcName ++ "'") mismatchInfo

  -- Extract args with location info: (name, Maybe Location, value)
  let !argsWithLoc =
          let argMeta =
                map (\(n, CC.IndexedType _ t loc) -> (fromMaybe "" n, t, loc)) $
                  CC._funcArgs theFunction
              go [(n, SVMType.Variadic, _)] [SVariadic vs'] = [(n, Nothing, SVariadic vs')]
              go [(n, SVMType.Variadic, _)] vs' = [(n, Nothing, SVariadic vs')]
              go [] _ = []
              go _ [] = []
              go ((n,t,loc):nts) (v:vs') =
                let v' = coerceType contract' cc t v
                 in (n, loc, v') : go nts vs'
           in go argMeta argVals
  -- Build locals: (name, value) pairs for both args and returns
  let locals = [(n, v) | (n, _, v) <- argsWithLoc] ++ returns
  -- Build location map for args
  let argLocations = [(n, loc) | (n, loc, _) <- argsWithLoc]
  -- Zip args with provided Variables (padded with Nothing for missing entries)
  let argVarsPadded = map Just argVars ++ repeat Nothing
  -- Helium network ID = 114784819836269
  -- Pass-by-reference for memory arrays/structs is only enabled after fork block on helium
  -- Set to high value until network upgrade is coordinated
  currentBlockNum <- BlockHeader.number . Env.blockHeader <$> getEnv
  let heliumPassByRefForkBlock = 33918 :: Integer
  let passByRefEnabled = not (computeNetworkID == 114784819836269 && currentBlockNum < heliumPassByRefForkBlock)
  localVars1 <-
    forM (zip3 locals argVarsPadded (map snd argLocations ++ repeat Nothing)) $ \((n, v), mVar, mLoc) -> do
      newVar <- case mVar of
        -- For memory arrays/structs, use provided Variable (pass by reference)
        -- Only if: 1) fork is enabled, AND 2) location is Memory (or no location for backward compat)
        Just var | passByRefEnabled -> case (v, mLoc) of
          -- Explicitly marked as memory - pass by reference for arrays/structs
          (SArray _, Just CC.Memory) -> pure var
          (SStruct _ _, Just CC.Memory) -> pure var
          -- No location annotation - use type-based heuristic (backward compat after fork)
          (SArray _, Nothing) -> pure var
          (SStruct _ _, Nothing) -> pure var
          -- Explicitly marked as storage or calldata, or other types - pass by value
          _ -> liftIO $ fmap Variable $ newIORef v
        -- Pre-fork or no Variable provided, create new IORef (pass by value)
        _ -> liftIO $ fmap Variable $ newIORef v
      return (n, newVar)
  let args = [(n, v) | (n, _, v) <- argsWithLoc]

  val' <- withCallInfo address' codeAddr contract' funcName hsh cc (M.fromList localVars1) ro ff $ do -- [(n, (t, Constant v)) | (n, (t, v)) <- locals]
    matchedArgvals <- forM theModifiers $ \modi -> do
      let !margList =
              fromMaybe []
              $ M.lookup (T.unpack (CC._modifierSelector modi)) $ M.fromList $ CC._funcModifiers theFunction
      vs <- argsToVals margList
      let argMeta = fst <$> CC._modifierArgs modi
      return $ zip argMeta vs
    -- ++ (map (\(x,y) -> (T.unpack x, y)) (concat matchedArgvals)) --modArgsToBeLocals

    onTraced $ do
      liftIO $ putStrLn $ "            args: " ++ show (map fst args)
      when (not $ null returns) $ liftIO $ putStrLn $ "    named return: " ++ show (map fst returns)

    -- let myCombinerForEfficiency xs [] = return xs
    --     myCombinerForEfficiency xs ((n,(t,v)):ys) = do
    --       newVar <- liftIO $ fmap Variable $ newIORef v
    --       myCombinerForEfficiency ((n, (t, newVar)) : xs) ys

    forM_ (map (\(x, y) -> (T.unpack x, y)) (concat matchedArgvals)) $ \(n, v) -> do
      addLocalVariable n v

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
                Just returnVar -> Just <$> getVar returnVar
            xs ->
              Just . STuple . V.fromList <$> do
                currentCallInfo <- getCurrentCallInfo
                for (fst <$> xs) $ \name -> do
                  let mReturnVar = M.lookup name . NE.head $ localVariables currentCallInfo
                  case mReturnVar of
                    Nothing -> unknownVariable "findNamedReturns" name
                    Just returnVar -> Constant <$> getVar returnVar
    -- Check if library function should return a value but didn't
    -- Only error for libraries (to catch stub functions like Poseidon)
    -- Regular contracts may have legacy code that relied on SNULL behavior
    let isLibrary = CC._contractType contract' == CC.LibraryType
    let checkMissingReturn mVal = case mVal of
          Just v -> pure $ Just v
          Nothing -> if null (CC._funcVals theFunction) || not isLibrary
                     then pure Nothing  -- No return type, or not a library - allow old behavior
                     else typeError ("Library function '" ++ labelToString funcName ++ "' must return a value") 
                                    "library function has declared return type but no implementation"
    val' <- case val of
      Nothing -> findNamedReturns >>= checkMissingReturn
      Just SNULL -> findNamedReturns >>= checkMissingReturn
      Just {} -> pure val
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
encodeForReturn' (SAddress a _) = return $ "\"" ++ (show a) ++ "\""
encodeForReturn' (SContract _ a) = return $ "\"" ++ (show a) ++ "\""
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
                     . encodeForReturn' =<< getVar v
  encodedItems <- mapM (uncurry encodePair) $ M.toList vs
  pure $ "{" ++ intercalate "," encodedItems ++ "}"
encodeForReturn' SNULL = pure "0"
encodeForReturn' SReference{} = pure "0"
encodeForReturn' (SBytes bs) = return $ show $ B16.encode bs
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
        Just (varName, _) -> do
          addLocalVariable varName (SInteger errCode)
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
        Just (varName, _) -> do
          addLocalVariable varName (SInteger errCode)
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
        Just (varName, _) -> do
          addLocalVariable varName (SInteger errCode)
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
              Just (varName, _) -> do
                addLocalVariable varName (SString (fromMaybe "Require Error" s1))
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
            Just (varName, _) -> do
              addLocalVariable varName (SString "Assertion Error")
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
    (ArithmeticException s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 4 arithmeticException
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
    (RevertError s1 s2) -> do
      res <- solidityExceptionHandlerHelper catchBlockMap s1 s2 33 revertError
      return res
    (CustomError s1 s2 vals) -> do
      let name = T.unpack $ T.replace "\"" "" $ T.pack s2
      case M.lookup name catchBlockMap of
        Nothing -> solidityExceptionHandlerHelper'' catchBlockMap s1 name vals 34 customError
        Just (Nothing, _) -> solidityExceptionHandlerHelper'' catchBlockMap s1 name vals 34 customError
        Just (Just (name', _), block) -> do
          mapM_ (\x -> addLocalVariable name' x) $ map fromBasic vals
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
    (ArithmeticException s1 s2) ->
      case M.lookup "ArithmeticException" catchBlockMap of
        Nothing -> solidVMExceptionHelper catchBlockMap $ arithmeticException s1 s2
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
              then mapM (\(x, (_, z)) -> addLocalVariable x z) $ zip argsToSolidString zipped
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

-- checks if an argument list is valid for a given function signature
validateFunctionArguments:: MonadSM m => CC.Func -> ValList -> m (Maybe (CC.Func, ValList))
validateFunctionArguments func argVals = checkFunc $ func : CC._funcOverload func
  where
    checkFunc [] = pure Nothing
    checkFunc (x:xs) = testMatch x >>= \case
      Just argVals' -> pure $ Just (x, argVals')
      Nothing -> checkFunc xs
    argValsLength = length argVals
    testMatch :: MonadSM m => CC.Func -> m (Maybe ValList)
    testMatch tf = mapArgs tf >>= \case
      Nothing -> pure Nothing
      Just argMapping -> sequence <$> traverse marshalValue (snd <$> argMapping) >>= \case
        Just vals' -> pure $ Just vals'
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
        -- (SInteger i, SVMType.String _) -> pure . Just . SString $ show i
        (SInteger i, SVMType.Address b) -> pure . Just $ SAddress (fromInteger i) b
        (SInteger i, SVMType.UnknownLabel _) -> pure . Just $ SAddress (fromInteger i) False
        (SInteger i, SVMType.Decimal) -> pure . Just . SDecimal $ fromInteger i
        (SDecimal d, SVMType.Decimal) -> pure . Just $ SDecimal d
        (SString s, SVMType.String _) -> pure . Just $ SString s
        (SString s, SVMType.Bytes _ _) -> pure . Just $ SBytes $ DT.encodeUtf8 $ T.pack s
        (SBytes bs, SVMType.Bytes _ _) -> pure . Just $ SBytes bs
        -- (SString s, SVMType.Address b) -> pure $ flip SAddress b <$> stringAddress s
        (SBool b, SVMType.Bool) -> pure . Just $ SBool b
        (SAddress a _, SVMType.Address b) -> pure . Just $ SAddress a b
        -- (SAddress a _, SVMType.String _) -> pure . Just . SString $ show a
        (SAddress a _, SVMType.Int _ _) -> pure . Just . SInteger . fromIntegral $ unAddress a
        (SEnumVal r x y, SVMType.UnknownLabel u) -> pure . bool Nothing (Just $ SEnumVal r x y) $ r == u
        (SStruct r x, SVMType.UnknownLabel u) ->
          -- Allow anonymous structs (empty name) to match any struct type
          if r == stringToLabel "" || r == u
            then pure . Just $ SStruct u x
            else pure Nothing
        (SContract r x, SVMType.UnknownLabel u) -> pure . bool Nothing (Just $ SContract r x) $ r == u
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
        (r@(SReference _), _) -> pure $ Just r
        _ -> pure Nothing
    mapArgs :: MonadSM m => CC.FuncF a -> m (Maybe [(String, (SVMType.Type, Value))])
    mapArgs theFunc =
        let go [(n, SVMType.Variadic)] [SVariadic args] = pure $ Just [(n, (SVMType.Variadic, SVariadic args))]
            go [(n, SVMType.Variadic)] args = pure $ Just [(n, (SVMType.Variadic, SVariadic args))]
            go nts [SVariadic args] = go nts args
            go nts@(_:_:_) [SArray args] = go nts . V.toList =<< traverse getVar args
            go ((n,t):nts) (v:args) = (((n, (t, v)):) <$>) <$> go nts args
            go [] [] = pure $ Just []
            go _ _ = pure Nothing
            argMeta =
              map (\(n, CC.IndexedType _ t _) -> (fromMaybe "" n, t)) $
                CC._funcArgs theFunc
         in go argMeta argVals
