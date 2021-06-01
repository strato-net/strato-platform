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
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.SolidVM
  ( SolidVMBase
  , call
  , create
  ) where

import           Control.DeepSeq                      (force)
import           Control.Lens hiding (assign, from, to, Context)
import           Control.Applicative
import           Control.Monad
import           Control.Monad.Extra                  (fromMaybeM)
import qualified Control.Monad.Change.Alter           as A
import qualified Control.Monad.Change.Modify          as Mod
import           Control.Monad.IO.Class
import qualified Control.Monad.Catch                  as EUnsafe
import           Control.Monad.Trans.Maybe
import           Data.Bifunctor                       (bimap)
import           Data.Bits
import           Data.Bool                            (bool)
import           Data.ByteString                      (ByteString)
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Base16               as B16
import qualified Data.ByteString.Char8                as BC
import qualified Data.ByteString.Short                as BSS
import qualified Data.ByteString.UTF8                 as UTF8
import           Data.Either.Extra                    (eitherToMaybe)
import           Data.List
import qualified Data.Map                             as M
import qualified Data.Map.Merge.Lazy                  as M
import           Data.Maybe
import qualified Data.Sequence                        as Q
import qualified Data.Set                             as S
import qualified Data.Text                            as T
import qualified Data.Text.Encoding                   as TE
--import qualified Data.List                            as List
import           Data.Time.Clock.POSIX
import           Data.Traversable
import qualified Data.Vector as V
import           Debugger
import           GHC.Exts                             hiding (breakpoint)
import           Text.Parsec                          (runParser)
import           Text.Printf
import           Text.Read (readMaybe)

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import qualified Blockchain.Database.MerklePatricia   as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.ModifyStateDB          (pay)
import           Blockchain.DB.X509CertDB
import           Blockchain.DB.AddressStateDB
import           Blockchain.ExtWord
import qualified Blockchain.SolidVM.Builtins          as Builtins
import           Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.SolidVM.Environment       as Env
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.Metrics
import           Blockchain.SolidVM.SetGet
import           Blockchain.SolidVM.TraceTools
import           Blockchain.SolidVM.Value
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Action
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Event
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.VMContext
import           Blockchain.VMOptions
import           Blockchain.SolidVM.SM
import qualified Text.Colors                          as C
import           Text.Format
import           Text.Tools

import qualified SolidVM.Model.Storable as MS

import           SolidVM.Solidity.Parse.Statement
import           SolidVM.Solidity.Parse.UnParser (unparseStatement, unparseExpression)
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Statement as Xabi
import qualified SolidVM.Solidity.Xabi.Type as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

import           UnliftIO                             hiding (assert)

import           CodeCollection

type SolidVMBase m = VMBase m

onTraced :: Monad m => m () -> m ()
onTraced = when flags_svmTrace

withSrcPos :: MonadIO m => Xabi.SourcePos -> String -> m ()
withSrcPos pos str = liftIO . putStrLn $ concat 
  [ show pos
  , ": "
  , str
  ]

-- TODO: I'm putting all of these instances related to debugging here,
--       but they should really go in SM.hs
--       However, the functions needed to run `variableSet` and `runExpr`,
--       which are critical for debugging, are defined in SetGet.hs and
--       SolidVM.hs. I think this suggests a reorganization of the
--       solid-vm package should be done, but I don't want to interfere
--       with it too much just to get the debugger working.

variableSet :: MonadSM m => m VariableSet
variableSet = do
  cis <- Mod.get (Mod.Proxy @[CallInfo])
  let textSet = S.fromList . map T.pack . M.keys
      varNames = case cis of
        [] -> S.empty
        (ci:_) -> textSet $ localVariables ci
      locals = M.singleton "Local Variables" varNames
  acct <- getCurrentAccount
  ~(contract, _, _) <- getCodeAndCollection acct
  let stateVars = textSet $ contract ^. storageDefs
      globals = M.singleton "State Variables" stateVars
  pure . VariableSet $ locals <> globals

instance MonadSM m => Mod.Accessible VariableSet m where
  access _ = variableSet

instance MonadSM m => Mod.Accessible [SourcePos] m where
  access _ = do
    cis <- Mod.get (Mod.Proxy @[CallInfo])
    pure $ fromMaybe (initialPos "") . currentSourcePos <$> cis

runExpr :: MonadSM m => EvaluationRequest -> m EvaluationResponse
runExpr exprText = withoutDebugging . withTempCallInfo True $ do -- TODO: allow write access once we figure out how to discard changes
  let eExpr = runParser expression "" "" (T.unpack exprText)
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

solidVMBreakpoint :: MonadSM m => SourcePos -> m ()
solidVMBreakpoint pos = do
  Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
    [] -> pure []
    (ci:cis) -> pure $ ci{currentSourcePos = Just pos}:cis
  breakpoint runExpr

-- end debugger-related code

create :: SolidVMBase m
       => Bool
       -> Bool
       -> S.Set Account
       -> BlockData
       -> Int
       -> Account
       -> Account
       -> Integer
       -> Integer
       -> Gas
       -> Account
       -> Code
       -> Keccak256
       -> Maybe Word256
       -> Maybe (M.Map T.Text T.Text)
       -> m ExecResults
--create isRunningTests' isHomestead preExistingSuicideList b callDepth sender origin
--       value gasPrice availableGas newAddress initCode txHash chainId metadata =
create _ _ _ blockData _ sender' origin' _ _ _ newAddress code txHash' chainId' metadata = do
  x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
  recordCreate
  let env' = Env.Environment {
        Env.blockHeader = blockData,
        Env.sender = sender',
        Env.origin = origin',
        Env.txHash=txHash',
        Env.chainId=chainId',
        Env.metadata=metadata
      }

  initCode <- case code of
    Code c -> pure c
    PtrToCode cp -> do
      hsh <- codePtrToSHA chainId' cp
      fromMaybe "" . fmap snd . join <$> traverse getCode hsh
  
  fmap (either solidvmErrorResults id) . runSM (Just initCode) env' $ do
    let maybeContractName = M.lookup "name" =<< metadata
        !contractName' = T.unpack $ fromMaybe (missingField "TX is missing a metadata parameter called 'name'" $ show metadata) maybeContractName

    let maybeArgString = M.lookup "args" =<< metadata
        argString = maybe "()" T.unpack maybeArgString
        maybeArgs = runParser parseArgs "" "" argString
        !args = either (parseError "create arguments") Xabi.OrderedArgs maybeArgs

    (hsh, cc) <- codeCollectionFromSource initCode
    create' sender' newAddress hsh cc contractName' args x509s

create' :: MonadSM m => Account -> Account -> Keccak256 -> CodeCollection -> String -> Xabi.ArgList -> M.Map Address X509Certificate -> m ExecResults
create' creator newAccount ch cc contractName' argExps x509s = do
  Mod.put (Mod.Proxy @(M.Map Address X509Certificate)) $ x509s
  parentName <- fromMaybeM (return "") $ runMaybeT 
     $   pure creator                                               -- Creator's address
     >>= MaybeT . getAddressStateMaybe                              -- Address's state
     >>= pure  .  addressStateCodeHash                              -- state's codehash/CodePtr
     >>= MaybeT . resolveCodePtrParent (creator ^. accountChainId)  -- CodePtr's parent
     >>= (\case     
            SolidVMCode name _ -> pure name                         -- Name of the parent
            _                  -> pure "")

  initializeActionCreate creator newAccount contractName' parentName ch

  A.adjustWithDefault_ (A.Proxy @AddressState) newAccount $ \newAddressState ->
    pure newAddressState{ addressStateContractRoot = MP.emptyTriePtr
                        , addressStateCodeHash = if (contractName' /= parentName && not (null parentName)) then CodeAtAccount creator contractName' else SolidVMCode contractName' ch
                        }

  onTraced $ liftIO $ putStrLn $ C.red $ "Creating Contract: " ++ show newAccount ++ " of type " ++ contractName'

  let !contract' = fromMaybe (missingType "create'/contract" contractName') (cc ^. contracts . at contractName')

  -- Add Storage

  addCallInfo newAccount contract' (contractName' ++ " constructor") ch cc M.empty False

  popCallInfo

  -- Run the constructor
  runTheConstructors creator newAccount ch cc contractName' argExps

  onTraced $ liftIO $ putStrLn $ C.red $ "Done Creating Contract: " ++ show newAccount ++ " of type " ++ contractName'

  finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
  x509s' <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))


  -- make sure the org is updated
  maybeCertLevelDB <- x509CertDBGet $ _accountAddress creator
  let maybeCertBlockDB = M.lookup (_accountAddress creator) x509s'
      maybeCert = maybeCertBlockDB <|> maybeCertLevelDB
      org = T.pack . fromMaybe "" . fmap subOrg $ getCertSubject =<< maybeCert

  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    actionData %= M.adjust (actionDataOrganization .~ org) newAccount

  case maybeCert of
      Just c  -> Mod.put (Mod.Proxy @(M.Map Address X509Certificate)) $ M.insert (_accountAddress newAccount) c x509s'
      Nothing -> pure ()

  x509s'' <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
  finalAct <- Mod.get (Mod.Proxy @Action)

  return ExecResults {
    erRemainingTxGas = 0, --Just use up all the allocated gas for now....
    erRefund = 0,
    erReturnVal = Just BSS.empty,
    erTrace = [],
    erLogs = [],
    erEvents = toList finalEvs,
    erNewContractAccount = Just newAccount,
    erSuicideList = S.empty,
    erAction = Just finalAct,
    erException = Nothing,
    erKind = SolidVM,
    erNewX509Certs = x509s''
    }

{-
initializeStorage :: AddressedPath -> Value -> SM ()
initializeStorage root value = do
  case value of
     SArray _ iv -> do
       setVar (root `apSnoc` MS.Field "length") . SInteger . fromIntegral $ V.length iv
       V.imapM_ (\i v -> case v of
        Constant c -> initializeStorage (root `apSnoc` MS.ArrayIndex i) c
        _ -> todo "nonconstant vector init" (root, value)) iv
     SMap _ im -> if M.null im then setVar root SMappingSentinel
                               else todo "initialize map storage " value
     -- References are already initialized
     SReference{} -> return ()
     x -> setVar root x
-}

call :: SolidVMBase m
     => Bool
     -> Bool
     -> Bool
     -> S.Set Account
     -> BlockData
     -> Int
     -> Account
     -> Account
     -> Account
     -> Word256
     -> Word256
     -> B.ByteString
     -> Gas
     -> Account
     -> Keccak256
     -> Maybe Word256
     -> Maybe (M.Map T.Text T.Text)
     -> m ExecResults
--call isRunningTests' isHomestead noValueTransfer preExistingSuicideList b callDepth receiveAddress
--     (Address codeAddress) sender value gasPrice theData availableGas origin txHash chainId metadata =

call _ _ _ _ blockData _ _ codeAddress sender' _ _ _ _ origin' txHash' chainId' metadata = do
  recordCall

  let env' = Env.Environment {
        Env.blockHeader = blockData,
        Env.sender = sender',
        Env.origin = origin',
        Env.txHash=txHash',
        Env.chainId=chainId',
        Env.metadata=metadata
        }

  fmap (either solidvmErrorResults id) . runSM Nothing env' $ do
    let maybeFuncName = M.lookup "funcName" =<< metadata
        !funcName = T.unpack $ fromMaybe (missingField "TX is missing a metadata parameter called 'funcName'" $ show metadata) maybeFuncName
        maybeArgString = M.lookup "args" =<< metadata
        !argString = T.unpack $ fromMaybe (missingField "TX is missing metadata parameter called 'args'" $ show metadata) maybeArgString
        maybeArgs = runParser parseArgs "" "" argString
        !args = either (parseError "call arguments") Xabi.OrderedArgs maybeArgs

    returnVal <- mapM encodeForReturn =<< callWrapper sender' codeAddress Nothing funcName args

    finalAct <- Mod.get (Mod.Proxy @Action)
    finalEvs <- Mod.get (Mod.Proxy @(Q.Seq Event))
    x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))

    return $ ExecResults {
      erRemainingTxGas = 0, --Just use up all the allocated gas for now....
      erRefund = 0,
      erReturnVal = BSS.toShort <$> returnVal,
      erTrace = [],
      erLogs = [],
      erEvents = toList finalEvs,
      erNewContractAccount = Nothing,
      erSuicideList = S.empty,
      erAction = Just $ finalAct,
      erException = Nothing,
      erKind = SolidVM,
      erNewX509Certs = x509s
      }


getCodeAndCollection :: MonadSM m => Account -> m (Contract, Keccak256, CodeCollection)
getCodeAndCollection address' = do
  callStack' <- Mod.get (Mod.Proxy @[CallInfo])
  let maybeAddress =
        case callStack' of
          (current':_) -> Just $ currentAccount current'
          _ -> Nothing

  onTraced $ liftIO $ putStrLn $ "----------------- caller address: " ++ fromMaybe "Nothing" (fmap format maybeAddress)
  onTraced $ liftIO $ putStrLn $ "----------------- callee address: " ++ format address'
  if Just address' == maybeAddress
    then do
    c' <- getCurrentContract
    (hsh, cc') <- getCurrentCodeCollection
    return (c', hsh, cc')
    else do
    codeHash <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) address'

    resolvedCodeHash <- resolveCodePtr (address' ^. accountChainId) codeHash
    (contractName', ch, cc) <-
      case resolvedCodeHash of
        Just (SolidVMCode cn ch') -> do
          cc' <- codeCollectionFromHash ch'
          return (cn, ch', cc')
        Just ch -> internalError "SolidVM for non-solidvm code" (format ch)
        Nothing -> missingCodeCollection "SolidVM for non-existent code" (format codeHash)


    let !contract' = fromMaybe (missingType "getCodeAndCollection" contractName') $ M.lookup contractName' $ cc^.contracts

    return (contract', ch, cc)

logFunctionCall :: MonadSM m => ValList -> Account -> Contract -> String -> m (Maybe Value) -> m (Maybe Value)
logFunctionCall args address contract functionName f = do
  onTraced $ do
    argStrings <-
      case args of
        OrderedVals argList -> fmap (intercalate ", ") $ forM argList showSM
        NamedVals argMap ->
          fmap (intercalate ", ") $
          forM argMap $ \(n, v) -> do
            valString <- showSM v
            return $ n ++ ": " ++ valString

    let shownFunc = functionName ++ "(" ++ argStrings ++ ")"
    liftIO $ putStrLn $ box $ concat $ map (wrap 150)
      ["calling function: " ++ format address, (contract^.contractName) ++ "/" ++ shownFunc]

  result <- f

  onTraced $ do
    resultString <- maybe (return "()") showSM result
    liftIO $ putStrLn $ box ["returning from " ++ functionName ++ ":", resultString]


  return result


argsToVals :: MonadSM m => Contract -> Xabi.Func -> Xabi.ArgList -> m ValList
argsToVals ctract fn args =
  case args of
    Xabi.OrderedArgs xs -> do
      when (length xs /= length orderedTypes) $ invalidArguments "arity mismatch" (xs, orderedTypes)
      OrderedVals <$> zipWithM eval orderedTypes xs
    Xabi.NamedArgs xs -> NamedVals . M.toList <$> do
      let strTypes = M.mapKeys (T.unpack . fromMaybe "") $ M.fromList $ Xabi.funcArgs fn
      M.mergeA (M.mapMissing $ curry $ invalidArguments "missing argument")
               (M.mapMissing $ curry $ invalidArguments "extra argument")
               (M.zipWithAMatched $ \_k t x -> eval (Xabi.indexedTypeType t) x)
               strTypes
               $ M.fromList xs

  where orderedTypes :: [Xabi.Type]
        orderedTypes = map Xabi.indexedTypeType
                     . map snd $ Xabi.funcArgs fn

        eval :: MonadSM m => Xabi.Type -> Xabi.Expression -> m Value
        eval t x = case x of
           Xabi.NumberLiteral n Nothing -> return . coerceType ctract t $ SInteger n
           Xabi.NumberLiteral n (Just nu) -> todo "Number literal with units" (n, nu)
           Xabi.BoolLiteral b -> return . coerceType ctract t $ SBool b
           Xabi.StringLiteral s -> return . coerceType ctract t $ SString s
           Xabi.ArrayExpression as -> case t of
              Xabi.Array{Xabi.entry=t'} ->
                SArray t . V.fromList <$> mapM (fmap Constant . eval t') as
              _ -> typeError "array literal for non array" (t, x)
           -- This is something of a hack, where if an incoming value is not one
           -- of the accepted literals, assume that this is not the context of
           -- evaluating external arguments.
           _ -> getVar =<< expToVar x


callWrapper :: MonadSM m => Account -> Account -> Maybe String -> String -> Xabi.ArgList -> m (Maybe Value)
callWrapper from to mContract functionName argExps = do
  let fromChain = from ^. accountChainId
      toChain = to ^. accountChainId
  isAccessibleChain <- toChain `isAncestorChainOf` fromChain
  unless isAccessibleChain $ inaccessibleChain "Inaccessible chain violation" $ "from: " ++ show from ++ ", to: " ++ show to

  (contract', hsh, cc) <- getCodeAndCollection to
  parentName <- fromMaybeM (return "") $ runMaybeT 
     $   pure to                                                -- Contract's address
     >>= MaybeT . getAddressStateMaybe                          -- Address's state
     >>= pure  .  addressStateCodeHash                          -- state's codehash/CodePtr
     >>= MaybeT . resolveCodePtrParent (to ^. accountChainId)   -- CodePtr's parent
     >>= (\case     
            SolidVMCode name _ -> pure name                     -- Name of the parent
            _                  -> pure "")

  let contract = fromMaybe contract' $ mContract >>= \c -> M.lookup c $ _contracts cc
      parentName' = if parentName == (_contractName contract) then "" else parentName
  initializeActionCall to (_contractName contract) parentName' hsh

  let functionsIncludingConstructor =
        case contract^.constructor of
          Nothing -> contract^.functions
          Just c -> M.insert "<constructor>" c $ contract^.functions

  (f, args) <-
        case M.lookup functionName functionsIncludingConstructor of
          Just theFunction -> do
            args' <- argsToVals contract' theFunction argExps
            mCallInfo <- getCurrentCallInfoIfExists
            let ro = case mCallInfo of
                       Nothing -> False
                       Just ci -> if fromChain == toChain then readOnly ci else True
            let f' = (if from == to then id else pushSender from) $ runTheCall to contract functionName hsh cc theFunction args' ro
            return (f', args')
          _ -> do --Maybe the function is actually a getter
            case M.lookup functionName $ contract^.storageDefs of
              Just _ -> do
                --TODO- this should only exist if the storage variable is declared
                -- "public", right now I just ignore this and allow anything to be called as a getter
                return (fmap Just $ getVar $ Constant $ SReference $ AccountPath to . MS.singleton $ BC.pack functionName, OrderedVals [])
              Nothing -> unknownFunction "logFunctionCall" (functionName, contract^.contractName)



  logFunctionCall args to contract functionName f


runStatements :: MonadSM m => [Xabi.Statement] -> m (Maybe Value)
runStatements [] = return Nothing
runStatements (s:rest) = do
  onTraced $ do
    when False printFullStackTrace -- Too verbose, only turn on by hand when needed
    funcName <- getCurrentFunctionName
    liftIO $ putStrLn $ C.green $ funcName ++ "> " ++ unparseStatement s

  ret <- runStatement s
  case ret of
    Nothing -> runStatements rest
    v -> return v


runStatement :: MonadSM m => Xabi.Statement -> m (Maybe Value)
--runStatement x | trace (C.green $ "statement> " ++ unparseStatement x) $ False = undefined
--runStatement x | trace (C.green $ "statement> " ++ show x) $ False = undefined
{-
--TODO- variable assignment is an expression, but I am going to just treat it like a
--      statement for now.  Until this is fixed, we won't be able to run code that
--      looks like this `x = (y = 1)`
--      I checked the Wings contracts, they never use this.
runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement (Xabi.PlusPlus e))) = do
  var <- expToVar e
  path <- expToPath e
  v <- getInt var

  logAssigningVariable $ SInteger v

  setVar path $ SInteger $ v + 1
  return Nothing
-}



-- Assignment to an index into an array or mapping
runStatement st@(Xabi.SimpleStatement (Xabi.ExpressionStatement (Xabi.Binary "=" dst@(Xabi.IndexAccess parent (Just indExp)) src)) pos) = do
  solidVMBreakpoint pos
  srcVar <- expToVar src
  srcVal <- getVar srcVar

  onTraced $ do
    valString <- showSM srcVal
    withSrcPos pos $ "    Setting: " ++ unparseExpression dst ++ " = " ++ valString

  pVar <- expToVar parent
  pVal <- weakGetVar pVar

  -- If it's an array, calling (expToVar dst) gives us
  -- the value at the index, NOT a reference that we can
  -- assign to....so we need to make a new vector and reset the whole array
  case pVal of
    SArray typ fs -> do
      indVal <- getVar =<< expToVar indExp
      case indVal of
        SInteger ind -> do
          let newVec = fs V.// [(fromIntegral ind, srcVar)]
          setVar pVar (SArray typ newVec)
          return Nothing
        _ -> typeError ("array index value (" ++ (show indVal) ++ ") is not an integer") (unparseStatement st)
    _ -> do -- If it's a mapping, (expToVar dst) IS a reference, so we can set directly to it
      dstVar <- expToVar dst
      setVar dstVar srcVal
      return Nothing


runStatement st@(Xabi.SimpleStatement (Xabi.ExpressionStatement (Xabi.Binary "=" (Xabi.IndexAccess _ Nothing) _)) pos) = do
  solidVMBreakpoint pos
  missingField "index value cannot be empty" (unparseStatement st)


runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement (Xabi.Binary "=" dst src)) pos) = do
  solidVMBreakpoint pos
  srcVal <- getVar =<< expToVar src
  dstVar <- expToVar dst

  setVar dstVar srcVal
  
  onTraced $ do
    valString <- showSM srcVal
    withSrcPos pos $ "    Setting: " ++ unparseExpression dst ++ " = " ++ valString
              
  return Nothing

{-  
  case e1 of
    Xabi.TupleExpression es -> do
      vs <- mapM (mapM expToVar) es
      mapM_ (setVar v2) $ zip [0..] vs
    _ -> do
      v1 <- expToVar e1
      setVar v1 v2
  return Nothing
 where assignVal :: Bool -> Variable -> (Int, Maybe Variable) -> SM ()
       assignVal _ _ (_, Nothing) = return ()
       assignVal isTuple var (k, Just v1) = do
          ty <- getXabiValueType p
          case ty of
            Xabi.Array{} -> do
              onTraced $ liftIO $ putStrLn $ "Array copy to " ++ show p
              let p2 = case var of
                          Constant (SReference p2') -> p2'
                          _ -> todo "unhandled array copy" var
              len <- getInt . Constant . SReference $ p2 `apSnoc` MS.Field "length"
              setVar (p `apSnoc` MS.Field "length") $ SInteger len
              forM_ [0..len-1] $ \i -> do
                let idx = MS.ArrayIndex $ fromIntegral i
                rhs' <- getVar . Constant . SReference $ p2 `apSnoc` idx
                setVar (v1 `apSnoc` idx) rhs'
            _ -> do
              !value <- getVar var
              ctract <- getCurrentContract
              value' <- case (isTuple, value) of
                (True, STuple vs) -> getVar =<< V.indexM vs k
                (True, _) -> typeError "assigning nontuple to tuple" (v1, value)
                (False, _) -> return value
              onTraced $ liftIO $ putStrLn $ "Variable to set is: " ++ show (v1, value')
              logAssigningVariable value'
              setVar v1 $ coerceType ctract ty value'
-}
runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement e) pos) = do
  solidVMBreakpoint pos
  _ <- getVar =<< expToVar e
  return Nothing -- just throw away the return value

runStatement s@(Xabi.SimpleStatement (Xabi.VariableDefinition entries maybeExpression) pos) = do
  solidVMBreakpoint pos
  let !maybeLoc = case entries of
                      [e] -> Xabi.vardefLocation e
                      es -> if any ((== Just Xabi.Storage) . Xabi.vardefLocation) es
                              -- It is possible to supply locations in tuple definitions, but
                              -- I'm not sure what that exactly looks like when its not memory.
                              then todo "storage was not anticipated in a tuple entry" s
                              else Nothing
  let singleType = case entries of
                      [e] -> fromMaybe (todo "type inference not implemented" s) $ Xabi.vardefType e
                      _ -> todo "could not evaluate expression without tuple type" s
  !value <-
    case maybeExpression of
      Nothing -> do
        ctract <- getCurrentContract
        createDefaultValue ctract singleType
      Just e -> do
        rhs <- weakGetVar =<< expToVar e
        case (maybeLoc, rhs) of
          (Just Xabi.Storage, SReference{}) -> return rhs
          (_, SReference{}) -> getVar $ Constant rhs
          (_, c) -> return c

  onTraced $ do
    valueString <- showSM value
    let toName :: Xabi.VarDefEntry -> String
        toName Xabi.BlankEntry = ""
        toName vde = Xabi.vardefName vde
    withSrcPos pos $ printf "             creating and setting variables: (%s)\n" $
        intercalate ", " (map toName entries)
    withSrcPos pos $ printf "             to: %s\n" valueString
  let ensureType :: Maybe Xabi.Type -> Xabi.Type
      ensureType = fromMaybe (todo "type inference not implemented" s)

  case (entries, value) of
    ([Xabi.VarDefEntry mType _ name], _) -> addLocalVariable (ensureType mType) name value
    ([Xabi.BlankEntry], _) -> parseError "cannot declare single nameless variable" s
    (_, STuple variables) -> do
      checkArity "var declaration tuple" (V.length variables) (length entries)
      let nonBlanks = [(ensureType t, n, v) | (Xabi.VarDefEntry t _ n, v) <- zip entries $ V.toList variables]
      forM_ nonBlanks $ \(theType', name', variable') -> do
        value' <- getVar variable'
        addLocalVariable theType' name' value'

    _ -> typeError "VariableDefinition expected a tuple" value

  return Nothing

runStatement (Xabi.IfStatement condition code' maybeElseCode pos) = do
  solidVMBreakpoint pos
  conditionResult <- getBool =<< expToVar condition
  
  onTraced $ do
    if conditionResult
      then withSrcPos pos $ "       if condition succeeded, running internal code"
      else withSrcPos pos $ "       if condition failed, skipping internal code"
    
  if conditionResult
    then runStatements code'
    else case maybeElseCode of
      Just elseCode -> runStatements elseCode
      Nothing -> return Nothing

runStatement (Xabi.WhileStatement condition code pos) = do
  solidVMBreakpoint pos
     
  while (getBool =<< expToVar condition) $ do
      onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
      result <- runStatements code
      return result

      -- TODO: this can loop infinitely

runStatement (Xabi.DoWhileStatement code condition pos) = do
  solidVMBreakpoint pos
  doWhile (getBool =<< expToVar condition) $ do
      onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
      result <- runStatements code
      return result

      -- TODO: this can loop infinitely

--TODO- all the variables declared in an `if` or `for` code block need to be deleted when the block is finished....
runStatement (Xabi.ForStatement maybeInitStatement maybeConditionExp maybeLoopExp code pos) = do
  solidVMBreakpoint pos
  _ <-
    case maybeInitStatement of
      Just initStatement -> runStatement $ Xabi.SimpleStatement initStatement pos
      _ -> return Nothing

  let conditionExp =
        case maybeConditionExp of
          Just x -> x
          Nothing -> Xabi.BoolLiteral True

  let loopExp =
        case maybeLoopExp of
          Just x -> x
          Nothing -> todo "loop expressions" loopExp

  let condition = getBool =<< expToVar conditionExp

  while condition $ do
      onTraced $ withSrcPos pos $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
      result <- runStatements code
      _ <- getVar =<< expToVar loopExp
      return result

runStatement (Xabi.Return maybeExpression pos) = do
  solidVMBreakpoint pos
  case maybeExpression of
    Just e -> do
      ql <- expToVar e
      qlql <- getVar ql
      return $ Just qlql
--      fmap Just $ getVar =<< expToVar e
    Nothing -> return $ Just SNULL

runStatement (Xabi.AssemblyStatement (Xabi.MloadAdd32 dst src) pos) = do
  solidVMBreakpoint pos
  srcVar <- expToVar $ Xabi.Variable $ T.unpack src;
  dstVar <- expToVar $ Xabi.Variable $ T.unpack dst;

  -- TODO(tim): should this hex encode src and pad?
  setVar dstVar =<< getString srcVar
  return Nothing

runStatement st@(Xabi.EmitStatement eventName exptups pos) = do
  solidVMBreakpoint pos
  exps <- mapM (expToVar . snd) exptups
  expVals <- mapM getVar exps
  expStrs <- mapM showSM expVals

  -- checks that the event is declared and that the number of args match
  --   DOES NOT check consistency of arg types
  curInfo <- getCurrentCallInfo
  curCnct <- getCurrentContract
  let evs = _events curCnct
      mEv = M.lookup (T.pack eventName) evs
  case mEv of
    Nothing -> 
      missingType "no corresponding event has been declared for the following emit statement: " (unparseStatement st)
    Just ev -> do
      if (length exptups) /= (length $ Xabi.eventLogs ev) then 
        invalidArguments "arguments to statement are inconsistent with those declared" (unparseStatement st)
      else do
        let account = currentAccount curInfo
            address = _accountAddress account
        x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
        maybeCertLevelDB <- x509CertDBGet address
        let maybeCertBlockDB = M.lookup address x509s
            maybeCert = maybeCertBlockDB <|> maybeCertLevelDB
            organization = fromMaybe "" . fmap subOrg $ getCertSubject =<< maybeCert
        parentName <- fromMaybeM (return "") $ runMaybeT 
            $   pure account
            >>= MaybeT . getAddressStateMaybe
            >>= pure  .  addressStateCodeHash
            >>= MaybeT . resolveCodePtrParent (account ^. accountChainId)
            >>= (\case     
                    SolidVMCode name _ | name /= (_contractName curCnct) -> pure name
                    _                                                    -> pure "")
        addEvent $ Event organization parentName (_contractName curCnct) account eventName expStrs
        return Nothing


runStatement x = unknownStatement "unknown statement in call to runStatement: " (show x)

while :: MonadSM m => m Bool -> m (Maybe Value) -> m (Maybe Value)
while condition code = do
  c <- condition
  onTraced $ liftIO $ putStrLn $ C.red $ "^^^^^^^^^^^^^^^^^^^^ loopy condition: " ++ show c
  if c
    then do
      result <- code
      case result of
        Nothing -> while condition code
        _ -> return result
    else return Nothing

doWhile :: MonadSM m => m Bool -> m (Maybe Value) -> m (Maybe Value)
doWhile condition code = do
  result <- code
  case result of
    Nothing -> do
      c <- condition
      onTraced $ liftIO $ putStrLn $ C.red $ "^^^^^^^^^^^^^^^^^^^^ loopy condition: " ++ show c
      if c
        then doWhile condition code
        else return Nothing
    _ -> return result

getIndexType :: MonadSM m => AccountPath -> m IndexType
getIndexType (AccountPath addr p) = do
  let field = MS.getField p
  mType <- getXabiType addr field
  let n = MS.size p - 1
  case mType of
    Nothing -> todo "getIndexType/unknown storage reference" field
    Just v -> return $! loop n v
 where loop :: Int -> Xabi.Type -> IndexType
       loop 0 t = case t of
         Xabi.Mapping{Xabi.key=Xabi.Int{}} -> MapIntIndex
         Xabi.Mapping{Xabi.key=Xabi.String{}} -> MapStringIndex
         Xabi.Mapping{Xabi.key=Xabi.Bytes{}} -> MapStringIndex
         Xabi.Mapping{Xabi.key=Xabi.Address{}} -> MapAccountIndex
         Xabi.Mapping{Xabi.key=Xabi.Account{}} -> MapAccountIndex
         Xabi.Mapping{Xabi.key=Xabi.Bool{}} -> MapBoolIndex
         Xabi.Array{} -> ArrayIndex
         _ -> typeError "unanticipated index type" t
       loop n t = case t of
         Xabi.Mapping{Xabi.value=t'} -> loop (n - 1) t'
         Xabi.Array{Xabi.entry=t'} -> loop (n - 1) t'
         _ -> typeError "indexing type in var dec" t



expToPath :: MonadSM m => Xabi.Expression -> m AccountPath
expToPath (Xabi.Variable x) = do
  callInfo <- getCurrentCallInfo
  let path = MS.singleton $ BC.pack x
  case x `M.lookup` localVariables callInfo of
    Just (_, var) -> do
      val <- weakGetVar var
      case val of
        SReference apt -> return apt
        _ -> typeError "expToPath should never be called for a local variable" ((show x) ++ " = " ++ show val)
    Nothing -> return $ AccountPath (currentAccount callInfo) path
expToPath x@(Xabi.IndexAccess parent mIndex) = do
  parPath  <- do
    parvar <- expToVar parent
    case parvar of
      Constant (SReference apt) -> return apt
      _ -> expToPath parent

  idxType <- getIndexType parPath
  idxVar <- maybe (typeError "empty index is only valid at type level" x) expToVar mIndex
  apSnoc parPath <$> case idxType of
    MapAccountIndex -> do
      idx <- getAccount idxVar
      return $ case idx of
        SAccount a -> MS.MapIndex $ MS.IAccount a
        SInteger i -> MS.MapIndex $ MS.IAccount . unspecifiedChain $ fromIntegral i
        _ -> typeError "invalid map of addresses index" idx
    MapBoolIndex -> do
      b <- getBool idxVar
      return $ MS.MapIndex $ MS.IBool b
    MapIntIndex -> do
      n <- getInt idxVar
      return . MS.MapIndex $ MS.INum n
    MapStringIndex -> do
      idx <- getString idxVar
      return $ case idx of
        SString s -> MS.MapIndex $ MS.IText $ UTF8.fromString s
        _ -> typeError "invalid map of strings index" idx
    ArrayIndex -> do
      n <- getInt idxVar
      return . MS.ArrayIndex $ fromIntegral n
expToPath (Xabi.MemberAccess parent field) = do
  apt <- do
    parvar <- expToVar parent
    case parvar of
      _ -> expToPath parent
  return . apSnoc apt . MS.Field $ BC.pack field

expToPath x = todo "expToPath/unhandled" x

expToVar :: MonadSM m => Xabi.Expression -> m Variable
expToVar x = do
  v <- expToVar' x
  return v

expToVar' :: MonadSM m => Xabi.Expression -> m Variable
expToVar' (Xabi.NumberLiteral v Nothing) = return . Constant $ SInteger v
expToVar' (Xabi.StringLiteral s) = return $ Constant $ SString s
expToVar' (Xabi.BoolLiteral b) = return $ Constant $ SBool b
expToVar' (Xabi.Variable "bytes32ToString") = return $ Constant $ SHexDecodeAndTrim
expToVar' (Xabi.Variable "addressToAsciiString") = return $ Constant SAddressToAscii
expToVar' (Xabi.Variable "bytes") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing
expToVar' (Xabi.Variable "now") =
  Constant . SInteger . round . utcTimeToPOSIXSeconds . blockDataTimestamp . Env.blockHeader <$> getEnv
expToVar' (Xabi.Variable name) = do
  getVariableOfName name

expToVar' (Xabi.PlusPlus e) = do
  var <- expToVar e
  value <- getInt var

  logAssigningVariable $ SInteger value

  setVar var $ SInteger $ value + 1
  return $ Constant $ SInteger value

expToVar' (Xabi.Unitary "++" e) = do
  var <- expToVar e
  value <- getInt var
  let next = SInteger $ value + 1
  logAssigningVariable next

  setVar var next
  return $ Constant next

expToVar' (Xabi.MinusMinus e) = do
  var <- expToVar e
  value <- getInt var
  logAssigningVariable $ SInteger value
  setVar var . SInteger $ value - 1
  return $ Constant $ SInteger value

expToVar' (Xabi.Unitary "--" e) = do
  var <- expToVar e
  value <- getInt var
  let next = SInteger $ value -1
  logAssigningVariable next
  setVar var next
  return $ Constant next

expToVar' (Xabi.Binary "+=" lhs rhs) = addAndAssign lhs rhs
expToVar' (Xabi.Binary "-=" lhs rhs) = binopAssign (-) lhs rhs
expToVar' (Xabi.Binary "*=" lhs rhs) = binopAssign (*) lhs rhs
expToVar' (Xabi.Binary "/=" lhs rhs) = binopAssign mod lhs rhs
expToVar' (Xabi.Binary "%=" lhs rhs) = binopAssign rem lhs rhs
expToVar' (Xabi.Binary "|=" lhs rhs) = binopAssign (.|.) lhs rhs
expToVar' (Xabi.Binary "&=" lhs rhs) = binopAssign (.&.) lhs rhs
expToVar' (Xabi.Binary "^=" lhs rhs) = binopAssign xor lhs rhs

expToVar' (Xabi.MemberAccess (Xabi.Variable "Util") "bytes32ToString") = do
  return $ Constant $ SHexDecodeAndTrim

expToVar' (Xabi.MemberAccess (Xabi.Variable "Util") "b32") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing

expToVar' x@(Xabi.MemberAccess expr name) = do
  val <- getVar =<< expToVar expr
  chainId <- view accountChainId <$> getCurrentAccount

  case (val, name) of
--    Constant c -> case (c, name) of
      (SEnum enumName, _) -> do
        contract' <- getCurrentContract
        let maybeEnumValues = M.lookup enumName $ contract' ^. enums
            !enumVals = fromMaybe (missingType "Enum nonexistent type" enumName) maybeEnumValues
            !num = maybe (missingType "Enum nonexistent member" (enumName, name)) 
                         fromIntegral 
                         (name `elemIndex` enumVals)
        return $ Constant $ SEnumVal enumName name num
      (SBuiltinVariable "msg", "sender") -> (Constant . SAccount . accountToNamedAccount chainId . Env.sender) <$> getEnv
      (SBuiltinVariable "tx", "origin") -> (Constant . SAccount . accountToNamedAccount chainId . Env.origin) <$> getEnv
      (SBuiltinVariable "tx", "username") -> do env' <- getEnv
                                                x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
                                                maybeCertLevelDB <- x509CertDBGet $ _accountAddress $ Env.origin env'
                                                let maybeCertBlockDB = M.lookup (_accountAddress $ Env.origin env') x509s
                                                    maybeCert = maybeCertBlockDB <|> maybeCertLevelDB
                                                return . Constant . SString . fromMaybe "" . fmap subCommonName $ getCertSubject =<< maybeCert
      (SBuiltinVariable "tx", "organization") -> do env' <- getEnv
                                                    x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
                                                    maybeCertLevelDB <- x509CertDBGet $ _accountAddress $ Env.origin env'
                                                    let maybeCertBlockDB = M.lookup (_accountAddress $ Env.origin env') x509s
                                                        maybeCert = maybeCertBlockDB <|> maybeCertLevelDB
                                                    return . Constant . SString . fromMaybe "" . fmap subOrg $ getCertSubject =<< maybeCert
      (SBuiltinVariable "tx", "group") -> do env' <- getEnv
                                             x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
                                             maybeCertLevelDB <- x509CertDBGet $ _accountAddress $ Env.origin env'
                                             let maybeCertBlockDB = M.lookup (_accountAddress $ Env.origin env') x509s
                                                 maybeCert = maybeCertBlockDB <|> maybeCertLevelDB
                                             return . Constant . SString . fromMaybe "" $ subUnit =<< getCertSubject =<< maybeCert
      (SStruct _ theMap, fieldName) -> case M.lookup fieldName theMap of
          Nothing -> missingField "struct member access" fieldName
          Just v -> return v
      (SContractDef contractName', constName) -> do
        --TODO- move all variable name resolution by contract to a function
        (_, cc) <- getCurrentCodeCollection
        cont <- case M.lookup contractName' $ cc^.contracts of
          Nothing -> missingType "contract function lookup" contractName'
          Just ct -> pure ct
        if constName `M.member` _functions cont
          then do
            -- TODO: Check that this contract actually is a contractName'
            addr <- accountOnUnspecifiedChain <$> getCurrentAccount
            return $ Constant $ SContractFunction (Just contractName') addr constName
          else case constName `M.lookup` _constants cont of
                  Nothing -> unknownConstant "constant member access" (contractName', constName)
                  Just (Xabi.ConstantDecl _ _ constExp) -> expToVar constExp

      (SBuiltinVariable "block", "timestamp") -> do
        env' <- getEnv
        return $ Constant $ SInteger $ round $ utcTimeToPOSIXSeconds $ blockDataTimestamp $ Env.blockHeader env'

      (SBuiltinVariable "block", "number") -> (Constant . SInteger . blockDataNumber . Env.blockHeader) <$> getEnv

      (SBuiltinVariable "super", method) -> do
        ctract <- getCurrentContract
        (_, cc) <- getCurrentCodeCollection
        let parents' = getParents cc ctract
        case filter (elem method . M.keys .  _functions) parents' of
          [] -> typeError "cannot use super without a parent contract" (method, ctract)
          ps -> do
            addr <- accountOnUnspecifiedChain <$> getCurrentAccount
            return $ Constant $ SContractFunction (Just $ _contractName $ last ps) addr method

      (SAccount addr, itemName) -> return $ Constant $ SContractItem addr itemName

      (SContract _ a, funcName) -> return $ Constant $ SContractFunction Nothing a funcName
      (r@(SReference _), "push") -> return $ Constant $ SPush r
      (a@(SArray _ _), "push") -> return $ Constant $ SPush a
      (SArray _ theVector, "length") -> return $ Constant $ SInteger $ fromIntegral $ V.length theVector
      (SString s, "length") -> return . Constant . SInteger . fromIntegral $ length s
      (SReference apt, "length") -> do
        ty <- getValueType apt
        case ty of
          TString -> do
            let getInnerString (SString s) = s
                getInnerString _ = error "impossible match in SolidVM.hs"
            return . Constant . SInteger . fromIntegral $ length $ getInnerString val
          _ -> return . Constant . SReference . apSnoc apt $ MS.Field "length"

      (SReference p, itemName) -> return . Constant . SReference $ apSnoc p $ MS.Field $ BC.pack itemName
      _ -> typeError "illegal member access" $ unparseExpression x
{-
    Variable vref -> do
      val' <- liftIO $ readIORef vref
      case val' of
        SAddress addr -> return . Constant $ SContractItem addr name
        SStruct _ theMap -> return
                $ fromMaybe (error $ "fetched a struct field that doesn't exist: " ++ name)
                $ M.lookup name theMap
        SReference apt -> do
          return . Constant . SReference . apSnoc apt . MS.Field $ BC.pack name
        _ -> todo "access member of variable" (val', name)
-}
{-
    StorageItem apt -> case name of
      -- TODO(tim): This will not work correctly with struct fields named push
      "push" -> return . Constant $ SPush apt
      "length" -> do
        ty <- getValueType apt
        case ty of
          TString -> do
            SString s <- getVar var
            return . Constant . SInteger . fromIntegral $ length s
          _ -> return . Constant . SReference . apSnoc apt $ MS.Field "length"
      _ -> do
          val' <- getVar $ Constant $ SReference apt
          case val' of
            SAddress addr -> return . Constant $ SContractItem addr name
            SContract _ addr -> return . Constant $ SContractItem addr name
            SStruct _ theMap -> return
                $ fromMaybe (error $ "fetched a struct field that doesn't exist: " ++ name)
                $ M.lookup name theMap
            _ -> todo "access member of storage item" (val', name, apt) -}

expToVar' x@(Xabi.IndexAccess _ (Nothing)) = missingField "index value cannot be empty" (unparseExpression x)

-- TODO(tim): When this is a string constant, we can index into the string directly for SInteger
expToVar' x@(Xabi.IndexAccess parent (Just mIndex)) = do
  var <- expToVar parent

  case var of
    (Constant (SReference _)) -> Constant . SReference <$> expToPath x
--    (Constant (SArray theType theVector)) -> do
    _ -> do
      theIndex <- getVar =<< expToVar mIndex
      val <- getVar var
      case (val, theIndex) of
        (SArray _ theVector, SInteger i) -> do
          if (fromIntegral i) >= length theVector then
            indexOutOfBounds ("index value was " ++ (show i) ++ ", but the array length was " ++ (show $ length theVector)) $ unparseExpression x 
          else
            return $ theVector V.! fromIntegral i
        (SMap _ theMap, _) -> do maybe (indexOutOfBounds ("index value was " ++ (show theIndex) ++ ", but the valid indexes were " ++ (show $ M.keys theMap)) $ unparseExpression x)
                                               return
                                               (theMap M.!? theIndex)
        (SReference _, _) -> Constant . SReference <$> expToPath x
        _ -> typeError "unsupported types for index access" $ unparseExpression x
--    _ -> error $ "unknown case in expToVar' for IndexAccess: " ++ show var


expToVar' (Xabi.Binary "+" expr1 expr2) = expToVarAdd expr1 expr2
expToVar' (Xabi.Binary "-" expr1 expr2) = expToVarInteger expr1 (-) expr2 SInteger
expToVar' (Xabi.Binary "*" expr1 expr2) = expToVarInteger expr1 (*) expr2 SInteger
expToVar' ex@(Xabi.Binary "/" expr1 expr2) = do 
  rhs <- getInt =<< expToVar expr2
  case rhs of
    0 -> divideByZero $ unparseExpression ex
    _ -> expToVarInteger expr1 div expr2 SInteger
expToVar' (Xabi.Binary "%" expr1 expr2) = expToVarInteger expr1 rem expr2 SInteger
expToVar' (Xabi.Binary "|" expr1 expr2) = expToVarInteger expr1 (.|.) expr2 SInteger
expToVar' (Xabi.Binary "&" expr1 expr2) = expToVarInteger expr1 (.&.) expr2 SInteger
expToVar' (Xabi.Binary "^" expr1 expr2) = expToVarInteger expr1 xor expr2 SInteger
expToVar' (Xabi.Binary "**" expr1 expr2) = expToVarInteger expr1 (^) expr2 SInteger
expToVar' (Xabi.Binary "<<" expr1 expr2) = expToVarInteger expr1 (\x i -> x `shift` fromInteger i) expr2 SInteger
expToVar' (Xabi.Binary ">>" expr1 expr2) = expToVarInteger expr1 (\x i -> x `shiftR` fromInteger i) expr2 SInteger

expToVar' (Xabi.Unitary "!" expr) = do
  (Constant . SBool . not) <$> (getBool =<< expToVar expr)
expToVar' (Xabi.Unitary "delete" expr) = do
  p <- expToVar expr
  deleteVar p
  return $ Constant SNULL

expToVar' (Xabi.Binary "!=" expr1 expr2) = do --TODO- generalize all of these Binary operations to a single function
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  ctract <- getCurrentContract
  onTraced $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  return . Constant . SBool . not $ valEquals ctract val1 val2

expToVar' (Xabi.Binary "==" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  ctract <- getCurrentContract
  logVals val1 val2
  return . Constant . SBool $ valEquals ctract val1 val2

expToVar' (Xabi.Binary "<" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 < i2
    _ -> typeError "binary '<' on non-ints" (val1, val2)

expToVar' (Xabi.Binary ">" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 > i2
    _ -> typeError "binary '>' on non-ints" (val1, val2)

expToVar' (Xabi.Binary ">=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 >= i2
    _ -> typeError "binary '>=' used on non-ints" (val1, val2)

expToVar' (Xabi.Binary "<=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 <= i2
    _ -> typeError "binary '<=' used on non-ints" (val1, val2)

expToVar' (Xabi.Binary "&&" expr1 expr2) = do
  b1 <- getBool =<< expToVar expr1

  -- Only evaluate expr2 if b1 is True, otherwise return False
  if b1 then do
    b2 <- getBool =<< expToVar expr2
    logVals b1 b2
    return $ Constant $ SBool b2
  else
    return $ Constant $ SBool False

expToVar' (Xabi.Binary "||" expr1 expr2) = do
  b1 <- getBool =<< expToVar expr1

  -- Only evaluate expr2 if b1 is False, otherwise return True
  if b1 then
    return $ Constant $ SBool True
  else do
    b2 <- getBool =<< expToVar expr2
    logVals b1 b2
    return $ Constant $ SBool b2

expToVar' (Xabi.TupleExpression exps) = do
  -- Or should STuple be a Vector of Maybe?
  vars <- for exps $ maybe (return $ Constant SNULL) expToVar
  return $ Constant $ STuple $ V.fromList vars

expToVar' (Xabi.ArrayExpression exps) = do
  vars <- for exps expToVar
--  return $ Constant $ SArray (error "array type from array literal not known") $ V.fromList vars
  return $ Constant $ SArray (Xabi.Int Nothing Nothing) $ V.fromList vars

expToVar' (Xabi.Ternary condition expr1 expr2) = do
  c <- getBool =<< expToVar condition
  expToVar $ if c then expr1 else expr2

expToVar' (Xabi.FunctionCall (Xabi.NewExpression Xabi.Bytes{}) (Xabi.OrderedArgs args)) = do
  case args of
    [a] -> do
      len <- getInt =<< expToVar a
      return . Constant . SString $ replicate (fromIntegral len) '\NUL'
    _ -> arityMismatch "newBytes" 1 (length args)
expToVar' x@(Xabi.FunctionCall (Xabi.NewExpression Xabi.Bytes{}) (Xabi.NamedArgs{})) =
  typeError "cannot create new bytes with named arguments" x
expToVar' (Xabi.FunctionCall (Xabi.NewExpression (Xabi.Array {Xabi.entry=t})) (Xabi.OrderedArgs args)) = do
  ctract <- getCurrentContract
  case args of
    [a] -> do
      len <- getInt =<< expToVar a
      return . Constant . SArray t . V.replicate (fromIntegral len) . Constant $ defaultValue ctract t
    _ -> arityMismatch "new array" 1 (length args)
expToVar' x@(Xabi.FunctionCall (Xabi.NewExpression (Xabi.Array{})) Xabi.NamedArgs{}) =
  typeError "cannot create new array with named arguments" x

expToVar' (Xabi.FunctionCall (Xabi.NewExpression (Xabi.Label contractName')) args) = do
  ro <- readOnly <$> getCurrentCallInfo
  when ro $ invalidWrite "Invalid contract creation during read-only access" $ "contractName: " ++ show contractName' ++ ", args: " ++ show args
  creator <- getCurrentAccount
  (hsh, cc) <- getCurrentCodeCollection
  newAddress <- getNewAddress creator
  x509s' <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
  execResults <- create' creator newAddress hsh cc contractName' args x509s'
  return $ Constant $ SContract contractName' $ accountOnUnspecifiedChain
    $ fromMaybe (internalError "a call to create did not create an address" execResults)
    $  erNewContractAccount execResults

expToVar' (Xabi.FunctionCall e args) = do
  var <- expToVar e
  argVals <- case args of
                 Xabi.OrderedArgs as -> OrderedVals <$> mapM (getVar <=< expToVar) as
                 Xabi.NamedArgs ns -> NamedVals <$> mapM (mapM $ getVar <=< expToVar) ns

  case var of
    Constant (SReference (AccountPath address (MS.StoragePath pieces))) -> do
      val' <- getVar $ Constant $ SReference $ AccountPath address $MS.StoragePath $ init pieces
      case (val', last pieces) of
        
        (SContract _ toAddress', MS.Field funcName) -> do
          fromAddress <- getCurrentAccount
          let toAddress = namedAccountToAccount (fromAddress ^. accountChainId) toAddress'
          res <- callWrapper fromAddress toAddress Nothing (BC.unpack funcName) args
          case res of
            Just v -> return $ Constant $ v
            Nothing -> return $ Constant SNULL
        
        (SAccount toAddress', MS.Field funcName) -> do
          fromAddress <- getCurrentAccount
          let toAddress = namedAccountToAccount (fromAddress ^. accountChainId) toAddress'
          res <- callWrapper fromAddress toAddress Nothing (BC.unpack funcName) args
          case res of
            Just v -> return $ Constant $ v
            Nothing -> return $ Constant SNULL
        x -> todo "expToVar'/FunctionCall" x

    Constant (SBuiltinFunction name o) -> case argVals of
      OrderedVals vs -> Constant <$> callBuiltin name vs o
      NamedVals{} -> invalidArguments (printf "expToVar'/builtinfunction: cannot used namedvals with builtin %s" name) argVals


    Constant (SFunction funcName func) -> do
      ro <- readOnly <$> getCurrentCallInfo
      contract' <- getCurrentContract
      address <- getCurrentAccount
      (hsh, cc) <- getCurrentCodeCollection

      res <- runTheCall address contract' funcName hsh cc func argVals ro
      return . Constant . fromMaybe SNULL $ res

    Constant (SStructDef structName) -> do
      contract' <- getCurrentContract
      let !vals = fromMaybe (missingType "struct constructor not found" structName)
               $ M.lookup structName $ contract'^.structs
      return . Constant . SStruct structName . fmap Constant . M.fromList $
        case argVals of
          OrderedVals as -> zip (map (T.unpack . fst) vals) as
          NamedVals ns -> ns

    Constant (SContractDef contractName') -> do
      case argVals of
        OrderedVals [SInteger address] -> --TODO- clean up this ambiguity between SAddress and SInteger....
          return $ Constant $ SContract contractName' $ unspecifiedChain $ fromInteger address
        OrderedVals [SAccount address ] -> 
          return $ Constant $ SContract contractName' address
        OrderedVals [SContract _ addr] ->
          return $ Constant $ SContract contractName' $ addr
        _ -> typeError "contract variable creation" argVals

    Constant (SContractItem address' "transfer") -> do
      from <- getCurrentAccount
      let address = namedAccountToAccount (from ^. accountChainId) address'
      success <- case argVals of
        OrderedVals [SInteger amount] -> do
          pay "built-in transfer function" from address amount
        _ -> return False
      return . Constant $ SBool success

    Constant (SContractItem address' itemName) -> do

      from <- getCurrentAccount
      let address = namedAccountToAccount (from ^. accountChainId) address'
      result <- callWrapper from address Nothing itemName args
      return . Constant . fromMaybe SNULL $ result

    Constant (SContractFunction name address' functionName) -> do
      
      from <- getCurrentAccount
      let address = namedAccountToAccount (from ^. accountChainId) address'
      result <- callWrapper from address name functionName args
      return . Constant . fromMaybe SNULL $ result

    Constant (SEnum enumName) -> do
      case argVals of
        OrderedVals [SInteger i] -> do
          c <- getCurrentContract
          let !theEnum = fromMaybe (missingType "enum constructor" enumName)
                      $ M.lookup enumName $ c^.enums
          return $ Constant $ SEnumVal enumName (theEnum !! fromInteger i) (fromInteger i)
        _ -> typeError "called enum constructor with improper args" argVals

    Constant (SPush theArray) -> Builtins.push theArray argVals

    Constant SHexDecodeAndTrim ->
        case argVals of
          -- bytes should already be hex decoded when appropriate
          OrderedVals [s@SString{}] -> return $ Constant s
          _ -> typeError "bytes32ToString with incorrect arguments" argVals
    Constant SAddressToAscii ->
      case argVals of
        OrderedVals [SAccount a] -> return . Constant . SString $ show a
        _ -> typeError "addressToAsciiString with incorrect arguments" argVals

    -- It would be nice to reinterpret two element paths as a function.
    -- How can we get a to resolve to a local variable instead of a path?
    -- StorageItem [Field a, Field b] -> todo "reinterpret as a function

    _ -> typeError "cannot call non-function" var


{-
SimpleStatement (ExpressionStatement (Binary "=" (Variable "tickets") (FunctionCall (NewExpression (Label "Hashmap")) [])))
-}

expToVar' x = todo "expToVar/unhandled" x

--------------

expToVarAdd :: MonadSM m => Xabi.Expression -> Xabi.Expression -> m Variable
expToVarAdd expr1 expr2 = do
  i1 <- getVar =<< expToVar expr1
  i2 <- getVar =<< expToVar expr2
  case (i1, i2) of
    (SInteger a, SInteger b) -> return . Constant . SInteger $ a + b
    (SString a, SString b) -> return . Constant . SString $ a ++ b
    _ -> typeError "expToVarAdd" (i1, i2)

expToVarInteger :: MonadSM m => Xabi.Expression -> (Integer->Integer->a) -> Xabi.Expression -> (a->Value) -> m Variable
expToVarInteger expr1 o expr2 retType = do
  i1 <- getInt =<< expToVar expr1
  i2 <- getInt =<< expToVar expr2
  return . Constant . retType $ i1 `o` i2

addAndAssign :: MonadSM m => Xabi.Expression -> Xabi.Expression -> m Variable
addAndAssign lhs rhs = do
  let readVal e = getVar =<< expToVar e
  delta <- readVal rhs
  curValue <- readVal lhs
  varToAssign <- expToVar lhs
  next <- case (curValue, delta) of
    (SInteger c, SInteger d) -> pure . SInteger $ c + d
    (SString c, SString d) -> pure . SString $ c ++ d
    _ -> typeError "addAndAssign" (curValue, delta)
  setVar varToAssign next
  return $ Constant next

binopAssign :: MonadSM m => (Integer -> Integer -> Integer) -> Xabi.Expression -> Xabi.Expression -> m Variable
binopAssign oper lhs rhs = do
  let readInt e = getInt =<< expToVar e
  delta <- readInt rhs
  curValue <- readInt lhs
  varToAssign <- expToVar lhs
  let next = SInteger $ curValue `oper` delta
  setVar varToAssign next
  return $ Constant next

intBuiltin :: [Value] -> Value
intBuiltin [SEnumVal _ _ enumNum] = SInteger $ fromIntegral enumNum
intBuiltin [SInteger n] = SInteger n
intBuiltin [SString hex] =
  case B16.decode (BC.pack hex) of
    (l, "") -> let zeros = 32 - B.length l
               in SInteger . fromIntegral . bytesToWord256 $ B.replicate zeros 0x0 <> l
    _ -> typeError "numeric cast - not a hex string" hex
intBuiltin args = typeError "numeric cast - invalid args" args

castToAncestor :: MonadSM m => NamedAccount -> Integer -> m Value
castToAncestor a n = do
  cInfo <- Mod.get (Mod.Proxy @[CallInfo])
  let currentChainId = maybe Nothing (_accountChainId . currentAccount) $ listToMaybe cInfo
  pChain <- getNthAncestorChain (fromIntegral n) currentChainId
  case pChain of
    Nothing -> return . SAccount $ (namedAccountChainId .~ MainChain) a
    Just b -> return . SAccount $ (namedAccountChainId .~ ExplicitChain b) a

callBuiltin :: MonadSM m => String -> [Value] -> Maybe Value -> m Value
callBuiltin "string" [SString s] _ = return $ SString s
callBuiltin "string" [SAccount a] _ = return . SString $ show a
callBuiltin "string" [SInteger i] _ = return . SString $ show i
callBuiltin "string" [SBool b] _ = return . SString $ bool "false" "true" b
callBuiltin "string" vs _ = typeError "string cast" vs
callBuiltin "address" [SInteger a] _ = return . SAccount . unspecifiedChain $ fromIntegral a
callBuiltin "address" [a@SAccount{}] _ = return a
callBuiltin "address" [SContract _ a] _ = return $ SAccount a
callBuiltin "address" [ss@(SString s)] _ = maybe (typeError "address cast" ss)
                                                 (return . SAccount . (namedAccountChainId .~ UnspecifiedChain))
                                                 $ readMaybe s
callBuiltin "address" vs _ = typeError "address cast" vs
callBuiltin "account" [SInteger a] _ = return . SAccount . unspecifiedChain $ fromIntegral a
callBuiltin "account" [a@SAccount{}] _ = return a
callBuiltin "account" [SContract _ a] _ = return $ SAccount a
callBuiltin "account" [ss@(SString s)] _ = maybe (typeError "account cast" ss)
                                                 (return . SAccount)
                                                 $ readMaybe s
callBuiltin "account" [SInteger a, SInteger b] _ = return . SAccount $ explicitChain (fromIntegral a) (fromInteger b)
callBuiltin "account" [SInteger a, SString "main"] _ = return . SAccount $ mainChain (fromIntegral a)
callBuiltin "account" [SInteger a, SString "self"] _                 = unspecifiedChain (fromIntegral a) `castToAncestor` 0
callBuiltin "account" [SInteger a, SString "parent"] _               = unspecifiedChain (fromIntegral a) `castToAncestor` 1
callBuiltin "account" [SInteger a, SString "grandparent"] _          = unspecifiedChain (fromIntegral a) `castToAncestor` 2
callBuiltin "account" [SInteger a, SString "ancestor", SInteger n] _ = unspecifiedChain (fromIntegral a) `castToAncestor` n
callBuiltin "account" [SAccount a, SInteger b] _ = return . SAccount $ (namedAccountChainId .~ ExplicitChain (fromIntegral b)) a
callBuiltin "account" [SAccount a, SString "main"] _ = return . SAccount $ (namedAccountChainId .~ MainChain) a
callBuiltin "account" [SAccount a, SString "self"] _                 = a `castToAncestor` 0
callBuiltin "account" [SAccount a, SString "parent"] _               = a `castToAncestor` 1
callBuiltin "account" [SAccount a, SString "grandparent"] _          = a `castToAncestor` 2
callBuiltin "account" [SAccount a, SString "ancestor", SInteger n] _ = a `castToAncestor` n
callBuiltin "account" vs _ = typeError "account cast" vs
callBuiltin "bool" [SBool b] _ = return $ SBool b
callBuiltin "bool" [SString "true"] _ = return $ SBool True
callBuiltin "bool" [SString "false"] _ = return $ SBool False
callBuiltin "bool" vs _ = typeError "bool cast" vs
callBuiltin "byte" [SInteger n] _ = return $ SInteger (n .&. 0xff)
callBuiltin "byte"  vs _ = typeError "byte cast" vs
callBuiltin "uint" args _ = return $ intBuiltin args
callBuiltin "int" args _ = return $ intBuiltin args
callBuiltin "push" [v] (Just o) = typeError "push (called as func, not as method)" (v, o)
callBuiltin "identity" [v] Nothing = return v
callBuiltin "keccak256" [SString buf] Nothing = do
  return . SString . BC.unpack . keccak256ToByteString . hash . BC.pack $ buf
callBuiltin "require" (SBool cond :msg) Nothing = do
  case msg of
    [] -> require cond Nothing
    (m:_) -> require cond (Just $ show m)
  return SNULL
callBuiltin "assert" [SBool cond] Nothing = SNULL <$ assert cond
callBuiltin "registerCert" [SAccount a, SString cert] _ = do
    let ex509Cert = bsToCert . BC.pack $ cert
    case ex509Cert of
        Left _         -> return SNULL
        Right x509Cert -> do x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
                             Mod.put (Mod.Proxy @(M.Map Address X509Certificate)) $ M.insert (_accountAddress $ namedAccountToAccount Nothing a) x509Cert x509s
                             return SNULL
callBuiltin "getUserCert" [SAccount a] _ = do
    x509s <- Mod.get (Mod.Proxy @(M.Map Address X509Certificate))
    maybeCertLevelDB <- x509CertDBGet $ _namedAccountAddress a
    let maybeCertBlockDB = M.lookup (_namedAccountAddress a) x509s
        maybeCert = maybeCertBlockDB <|> maybeCertLevelDB
    return $ certificateMap (fmap (BC.unpack . certToBytes) maybeCert)
callBuiltin "parseCert" [SString cert] _ = return $ certificateMap (Just cert)
callBuiltin x _ _ = unknownFunction "callBuiltin" x



certificateMap :: Maybe String -> Value
certificateMap maybeCert = case maybeCert of
    Nothing -> SMap stringToString emptyCertMap
    Just cert -> SMap stringToString (fromMaybe emptyCertMap $ fmap (certMap cert) (subject cert))
    where subject cert = getCertSubject =<< (eitherToMaybe . bsToCert . BC.pack $ cert)
          certMap cert sub = M.fromList [ (SString "commonName", Constant . SString $ subCommonName sub)
                                   , (SString "country", Constant . SString $ fromMaybe "" $ subCountry sub) 
                                   , (SString "organization", Constant . SString $ subOrg sub) 
                                   , (SString "group", Constant . SString $ fromMaybe "" $ subUnit sub) 
                                   , (SString "publicKey", Constant . SString $ BC.unpack $ pubToBytes $ subPub sub) 
                                   , (SString "certString", Constant . SString $ cert)
                                   ]
          emptyCertMap = M.fromList [ (SString "commonName", Constant . SString $ "")
                             , (SString "country", Constant . SString $ "") 
                             , (SString "organization", Constant . SString $ "") 
                             , (SString "group", Constant . SString $ "") 
                             , (SString "publicKey", Constant . SString $ "") 
                             , (SString "certString", Constant . SString $ "")
                             ]
          stringToString = Xabi.Mapping { Xabi.dynamic = Nothing
                                        , Xabi.key = Xabi.String Nothing
                                        , Xabi.value = Xabi.String Nothing }
{-
data Func = Func
  { funcArgs :: Map Text Xabi.IndexedType
  , funcVals :: Map Text Xabi.IndexedType
  , funcStateMutability :: Maybe StateMutability

  -- These Values are only used for parsing and unparsing solidity.
  -- This data will not be stored in the db and will have no
  -- relevance when constructing from the db.
  , funcContents :: Maybe [Statement]
  , funcVisibility :: Maybe Visibility
  , funcModifiers :: Maybe [String]
  } deriving (Eq,Show,Generic)

-}

{-
initializeContract :: Address -> Contract -> SM ()
initializeContract address contract' = do
  undefined address contract'
-}

{-
getContractAddress :: Address -> SM Address
getContractAddress (Address v) = do
  nonce' <- getNonce $ Address v
  setNonce (Address v) $ nonce'+1
  return $ Address $ fromIntegral $ bytesToInteger $ B.unpack $ B.drop 12 $ keccak256 $ BC.pack $ show v ++ show nonce'
-}

--keccak256 :: BC.ByteString -> BC.ByteString
--keccak256 bs = convert (hash bs :: Digest Keccak_256)

{-
bytesToInteger :: [Word8] -> Integer
bytesToInteger bytes =
  sum $ map (\(shiftBits, byte) -> fromIntegral byte `shiftL` shiftBits) $ zip [0, 8..] $ reverse bytes
-}


runTheConstructors :: MonadSM m => Account -> Account -> Keccak256 -> CodeCollection -> String -> Xabi.ArgList -> m ()
runTheConstructors from to hsh cc contractName' argExps = do
  let !contract' =
          fromMaybe (missingType "contract inherits from nonexistent parent" contractName')
          $ cc^.contracts . at contractName'
      argPairs = fromMaybe [] . fmap Xabi.funcArgs $ contract' ^. constructor
      argCount = length argPairs
      argTypeNames = map fst $ sortWith snd $
        [ ((t, T.unpack $ fromMaybe "" n), i) |
          (n, Xabi.IndexedType{Xabi.indexedTypeType=t, Xabi.indexedTypeIndex=i}) <- argPairs]
  onTraced $ liftIO $ putStrLn $ box
    ["running constructor: "++contractName'++"("++intercalate ", " (map snd argTypeNames)++")"]

  argVals <- case argExps of
                  (Xabi.OrderedArgs []) -> do
                    when (argCount > 0) $ invalidArguments "not enough arguments provided" argPairs
                    return $ OrderedVals []
                  (Xabi.NamedArgs []) -> do
                    when (argCount > 0) $ invalidArguments "not enough arguments provided" argPairs
                    return $ NamedVals []
                  _ -> argsToVals contract'
                                  (fromMaybe (invalidArguments ("arguments provided for missing constructor in contract " ++ contractName') argPairs)
                                        $ _constructor contract')
                                  argExps
  let einval = invalidArguments "named arguments to contract without constructor" (contractName', argVals)

  zipped <-
    case argVals of
      OrderedVals vals -> 
        forM (zip argTypeNames vals) $ \((t, n), v) -> do
          let correctedVal = coerceType contract' t v
          var <- createVar correctedVal
          return (n, (t, var))

      NamedVals ns -> do
        let argTypes =
              M.fromList
              $ map (\(k, v) -> (T.unpack . fromMaybe "" $ k, v))
              $ maybe einval Xabi.funcArgs $ contract' ^. constructor
              
            typeAndVal =
              M.merge
                (M.mapMissing (curry $ invalidArguments "missing argument"))
                (M.mapMissing (curry $ invalidArguments "extra argument"))
                (M.zipWithMatched $ \_k t v -> (t, v))
                argTypes
                (M.fromList ns)
                         
        forM (M.toList typeAndVal) $ \(n, (Xabi.IndexedType _ t, v)) -> do
          let correctedVal = coerceType contract' t v
          var <- createVar correctedVal
          return (n, (t, var))


  addCallInfo to contract' (contractName' ++ " constructer") hsh cc (M.fromList zipped) False


  forM_ [(n, e) | (n, Xabi.VariableDecl _ _ (Just e)) <- M.toList $ contract'^.storageDefs] $ \(n, e) -> do
    v <- expToVar e
    setVar (Constant (SReference (AccountPath to $ MS.StoragePath [MS.Field $ BC.pack n]))) =<< getVar v

  forM_ [n | (n, Xabi.VariableDecl _ _ Nothing) <- M.toList $ contract'^.storageDefs] $ \n -> do
    markDiffForAction to (MS.StoragePath [MS.Field $ BC.pack n]) MS.BDefault

  forM_ (reverse $ contract'^.parents) $ \parent -> do
    let args = Xabi.OrderedArgs
             . fromMaybe []
             $ M.lookup parent =<< (fmap Xabi.funcConstructorCalls $ contract'^.constructor)
    runTheConstructors from to hsh cc parent args


  _ <-
    case contract'^.constructor of
      Just theFunction -> do
        --argVals <- forM argExps evaluate
        --_ <- call' address contract' theFunction argVals
        commands <- case Xabi.funcContents theFunction of
          Nothing -> missingField "contract constructor has been declared but not defined" contractName'
          Just cms -> pure cms
        _ <- pushSender from $ runStatements commands
        return ()

      Nothing -> return ()

  popCallInfo

  return ()

-- Note: this is intentionally nonstrict in `theType`
addLocalVariable :: MonadSM m => Xabi.Type -> String -> Value -> m ()
addLocalVariable theType name value = do
--  initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack name) value
  newVariable <- liftIO $ fmap Variable $ newIORef value
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    [] -> internalError "addLocalVariable called with an empty stack" (name, value)
    (currentSlice:rest) ->
      Mod.put (Mod.Proxy @[CallInfo]) $
        currentSlice
          { localVariables = M.insert name (theType, newVariable) $
              localVariables currentSlice
          }
        : rest


runTheCall :: MonadSM m
           => Account
           -> Contract
           -> String
           -> Keccak256
           -> CodeCollection
           -> Xabi.Func
           -> ValList
           -> Bool
           -> m (Maybe Value)
runTheCall address' contract' funcName hsh cc theFunction argVals ro = do
  let returns = [(T.unpack n, (t, defaultValue contract' t)) | (Just n, Xabi.IndexedType _ t) <- Xabi.funcVals theFunction]
      args = case argVals of
        OrderedVals vs -> let argMeta = 
                                map (\(n, Xabi.IndexedType _ t) -> (T.unpack $ fromMaybe "" n, t))
                                $ Xabi.funcArgs theFunction
                          in zipWith (\(n, t) v -> (n, (t, v))) argMeta vs
        NamedVals ns ->
          let strTypes = M.mapKeys T.unpack $ M.fromList $ map (\(maybeName, y) -> (fromMaybe "" maybeName, y)) $ Xabi.funcArgs theFunction
              typeAndVal = M.merge (M.mapMissing (curry $ invalidArguments "missing argument"))
                                   (M.mapMissing (curry $ invalidArguments "extra argument"))
                                   (M.zipWithMatched $ \_k t v -> (t, v))
                                   strTypes
                                   $ M.fromList ns
              -- These probably don't need to be sorted by argument index, as they are turned into a map
              -- when added to the call info.
              sortedArgs = map snd . sortWith fst
                         . map (\(n, (Xabi.IndexedType i t, v)) -> (i, (n, (t, v))))
                         $ M.toList typeAndVal
          in sortedArgs
      locals = args ++ returns

  onTraced $ do
    liftIO $ putStrLn $ "            args: " ++ show (map fst args)
    when (not $ null returns) $ liftIO $ putStrLn $ "    named return: " ++ show (map fst returns)
  
  localVars <- 
    forM locals $ \(n, (t, v)) -> do
      newVar <- liftIO $ fmap Variable $ newIORef v
      return (n, (t, newVar))

  addCallInfo address' contract' funcName hsh cc (M.fromList localVars) ro -- [(n, (t, Constant v)) | (n, (t, v)) <- locals]
--  forM_ locals $ \(n, (_, v)) -> do
--    liftIO $ putStrLn "need to initialize the storage 2"
--    initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack n) v
  let !commands = fromMaybe (missingField "function call: function has been declared but not defined" funcName) $ Xabi.funcContents theFunction
  val <- runStatements commands

  let findNamedReturns = do
        case returns of
          [] -> return Nothing
          [(name,_)] -> do -- We have to break this up because
                           -- SolidVM cannot distinguish between
                           -- a value and single-tupled value
            currentCallInfo <- getCurrentCallInfo
            let mReturnVar = M.lookup name $ localVariables currentCallInfo
            case mReturnVar of
              Nothing -> unknownVariable "findNamedReturns" name
              Just returnVar -> Just <$> getVar (snd returnVar)
          xs -> Just . STuple . V.fromList <$> do
            currentCallInfo <- getCurrentCallInfo
            for (fst <$> xs) $ \name -> do
              let mReturnVar = M.lookup name $ localVariables currentCallInfo
              case mReturnVar of
                Nothing -> unknownVariable "findNamedReturns" name
                Just returnVar -> Constant <$> getVar (snd returnVar)

  val' <- case val of
             Nothing -> findNamedReturns
             Just SNULL -> findNamedReturns
             Just{} -> return val
  popCallInfo

  return val'





logAssigningVariable :: MonadSM m => Value -> m ()
logAssigningVariable v = do
  valueString <- showSM v
  onTraced $ liftIO $ putStrLn $ "            %%%% assigning variable: " ++ valueString

logVals :: (Show a, Show b, MonadIO m) => a -> b -> m ()
logVals val1 val2 = onTraced . liftIO $ printf
  "            %%%% val1 = %s\n\
  \            %%%% val2 = %s\n" (show val1) (show val2)

--TODO: It would be nice to hold type information in the return value....  Unfortunately to be backwards compatible with the old API, for now we can not include this.
encodeForReturn :: MonadSM m => Value -> m ByteString

encodeForReturn (SInteger i) = return . word256ToBytes . fromIntegral $ i
encodeForReturn (SEnumVal _ _ v) = return . word256ToBytes . fromIntegral $ v
encodeForReturn (SAccount a) = return . word256ToBytes . fromIntegral $ a ^. namedAccountAddress
encodeForReturn (SContract _ a) = return . word256ToBytes . fromIntegral $ a ^. namedAccountAddress
encodeForReturn (SBool b) = return . word256ToBytes . fromIntegral . fromEnum $ b

-- if it's just a single string, harcode offset as 32 and append strLen + str
encodeForReturn (SString s) = do
  let offset = word256ToBytes $ fromIntegral (32 :: Int)
      encodedLength = word256ToBytes $ fromIntegral (B.length stringBytes)
      retStr = offset `B.append` (encodedLength `B.append` stringBytes)
  return retStr 
  where stringBytes = TE.encodeUtf8 $ T.pack s


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
--                                       (offsetStr1)            (offsetStr2)
--   |     32    |     32    |     32    |    32    | str1EncLen |    32    | str2EncLen |
--   |offset_str1|encoded_int|offset_str2|str1EncLen|   str1Enc  |str2EncLen|   str2Enc  |

encodeForReturn (STuple items) = do
  (headers, strings) <- foldM buildEncoding (B.empty, B.empty) =<< mapM getVar (V.toList items)
  return $ headers `B.append` strings
  where
    headerLen = (V.length items) * 32
    buildEncoding :: MonadSM m => (ByteString, ByteString) -> Value -> m (ByteString, ByteString)
    buildEncoding (headers, strings) val = case val of
      SString s -> do
        let offset = word256ToBytes $ fromIntegral (headerLen + (B.length strings))
            encStr = TE.encodeUtf8 $ T.pack s
            encStrLen = word256ToBytes $ fromIntegral (B.length encStr)
            strBS =  encStrLen `B.append` encStr
        return (headers `B.append` offset, strings `B.append` strBS)
      tup@(STuple _) -> todo "encoding nested tuples as return values" tup 
      v -> do 
        bs <- encodeForReturn v
        return (headers `B.append` bs, strings)

encodeForReturn x = todo "can't encode this return type" x