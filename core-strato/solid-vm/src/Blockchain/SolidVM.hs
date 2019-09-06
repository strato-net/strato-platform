{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM
    (
      call
    , create
    ) where

import           Control.Lens hiding (assign, from, to)
import           Control.Monad
import qualified Control.Monad.Change.Alter           as A
import           Control.Monad.IO.Class
import           Control.Monad.Trans.State
import           Data.Bits
import           Data.ByteString                      (ByteString)
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Base16               as B16
import qualified Data.ByteString.Char8                as BC
import qualified Data.ByteString.Short                as BSS
import           Data.IORef
import           Data.List
import qualified Data.Map                             as M
import qualified Data.Map.Merge.Lazy                  as M
import           Data.Maybe
import qualified Data.Set                             as S
import qualified Data.Text                            as T
import           Data.Time.Clock.POSIX
import           Data.Traversable
import qualified Data.Vector as V
import           GHC.Exts
import           Text.Parsec (runParser)
import           Text.Printf

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Code
import           Blockchain.Data.ExecResults
import           Blockchain.Data.Event
import qualified Blockchain.Database.MerklePatricia   as MP
import           Blockchain.ExtWord
import qualified Blockchain.SolidVM.Builtins          as Builtins
import           Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.SolidVM.Environment       as Env
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.Metrics
import           Blockchain.SolidVM.Model
import           Blockchain.SolidVM.SetGet
import           Blockchain.SolidVM.TraceTools
import           Blockchain.SolidVM.Value
import           Blockchain.SHA
import           Blockchain.Strato.Model.Gas
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

import           CodeCollection


onTraced :: Monad m => m () -> m ()
onTraced = when flags_svmTrace


create :: Bool
       -> Bool
       -> S.Set Address
       -> BlockData
       -> Int
       -> Address
       -> Address
       -> Integer
       -> Integer
       -> Gas
       -> Address
       -> Code
       -> SHA
       -> Maybe Word256
       -> Maybe (M.Map T.Text T.Text)
       -> ContextM ExecResults
--create isRunningTests' isHomestead preExistingSuicideList b callDepth sender origin
--       value gasPrice availableGas newAddress initCode txHash chainId metadata =
create _ _ _ _ _ _ _ _ _ _ _ pc@(PrecompiledCode _) _ _ _ = internalError "call precompiled code" pc
create _ _ _ blockData _ sender' origin' _ _ _ _ (Code initCode) txHash' chainId' metadata = do
  recordCreate
  let env' = Env.Environment {
        Env.blockHeader = blockData,
        Env.sender = sender',
        Env.origin = origin',
        Env.txHash=txHash',
        Env.chainId=chainId',
        Env.metadata=metadata
      }
  fmap (either solidvmErrorResults id) . runSM (Just initCode) env' $ do
    let maybeContractName = M.lookup "name" =<< metadata
        !contractName' = T.unpack $ fromMaybe (error "TX is missing a metadata parameter called 'name'") maybeContractName

    let maybeArgString = M.lookup "args" =<< metadata
        argString = maybe "()" T.unpack maybeArgString
        maybeArgs = runParser parseArgs "" "" argString
        !args = either (parseError "create arguments") Xabi.OrderedArgs maybeArgs

    (hsh, cc) <- codeCollectionFromSource initCode
    create' sender' hsh cc contractName' args

create' :: Address -> SHA -> CodeCollection -> String -> Xabi.ArgList -> SM ExecResults
create' creator ch cc contractName' argExps = do
  newAddress <- getNewAddress creator

  initializeAction newAddress contractName' ch

  A.adjustWithDefault_ (A.Proxy @AddressState) newAddress $ \newAddressState ->
    pure newAddressState{ addressStateContractRoot = MP.emptyTriePtr
                        , addressStateCodeHash = SolidVMCode contractName' ch
                        }

  onTraced $ liftIO $ putStrLn $ C.red $ "Creating Contract: " ++ show newAddress ++ " of type " ++ contractName'

  let contract' = fromMaybe (missingType "create'/contract" contractName') (cc ^. contracts . at contractName')

  -- Add Storage

  addCallInfo newAddress contract' (contractName' ++ " constructor") ch cc M.empty

  popCallInfo

  -- Run the constructor
  runTheConstructors creator newAddress ch cc contractName' argExps

  onTraced $ liftIO $ putStrLn $ C.red $ "Done Creating Contract: " ++ show newAddress ++ " of type " ++ contractName'

  sstate <- get

  return ExecResults {
    erRemainingTxGas = 0, --Just use up all the allocated gas for now....
    erRefund = 0,
    erReturnVal = Just BSS.empty,
    erTrace = [],
    erLogs = [],
    erNewContractAddress = Just newAddress,
    erSuicideList = S.empty,
    erAction = Just $ sstate ^. action,
    erException = Nothing,
    erKind = SolidVM
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

call :: Bool
     -> Bool
     -> Bool
     -> S.Set Address
     -> BlockData
     -> Int
     -> Address
     -> Address
     -> Address
     -> Word256
     -> Word256
     -> B.ByteString
     -> Gas
     -> Address
     -> SHA
     -> Maybe Word256
     -> Maybe (M.Map T.Text T.Text)
     -> ContextM ExecResults
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
        !funcName = T.unpack $ fromMaybe (error "TX is missing a metadata parameter called 'funcName'") maybeFuncName
        maybeArgString = M.lookup "args" =<< metadata
        argString = T.unpack $ fromMaybe (error "TX is missing metadata parameter called 'args'") maybeArgString
        maybeArgs = runParser parseArgs "" "" argString
        !args = either (parseError "call arguments") Xabi.OrderedArgs maybeArgs
    returnVal <- mapM encodeForReturn =<< callWrapper sender' codeAddress Nothing funcName args
    finalAct <- use action
    return $ ExecResults {
      erRemainingTxGas = 0, --Just use up all the allocated gas for now....
      erRefund = 0,
      erReturnVal = BSS.toShort <$> returnVal,
      erTrace = [],
      erLogs = [],
      erNewContractAddress = Nothing,
      erSuicideList = S.empty,
      erAction = Just $ finalAct,
      erException = Nothing,
      erKind = SolidVM
      }


getCodeAndCollection :: Address -> SM (Contract, SHA, CodeCollection)
getCodeAndCollection address' = do
  callStack' <- fmap callStack get
  let maybeAddress =
        case callStack' of
          (current:_) -> Just $ currentAddress current
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

    (contractName', ch, cc) <-
      case codeHash of
        SolidVMCode cn ch' -> do
          cc' <- codeCollectionFromHash ch'
          return (cn, ch', cc')
        ch -> internalError "SolidVM for non-solidvm code" ch


    let contract' = fromMaybe (missingType "getCodeAndCollection" contractName') $ M.lookup contractName' $ cc^.contracts

    return (contract', ch, cc)

logFunctionCall :: ValList -> Address -> Contract -> String -> SM (Maybe Value) -> SM (Maybe Value)
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


argsToVals :: Contract -> Xabi.Func -> Xabi.ArgList -> SM ValList
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

        eval :: Xabi.Type -> Xabi.Expression -> SM Value
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


callWrapper :: Address -> Address -> Maybe String -> String -> Xabi.ArgList -> SM (Maybe Value)
callWrapper from to mContract functionName argExps = do
  (contract', hsh, cc) <- getCodeAndCollection to
  let contract = fromMaybe contract' $ mContract >>= \c -> M.lookup c $ _contracts cc
  initializeAction to (_contractName contract) hsh

  let functionsIncludingConstructor =
        case contract^.constructor of
          Nothing -> contract^.functions
          Just c -> M.insert "<constructor>" c $ contract^.functions

  (f, args) <-
        case M.lookup functionName functionsIncludingConstructor of
          Just theFunction -> do
            args' <- argsToVals contract' theFunction argExps
            let f' = (if from == to then id else pushSender from) $ runTheCall to contract functionName hsh cc theFunction args'
            return (f', args')
          _ -> do --Maybe the function is actually a getter
            case M.lookup functionName $ contract^.storageDefs of
              Just _ -> do
                --TODO- this should only exist if the storage variable is declared
                -- "public", right now I just ignore this and allow anything to be called as a getter
                return (fmap Just $ getVar $ Constant $ SReference $ AddressedPath to . MS.singleton $ BC.pack functionName, OrderedVals [])
              Nothing -> unknownFunction "logFunctionCall" (functionName, contract^.contractName)



  logFunctionCall args to contract functionName f


runStatements :: [Xabi.Statement] -> SM (Maybe Value)
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


runStatement :: Xabi.Statement -> SM (Maybe Value)
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


runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement (Xabi.Binary "=" dst src))) = do
  srcVal <- getVar =<< expToVar src
  dstVar <- expToVar dst

  setVar dstVar srcVal
  
  onTraced $ do
    valString <- showSM srcVal
    liftIO $ putStrLn $ "    Setting: " ++ unparseExpression dst ++ " = " ++ valString
              
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
runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement e)) = do
  _ <- getVar =<< expToVar e
  return Nothing -- just throw away the return value

runStatement s@(Xabi.SimpleStatement (Xabi.VariableDefinition entries maybeExpression)) = do
  let maybeLoc = case entries of
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
    liftIO $ printf "             creating and setting variables: (%s)\n" $
        intercalate ", " (map toName entries)
    liftIO $ printf "             to: %s\n" valueString
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

runStatement (Xabi.IfStatement condition code' maybeElseCode) = do
  conditionResult <- getBool =<< expToVar condition
  
  onTraced $ do
    if conditionResult
      then liftIO $ putStrLn "       if condition succeeded, running internal code"
      else liftIO $ putStrLn "       if condition failed, skipping internal code"
    
  if conditionResult
    then runStatements code'
    else case maybeElseCode of
      Just elseCode -> runStatements elseCode
      Nothing -> return Nothing

--TODO- all the variables declared in an `if` or `for` code block need to be deleted when the block is finished....
runStatement (Xabi.ForStatement maybeInitStatement maybeConditionExp maybeLoopExp code) = do
  _ <-
    case maybeInitStatement of
      Just initStatement -> runStatement $ Xabi.SimpleStatement initStatement
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
      onTraced $ liftIO $ putStrLn $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
      result <- runStatements code
      _ <- getVar =<< expToVar loopExp
      return result

runStatement (Xabi.Return maybeExpression) = do
  case maybeExpression of
    Just e -> do
      ql <- expToVar e
      qlql <- getVar ql
      return $ Just qlql
--      fmap Just $ getVar =<< expToVar e
    Nothing -> return $ Just SNULL

runStatement (Xabi.AssemblyStatement (Xabi.MloadAdd32 dst src)) = do
  srcVar <- expToVar $ Xabi.Variable $ T.unpack src;
  dstVar <- expToVar $ Xabi.Variable $ T.unpack dst;

  -- TODO(tim): should this hex encode src and pad?
  setVar dstVar =<< getString srcVar
  return Nothing

runStatement (Xabi.EmitStatement eventName exptups) = do
  exps <- mapM (expToVar . snd) exptups
  expVals <- mapM (getVar) exps

  liftIO $ putStrLn $ "emit " ++ eventName ++ "(" ++ (intercalate ", " (map show expVals)) ++ ");"
  addEvent $ Event eventName (map show expVals)
  return Nothing

runStatement x = error $ "unknown statement in call to runStatement: " ++ show x

while :: SM Bool -> SM (Maybe Value) -> SM (Maybe Value)
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

getIndexType :: AddressedPath -> SM IndexType
getIndexType (AddressedPath addr p) = do
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
         Xabi.Mapping{Xabi.key=Xabi.Address{}} -> MapAddressIndex
         Xabi.Mapping{Xabi.key=Xabi.Bool{}} -> MapBoolIndex
         Xabi.Array{} -> ArrayIndex
         _ -> todo "unanticipated index type" t
       loop n t = case t of
         Xabi.Mapping{Xabi.value=t'} -> loop (n - 1) t'
         Xabi.Array{Xabi.entry=t'} -> loop (n - 1) t'
         _ -> typeError "indexing type in var dec" t



expToPath :: Xabi.Expression -> SM AddressedPath
expToPath (Xabi.Variable x) = do
  callInfo <- getCurrentCallInfo
  let path = MS.singleton $ BC.pack x
  case x `M.lookup` localVariables callInfo of
    Just (_, var) -> do
      val <- weakGetVar var
      case val of
        SReference apt -> return apt
        _ -> error "expToPath should never be called for a local variable"
    Nothing -> return $ AddressedPath (currentAddress callInfo) path
expToPath x@(Xabi.IndexAccess parent mIndex) = do
  parPath  <- do
    parvar <- expToVar parent
    case parvar of
      Constant (SReference apt) -> return apt
      _ -> expToPath parent

  idxType <- getIndexType parPath
  idxVar <- maybe (typeError "empty index is only valid at type level" x) expToVar mIndex
  apSnoc parPath <$> case idxType of
    MapAddressIndex -> do
      idx <- getAddress idxVar
      return $ case idx of
        SAddress a -> MS.MapIndex $ MS.IAddress a
        SInteger i -> MS.MapIndex $ MS.IAddress $ fromIntegral i
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
        SString s -> MS.MapIndex $ MS.IText $ BC.pack s
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

expToVar :: Xabi.Expression -> SM Variable
expToVar x = do
  v <- expToVar' x
  return v

expToVar' :: Xabi.Expression -> SM Variable
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

expToVar' (Xabi.Binary "+=" lhs rhs) = binopAssign (+) lhs rhs
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

expToVar' (Xabi.MemberAccess expr name) = do
  val <- getVar =<< expToVar expr

  case (val, name) of
--    Constant c -> case (c, name) of
      (SEnum enumName, _) -> do
        contract' <- getCurrentContract
        let maybeEnumValues = M.lookup enumName $ contract' ^. enums
            enumVals = fromMaybe (missingType "Enum nonexistent type" enumName) maybeEnumValues
            num = maybe (missingType "Enum nonexistent member" (enumName, name))
                        fromIntegral
                        (name `elemIndex` enumVals)
        return $ Constant $ SEnumVal enumName name num
      (SBuiltinVariable "msg", "sender") -> (Constant . SAddress . Env.sender) <$> getEnv
      (SBuiltinVariable "tx", "origin") -> (Constant . SAddress . Env.origin) <$> getEnv
      (SStruct _ theMap, fieldName) ->
        return $ fromMaybe (missingField "struct member access" fieldName)
                  $ M.lookup fieldName theMap
      (SContractDef contractName', constName) -> do
        --TODO- move all variable name resolution by contract to a function
        (_, cc) <- getCurrentCodeCollection
        let cont = fromMaybe (missingType "contract function lookup" contractName')
                          (M.lookup contractName' $ cc^.contracts)
        if constName `M.member` _functions cont
          then do
            -- TODO: Check that this contract actually is a contractName'
            addr <- getCurrentAddress
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
            addr <- getCurrentAddress
            return $ Constant $ SContractFunction (Just $ _contractName $ last ps) addr method

      (SAddress addr, itemName) -> return $ Constant $ SContractItem addr itemName

      (SContract _ a, funcName) -> return $ Constant $ SContractFunction Nothing a funcName
      (r@(SReference _), "push") -> return $ Constant $ SPush r
      (a@(SArray _ _), "push") -> return $ Constant $ SPush a
      (SArray _ theVector, "length") -> return $ Constant $ SInteger $ fromIntegral $ V.length theVector
      (SString s, "length") -> return . Constant . SInteger . fromIntegral $ length s
      (SReference apt, "length") -> do
        ty <- getValueType apt
        case ty of
          TString -> do
            SString s <- return val
            return . Constant . SInteger . fromIntegral $ length s
          _ -> return . Constant . SReference . apSnoc apt $ MS.Field "length"

      (SReference p, itemName) -> return . Constant . SReference $ apSnoc p $ MS.Field $ BC.pack itemName
      _ -> error $ "unhandled case in expToVar' for MemberAccess: " ++ show val
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
          return $ theVector V.! fromIntegral i
        (SReference _, _) -> Constant . SReference <$> expToPath x
        _ -> error $ "expToVar' called for IndexAccess with unsupported types:\nval = " ++ show val ++ "\ntheIndex = " ++ show theIndex
--    _ -> error $ "unknown case in expToVar' for IndexAccess: " ++ show var


expToVar' (Xabi.Binary "+" expr1 expr2) = expToVarInteger expr1 (+) expr2 SInteger
expToVar' (Xabi.Binary "-" expr1 expr2) = expToVarInteger expr1 (-) expr2 SInteger
expToVar' (Xabi.Binary "*" expr1 expr2) = expToVarInteger expr1 (*) expr2 SInteger
expToVar' (Xabi.Binary "/" expr1 expr2) = expToVarInteger expr1 div expr2 SInteger
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
  b2 <- getBool =<< expToVar expr2
  logVals b1 b2
  return $ Constant $ SBool $ b1 && b2

expToVar' (Xabi.Binary "||" expr1 expr2) = do
  b1 <- getBool =<< expToVar expr1

  b2 <- getBool =<< expToVar expr2
  logVals b1 b2
  return $ Constant $ SBool $ b1 || b2

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
  creator <- getCurrentAddress
  (hsh, cc) <- getCurrentCodeCollection
  incrementNonce creator
  execResults <- create' creator hsh cc contractName' args
  return $ Constant $ SContract contractName' $ fromIntegral
    $ fromMaybe (internalError "a call to create did not create an address" execResults)
    $  erNewContractAddress execResults

expToVar' (Xabi.FunctionCall e args) = do
  var <- expToVar e
  argVals <- case args of
                 Xabi.OrderedArgs as -> OrderedVals <$> mapM (getVar <=< expToVar) as
                 Xabi.NamedArgs ns -> NamedVals <$> mapM (mapM $ getVar <=< expToVar) ns

  case var of
    Constant (SReference (AddressedPath address (MS.StoragePath pieces))) -> do
      val' <- getVar $ Constant $ SReference $ AddressedPath address $MS.StoragePath $ init pieces
      case (val', last pieces) of
        (SContract _ toAddress, MS.Field funcName) -> do
          fromAddress <- getCurrentAddress
          res <- callWrapper fromAddress toAddress Nothing (BC.unpack funcName) args
          case res of
            Just v -> return $ Constant $ v
            Nothing -> return $ Constant SNULL
        (SAddress toAddress, MS.Field funcName) -> do
          fromAddress <- getCurrentAddress
          res <- callWrapper fromAddress toAddress Nothing (BC.unpack funcName) args
          case res of
            Just v -> return $ Constant $ v
            Nothing -> return $ Constant SNULL
        x -> todo "expToVar'/FunctionCall" x

    Constant (SBuiltinFunction name o) -> case argVals of
      OrderedVals vs -> Constant <$> callBuiltin name vs o
      NamedVals{} -> invalidArguments (printf "expToVar'/builtinfunction: cannot used namedvals with builtin %s" name) argVals


    Constant (SFunction funcName func) -> do
      contract' <- getCurrentContract
      address <- getCurrentAddress
      (hsh, cc) <- getCurrentCodeCollection

      res <- runTheCall address contract' funcName hsh cc func argVals
      return . Constant . fromMaybe SNULL $ res

    Constant (SStructDef structName) -> do
      contract' <- getCurrentContract
      let vals = fromMaybe (missingType "struct constructor not found" structName)
               $ M.lookup structName $ contract'^.structs
      return . Constant . SStruct structName . fmap Constant . M.fromList $
        case argVals of
          OrderedVals as -> zip (map (T.unpack . fst) vals) as
          NamedVals ns -> ns

    Constant (SContractDef contractName') -> do
      case argVals of
        OrderedVals [SInteger address] -> --TODO- clean up this ambiguity between SAddress and SInteger....
          return $ Constant $ SContract contractName' $ Address $ fromInteger address
        OrderedVals [SAddress address ] -> 
          return $ Constant $ SContract contractName' address
        OrderedVals [SContract _ addr] ->
          return $ Constant $ SContract contractName' $ addr
        _ -> typeError "contract variable creation" argVals

    Constant (SContractItem address itemName) -> do

      from <- getCurrentAddress
      result <- callWrapper from address Nothing itemName args
      return . Constant . fromMaybe SNULL $ result

    Constant (SContractFunction name address functionName) -> do
      from <- getCurrentAddress
      result <- callWrapper from address name functionName args
      return . Constant . fromMaybe SNULL $ result

    Constant (SEnum enumName) -> do
      case argVals of
        OrderedVals [SInteger i] -> do
          c <- getCurrentContract
          let theEnum = fromMaybe (missingType "enum constructor" enumName)
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
        OrderedVals [SAddress a] -> return . Constant . SString $ show a
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

expToVarInteger :: Xabi.Expression -> (Integer->Integer->a) -> Xabi.Expression -> (a->Value) -> SM Variable
expToVarInteger expr1 o expr2 retType = do
  i1 <- getInt =<< expToVar expr1
  i2 <- getInt =<< expToVar expr2
  return . Constant . retType $ i1 `o` i2


binopAssign :: (Integer -> Integer -> Integer) -> Xabi.Expression -> Xabi.Expression -> SM Variable
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

callBuiltin :: String -> [Value] -> Maybe Value -> SM Value
callBuiltin "string" [SString s] _ = return $ SString s
callBuiltin "string" vs _ = typeError "string cast" vs
callBuiltin "address" [SInteger a] _ = return . SAddress $ fromIntegral a
callBuiltin "address" [a@SAddress{}] _ = return a
callBuiltin "address" [SContract _ a] _ = return $ SAddress a
callBuiltin "byte" [SInteger n] _ = return $ SInteger (n .&. 0xff)
callBuiltin "byte"  vs _ = typeError "byte cast" vs
callBuiltin "uint" args _ = return $ intBuiltin args
callBuiltin "int" args _ = return $ intBuiltin args
callBuiltin "push" [v] (Just o) = typeError "push (called as func, not as method)" (v, o)
callBuiltin "identity" [v] Nothing = return v
callBuiltin "keccak256" [SString buf] Nothing = do
  return . SString . BC.unpack . keccak256 . BC.pack $ buf
callBuiltin "require" (SBool cond :msg) Nothing = do
  case msg of
    [] -> require cond Nothing
    (m:_) -> require cond (Just $ show m)
  return SNULL
callBuiltin x _ _ = unknownFunction "callBuiltin" x


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


runTheConstructors :: Address -> Address -> SHA -> CodeCollection -> String -> Xabi.ArgList -> SM ()
runTheConstructors from to hsh cc contractName' argExps = do
  let contract' =
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
                                  (fromMaybe (error "arguments provided for missing constructor")
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


  addCallInfo to contract' (contractName' ++ " constructer") hsh cc $ M.fromList zipped


  forM_ [(n, e) | (n, Xabi.VariableDecl _ _ (Just e)) <- M.toList $ contract'^.storageDefs] $ \(n, e) -> do
    v <- expToVar e
    setVar (Constant (SReference (AddressedPath to $ MS.StoragePath [MS.Field $ BC.pack n]))) =<< getVar v

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
        let Just commands = Xabi.funcContents theFunction
        _ <- pushSender from $ runStatements commands
        return ()

      Nothing -> return ()

  popCallInfo

  return ()

-- Note: this is intentionally nonstrict in `theType`
addLocalVariable :: Xabi.Type -> String -> Value -> SM ()
addLocalVariable theType name value = do
--  initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack name) value
  newVariable <- liftIO $ fmap Variable $ newIORef value
  sstate <- get
  case callStack sstate of
    [] -> internalError "addLocalVariable called with an empty stack" (name, value)
    (currentSlice:rest) ->
      put sstate
          {callStack = currentSlice{localVariables=M.insert name (theType, newVariable) $ localVariables currentSlice}:rest}


runTheCall :: Address -> Contract -> String -> SHA -> CodeCollection -> Xabi.Func -> ValList -> SM (Maybe Value)
runTheCall address' contract' funcName hsh cc theFunction argVals = do
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

  addCallInfo address' contract' funcName hsh cc $ M.fromList localVars -- [(n, (t, Constant v)) | (n, (t, v)) <- locals]
--  forM_ locals $ \(n, (_, v)) -> do
--    liftIO $ putStrLn "need to initialize the storage 2"
--    initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack n) v
  let Just commands = Xabi.funcContents theFunction
  val <- runStatements commands

  let findNamedReturns = do
        case returns of
          [] -> return Nothing
          [(name, _)] -> do
            currentCallInfo <- getCurrentCallInfo
            let Just returnVar = M.lookup name $ localVariables currentCallInfo -- the value must exist in the map, else there is a developer error
            fmap Just $ getVar $ snd returnVar
          _ -> todo "multiple named return values" returns

  val' <- case val of
             Nothing -> findNamedReturns
             Just SNULL -> findNamedReturns
             Just{} -> return val
  popCallInfo

  return val'









logAssigningVariable :: Value -> SM ()
logAssigningVariable v = do
  valueString <- showSM v
  onTraced $ liftIO $ putStrLn $ "            %%%% assigning variable: " ++ valueString

logVals :: (Show a, Show b) => a -> b -> SM ()
logVals val1 val2 = onTraced . liftIO $ printf
  "            %%%% val1 = %s\n\
  \            %%%% val2 = %s\n" (show val1) (show val2)

--TODO- It would be nice to hold type information in the return value....  Unfortunately to be backwards compatible with the old API, for now we can not include this.
encodeForReturn :: Value -> SM ByteString
encodeForReturn (SInteger i) = return . word256ToBytes . fromIntegral $ i
encodeForReturn (SEnumVal _ _ v) = return . word256ToBytes . fromIntegral $ v
encodeForReturn (SAddress a) = return . word256ToBytes . fromIntegral $ a
encodeForReturn (SContract _ a) = return . word256ToBytes . fromIntegral $ a
encodeForReturn (SBool b) = return . word256ToBytes . fromIntegral . fromEnum $ b
encodeForReturn (SString s) =
  -- TODO: Wings expects all return values as bytes32 and never string.
  -- This will have to be changed when wings drops bytes32 usage, or to support
  -- string returning applications as well.
  return $ stringBytes `B.append` B.replicate (32 - B.length stringBytes) 0
  where stringBytes = BC.pack s
encodeForReturn (STuple items) = B.concat <$> forM (V.toList items) (encodeForReturn <=< getVar)
encodeForReturn x = todo "encodeForReturn type case" x
