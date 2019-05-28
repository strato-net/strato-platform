{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ScopedTypeVariables #-}
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
import qualified Blockchain.Database.MerklePatricia   as MP
import           Blockchain.ExtWord
import           Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.SolidVM.Environment       as Env
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.Metrics
import           Blockchain.SolidVM.Model
import           Blockchain.SolidVM.SetGet
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
        argString = T.unpack $ fromMaybe (error "TX is missing metadata parameter called 'args'") maybeArgString
        maybeArgs = runParser parseArgs "" "" argString
        !args = either (parseError "create arguments") id maybeArgs

    (hsh, cc) <- codeCollectionFromSource initCode
    create' sender' hsh cc contractName' args

create' :: Address -> SHA -> CodeCollection -> String -> [Xabi.Expression] -> SM ExecResults
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

  addCallInfo newAddress contract' ch cc M.empty

  forM_ (M.toList $ contract'^.storageDefs) $ \(n, (Xabi.VariableDecl theType _ maybeExpression)) -> do
    let def = defaultValue contract' theType
    initialValue <-
      case maybeExpression of
        Just e -> do
          val <- getVar =<< expToVar e
          case val of
            SInteger i -> return $ coerceFromInt contract' def i
            _ -> return val
        Nothing -> return def
    initializeStorage (AddressedPath (Right newAddress) . MS.singleton $ BC.pack n) initialValue
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
        !args = either (parseError "call arguments") (map (Nothing,)) maybeArgs
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

logFunctionCall :: [(Maybe String, Xabi.Expression)] -> Address -> Contract -> String -> SM (Maybe Value) -> SM (Maybe Value)
logFunctionCall args address contract functionName f = do
  onTraced $ do
    let argStrings = map (unparseExpression . snd) args
    liftIO $ putStrLn $ box $ concat $ map (wrap 150) ["calling function: " ++ format address, (contract^.contractName) ++ "/" ++ functionName ++ "(" ++ intercalate ", " argStrings ++ ")"]

  result <- f

  onTraced $ do
    resultString <-
      case result of
        Nothing -> return ""
        Just v -> showSM v

    liftIO $ putStrLn $ box ["returning from " ++ functionName ++ ":", resultString]


  return result


argsToVals :: Contract -> Xabi.Func -> [(Maybe String, Xabi.Expression)] -> SM [Value]
argsToVals ctract fn = mapM (uncurry eval) . zipWith typeForName orderedTypes
  where typeForName :: Xabi.Type -> (Maybe String, Xabi.Expression) -> (Xabi.Type, Xabi.Expression)
        typeForName t (Nothing, ex) = (t, ex)
        typeForName _ (Just name, _) = todo "argToVals/named arguments" name

        orderedTypes :: [Xabi.Type]
        orderedTypes = map Xabi.indexedTypeType
                     . sortOn Xabi.indexedTypeIndex
                     . M.elems $ Xabi.funcArgs fn

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


callWrapper :: Address -> Address -> Maybe String -> String -> [(Maybe String, Xabi.Expression)] -> SM (Maybe Value)
callWrapper from to mContract functionName argExps = do
  (contract', hsh, cc) <- getCodeAndCollection to
  let contract = fromMaybe contract' $ mContract >>= \c -> M.lookup c $ _contracts cc
  initializeAction to (_contractName contract) hsh
  logFunctionCall argExps to contract functionName $
    case M.lookup functionName $ contract^.functions of
      Just theFunction -> do
        args <- argsToVals contract' theFunction argExps
        (if from == to then id else pushSender from) $ runTheCall to contract hsh cc theFunction args
      _ -> do --Maybe the function is actually a getter
        case M.lookup functionName $ contract^.storageDefs of
          Just _ -> do
            --TODO- this should only exist if the storage variable is declared
            -- "public", right now I just ignore this and allow anything to be called as a getter
            fmap Just $ getVar $ StorageItem $ AddressedPath (Right to) . MS.singleton $ BC.pack functionName
          Nothing -> unknownFunction "logFunctionCall" (functionName, contract^.contractName)


runStatements :: [Xabi.Statement] -> SM (Maybe Value)
runStatements [] = return Nothing
runStatements (s:rest) = do
  onTraced $
    liftIO $ putStrLn $ C.green $ "statement> " ++ unparseStatement s
  ret <- runStatement s
  case ret of
    Nothing -> runStatements rest
    v -> return v


runStatement :: Xabi.Statement -> SM (Maybe Value)
--runStatement x | trace (C.green $ "statement> " ++ unparseStatement x) $ False = undefined
--runStatement x | trace (C.green $ "statement> " ++ show x) $ False = undefined
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



runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement (Xabi.Binary "=" e1 e2))) = do
  p1 <- expToPath e1
  v2 <- expToVar e2
  t1 <- getXabiValueType p1
  case t1 of
    -- Arrays are deep copied when the target is storage
    Xabi.Array{} -> do
      onTraced $ liftIO $ putStrLn $ "Array copy to " ++ show p1
      let p2 = case v2 of
                  StorageItem p2' -> p2'
                  _ -> todo "unhandled array copy" v2
      len <- getInt . StorageItem $ p2 `apSnoc` MS.Field "length"
      setVar (p1 `apSnoc` MS.Field "length") $ SInteger len
      forM_ [0..len-1] $ \i -> do
        let idx = MS.ArrayIndex $ fromIntegral i
        rhs' <- getVar . StorageItem $ p2 `apSnoc` idx
        setVar (p1 `apSnoc` idx) rhs'
    _ -> do
      !value <- getVar v2
      ctract <- getCurrentContract
      onTraced $ liftIO $ putStrLn $ "Variable to set is: " ++ show (p1, value)
      logAssigningVariable value
      -- liftIO $ putStrLn $ "coercion at: " ++ show (p1, t1, value, coerceType t1 value)
      setVar p1 $ coerceType ctract t1 value
  return Nothing
runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement e)) = do
  _ <- getVar =<< expToVar e
  return Nothing -- just throw away the return value

runStatement s@(Xabi.SimpleStatement (Xabi.VariableDefinition maybeType varNames maybeExpression)) = do
  let theType = fromMaybe (todo "type inference not implemented" s) maybeType
  value <-
    case maybeExpression of
      Just e -> do
        rhs <- expToVar e

        let getRef = SReference <$> expToPath e
            getValue = getVar =<< expToVar e
        case (rhs, theType) of
          -- Don't use `getVar` here to avoid infinite recurions
          -- on intended references.
          (Constant c, _) -> return c
          (Variable v, _) -> liftIO $ readIORef v
          (_, Xabi.Array{}) -> getValue
          (_, Xabi.Label name) -> do
            ty <- getTypeOfName name
            case ty of
              StructTypo{} -> getRef
              _ -> getValue
          _ -> getValue

      Nothing ->
        case varNames of
           [Just _] -> do
              ctract <- getCurrentContract
              return $ defaultValue ctract theType
           _ -> internalError "no single name for variable definition" varNames
  onTraced $ do
    valueString <- showSM value
    liftIO $ putStrLn $ "             creating and setting variables: (" ++ intercalate ", " (map (fromMaybe "") varNames) ++ ")"
    liftIO $ putStrLn $ "             to: " ++ valueString

  case (varNames, value) of
    ([Just name], _) -> do
      addLocalVariable theType name value
    (_, STuple variables) -> do
      checkArity "var declaration tuple" (V.length variables) (length varNames)
      forM_ [(n, v) | (Just n, v) <- zip varNames $ V.toList variables] $ \(name', variable') -> do
        value' <- getVar variable'
        addLocalVariable theType name' value'

    _ -> typeError "VariableDefinition expected a tuple" value

  return Nothing

runStatement (Xabi.IfStatement condition code' maybeElseCode) = do
  conditionResult <- getBool =<< expToVar condition
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
    Just e -> fmap Just $ getVar =<< expToVar e
    Nothing -> return $ Just SNULL

runStatement (Xabi.AssemblyStatement (Xabi.MloadAdd32 dst src)) = do
  var <- expToVar $ Xabi.Variable $ T.unpack src;
  path <- expToPath $ Xabi.Variable $ T.unpack dst;
  -- TODO(tim): should this hex encode src and pad?
  setVar path =<< getString var
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
      hasLocalName = x `M.member` localVariables callInfo
  if hasLocalName
    then return $ AddressedPath (Left LocalVar) path
    else return $ AddressedPath (Right $ currentAddress callInfo) path
expToPath x@(Xabi.IndexAccess parent mIndex) = do
  parPath  <- do
    parvar <- expToVar parent
    case parvar of
      StorageItem apt -> return apt
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
      StorageItem p -> return p
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
expToVar' (Xabi.Variable "bytes") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing
expToVar' (Xabi.Variable name) = do
  getVariableOfName name

expToVar' (Xabi.PlusPlus e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var

  logAssigningVariable $ SInteger value

  setVar path $ SInteger $ value + 1
  return $ Constant $ SInteger value

expToVar' (Xabi.Unitary "++" e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var
  let next = SInteger $ value + 1
  logAssigningVariable next

  setVar path next
  return $ Constant next

expToVar' (Xabi.MinusMinus e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var
  logAssigningVariable $ SInteger value
  setVar path . SInteger $ value - 1
  return $ Constant $ SInteger value

expToVar' (Xabi.Unitary "--" e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var
  let next = SInteger $ value -1
  logAssigningVariable next
  setVar path next
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
  var <- expToVar expr

  case var of
    Constant c -> Constant <$> case (c, name) of
      (SEnum enumName, _) -> do
        contract' <- getCurrentContract
        let maybeEnumValues = M.lookup enumName $ contract' ^. enums
            enumVals = fromMaybe (missingType "Enum nonexistent type" enumName) maybeEnumValues
            num = maybe (missingType "Enum nonexistent member" (enumName, name))
                        fromIntegral
                        (name `elemIndex` enumVals)
        return $ SEnumVal enumName name num
      (SBuiltinVariable "msg", "sender") -> (SAddress . Env.sender) <$> getEnv
      (SBuiltinVariable "tx", "origin") -> (SAddress . Env.origin) <$> getEnv
      (SStruct _ theMap, fieldName) ->
        let f = fromMaybe (missingField "struct member access" fieldName)
              $ M.lookup fieldName theMap
        in case f of
             Constant c' -> return c'
             _ -> internalError "constant struct refers to nonconstant" f
      (SContractDef contractName', constName) -> do
        (_, cc) <- getCurrentCodeCollection
        let cont = fromMaybe (missingType "contract function lookup" contractName')
                          (M.lookup contractName' $ cc^.contracts)
        if constName `M.member` _functions cont
          then do
            -- TODO: Check that this contract actually is a contractName'
            addr <- getCurrentAddress
            return $ SContractFunction contractName' addr constName
          else case constName `M.lookup` _constants cont of
                  Nothing -> unknownConstant "constant member access" (contractName', constName)
                  Just (Xabi.ConstantDecl _ _ constExp) -> do
                    getContract constName =<< expToVar constExp

      (SBuiltinVariable "block", "timestamp") -> do
        env' <- getEnv
        return $ SInteger $ round $ utcTimeToPOSIXSeconds $ blockDataTimestamp $ Env.blockHeader env'

      (SBuiltinVariable "block", "number") -> (SInteger . blockDataNumber . Env.blockHeader) <$> getEnv

      (SBuiltinVariable "super", method) -> do
        ctract <- getCurrentContract
        case _parents ctract of
          -- TODO: Is this the correct MRO, or should it scan all ancestors for a match?
          [] -> typeError "cannot use super without a parent contract" (method, ctract)
          ps -> do
            addr <- getCurrentAddress
            return $ SContractFunction (last ps) addr method

      (SAddress addr, itemName) -> return $ SContractItem addr itemName

      (SContract contractName' a, funcName) -> return $ SContractFunction contractName' a funcName
      (SReference p, "push") -> return $ SPush p
      (SReference p, itemName) -> return . SReference $ apSnoc p $ MS.Field $ BC.pack itemName
      (SString s, "length") -> return . SInteger . fromIntegral $ length s
      _ -> error $ "invalid constant: " ++ show c

    Variable vref -> do
      val' <- liftIO $ readIORef vref
      case val' of
        SAddress addr -> return . Constant $ SContractItem addr name
        SStruct _ theMap -> return
                $ fromMaybe (error $ "fetched a struct field that doesn't exist: " ++ name)
                $ M.lookup name theMap
        SReference apt -> do
          return . StorageItem . apSnoc apt . MS.Field $ BC.pack name
        _ -> todo "access member of variable" (val', name)
    StorageItem apt -> case name of
      -- TODO(tim): This will not work correctly with struct fields named push
      "push" -> return . Constant $ SPush apt
      "length" -> do
        ty <- getValueType apt
        case ty of
          TString -> do
            SString s <- getVar var
            return . Constant . SInteger . fromIntegral $ length s
          _ -> return . StorageItem . apSnoc apt $ MS.Field "length"
      _ -> do
          val' <- getVar $ StorageItem apt
          case val' of
            SAddress addr -> return . Constant $ SContractItem addr name
            SContract _ addr -> return . Constant $ SContractItem addr name
            SStruct _ theMap -> return
                $ fromMaybe (error $ "fetched a struct field that doesn't exist: " ++ name)
                $ M.lookup name theMap
            _ -> todo "access member of storage item" (val', name, apt)

expToVar' x@(Xabi.IndexAccess{}) = StorageItem <$> expToPath x

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
  p <- expToPath expr
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
  vars <- for exps expToVar
  return $ Constant $ STuple $ V.fromList vars

expToVar' (Xabi.ArrayExpression exps) = do
  vars <- for exps expToVar
--  return $ Constant $ SArray (error "array type from array literal not known") $ V.fromList vars
  return $ Constant $ SArray (Xabi.Int Nothing Nothing) $ V.fromList vars

expToVar' (Xabi.Ternary condition expr1 expr2) = do
  c <- getBool =<< expToVar condition
  expToVar $ if c then expr1 else expr2

expToVar' (Xabi.FunctionCall (Xabi.NewExpression (Xabi.Array {Xabi.entry=t})) args) = do
  ctract <- getCurrentContract
  case args of
    [(Nothing, a)] -> do
      len <- getInt =<< expToVar a
      return . Constant . SArray t . V.replicate (fromIntegral len) . Constant $ defaultValue ctract t
    _ -> arityMismatch "new array" 1 (length args)
expToVar' (Xabi.FunctionCall (Xabi.NewExpression (Xabi.Label contractName')) args) = do
  creator <- getCurrentAddress
  let argExps = map (\(Nothing, arg) -> arg) args  --TODO- add support for named arguments
  (hsh, cc) <- getCurrentCodeCollection
  incrementNonce creator
  execResults <- create' creator hsh cc contractName' argExps
  return $ Constant $ SContract contractName' $ fromIntegral
    $ fromMaybe (internalError "a call to create did not create an address" execResults)
    $  erNewContractAddress execResults

expToVar' (Xabi.FunctionCall e args) = do
  var <- expToVar e
  argVals <- for args $ \(Nothing, arg) -> getVar =<< expToVar arg --TODO- add support for named arguments
  case var of
    Constant (SReference (AddressedPath address (MS.StoragePath pieces))) -> do
      val' <- getSolid address (MS.StoragePath $ init pieces)
      case (val', last pieces) of
        (MS.BContract _ toAddress, MS.Field funcName) -> do
          fromAddress <- getCurrentAddress
          res <- callWrapper fromAddress toAddress Nothing (BC.unpack funcName) args
          case res of
            Just v -> return $ Constant $ v
            Nothing -> return $ Constant SNULL
        x -> error $ "poppy: " ++ show x

    Constant (SBuiltinFunction name o) -> fmap Constant $ callBuiltin name argVals o
    Constant (SFunction name) -> do
      contract' <- getCurrentContract
      address <- getCurrentAddress
      (hsh, cc) <- getCurrentCodeCollection

      res <- runTheCall address contract' hsh cc name argVals
      case res of
        Just v -> return $ Constant $ v
        Nothing -> return $ Constant SNULL

    Constant (SStructDef structName) -> do
      contract' <- getCurrentContract
      let vals = fromMaybe (missingType "struct constructor not found" structName)
               $ M.lookup structName $ contract'^.structs
      return $ Constant $ SStruct structName $ M.fromList
        $ zip (map (T.unpack . fst) vals) $ map Constant argVals

    Constant (SContractDef contractName') -> do
      case argVals of
        [SInteger address] -> --TODO- clean up this ambiguity between SAddress and SInteger....
          return $ Constant $ SContract contractName' $ Address $ fromInteger address
        [SAddress address ] ->
          return $ Constant $ SContract contractName' address
        [SContract _ addr] ->
          return $ Constant $ SContract contractName' $ addr
        _ -> typeError "contract variable creation" argVals

    Constant (SContractItem address itemName) -> do
      from <- getCurrentAddress
      result <- callWrapper from address Nothing itemName args
      return . Constant . fromMaybe SNULL $ result

    Constant (SContractFunction name address functionName) -> do
      from <- getCurrentAddress
      result <- callWrapper from address (Just name) functionName args
      return . Constant . fromMaybe SNULL $ result

    Constant (SEnum enumName) -> do
      case argVals of
        [SInteger i] -> do
          c <- getCurrentContract
          let theEnum = fromMaybe (missingType "enum constructor" enumName)
                      $ M.lookup enumName $ c^.enums
          return $ Constant $ SEnumVal enumName (theEnum !! fromInteger i) (fromInteger i)
        _ -> typeError "called enum constructor with improper args" argVals

    Constant (SPush apt) -> do
      let lenPath = apt `apSnoc` MS.Field "length"
      len' <- getInt $ StorageItem lenPath
      let len :: Int = fromIntegral len'
          newLen = SInteger $ fromIntegral $ len + 1
          idxPath = apt `apSnoc` MS.ArrayIndex len
      setVar lenPath newLen
      case argVals of
        [av] -> setVar idxPath av
        _ -> arityMismatch "push" (length argVals) 1
      return $ Constant newLen

    Constant SHexDecodeAndTrim ->
        case argVals of
          [s@SString{}] -> return $ Constant s
          -- [SString s] -> return . Constant . SString $
          --   case B16.decode (BC.pack s) of
          --     (b32, "") -> BC.unpack . B.takeWhile (/= 0) $ b32
          --     -- TODO(tim): This is a hack, to deal with the assymmetry created
          --     -- between bytes32 literals (that need no conversion)
          --     -- and bytes32 external arguments (that need decoding and trimming). It
          --     -- would be cleaner to decode arguments in `call`, using `id`
          --     -- on strings and `B16.decode` on bytes32
          --     _ -> s
          _ -> typeError "bytes32ToString with incorrect arguments" argVals

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
  path <- expToPath lhs
  let next = SInteger $ curValue `oper` delta
  setVar path next
  return $ Constant next

callBuiltin :: String -> [Value] -> Maybe Value -> SM Value
callBuiltin "string" [SString s] _ = return $ SString s
callBuiltin "string" vs _ = typeError "string cast" vs
callBuiltin "address" [SInteger a] _ = return . SAddress $ fromIntegral a
callBuiltin "address" [a@SAddress{}] _ = return a
callBuiltin "address" [SContract _ a] _ = return $ SAddress a
callBuiltin "byte" [SInteger n] _ = return $ SInteger (n .&. 0xff)
callBuiltin "byte"  vs _ = typeError "byte cast" vs
callBuiltin "uint" [SEnumVal _ _ enumNum] _ = return . SInteger $ fromIntegral enumNum
callBuiltin "uint" [SInteger n] _ = return $ SInteger n
callBuiltin "uint" [SString hex] _ =
  case B16.decode (BC.pack hex) of
    (l, "") -> return . SInteger . fromIntegral . bytesToWord256 $ l
    _ -> typeError "uint cast - not a hex string" hex

callBuiltin "uint" args _ = typeError "uint cast" args
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


runTheConstructors :: Address -> Address -> SHA -> CodeCollection -> String -> [Xabi.Expression] -> SM ()
runTheConstructors from to hsh cc contractName' argExps = do
  let contract' =
          fromMaybe (missingType "contract inherits from nonexistent parent" contractName')
          $ cc^.contracts . at contractName'
      argPairs = M.toList . fromMaybe M.empty . fmap Xabi.funcArgs $ contract' ^. constructor
      argTypeNames = map fst $ sortWith snd $
        [ ((t, T.unpack n), i) |
          (n, Xabi.IndexedType{Xabi.indexedTypeType=t, Xabi.indexedTypeIndex=i}) <- argPairs]
  onTraced $ liftIO $ putStrLn $ box
    ["running constructor: "++contractName'++"("++intercalate ", " (map snd argTypeNames)++")"]

  argVals <- case argExps of
                  [] -> return []
                  _ -> argsToVals contract'
                                  (fromMaybe (error "arguments provided for missing constructor")
                                        $ _constructor contract')
                                  $ map (Nothing,) argExps

  let zipped = zipWith (\(t, n) v -> (n, (t, coerceType contract' t v))) argTypeNames argVals
  addCallInfo to contract' hsh cc . fmap (fmap Constant) $ M.fromList zipped
  mapM_ (\(n, (_, v)) -> initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack n) v) zipped

  forM_ (reverse $ contract'^.parents) $ \parent -> do
    let args = fromMaybe []
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
  initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack name) value
  newVariable <- liftIO $ fmap Variable $ newIORef value
  sstate <- get
  case callStack sstate of
    [] -> internalError "addLocalVariable called with an empty stack" (name, value)
    (currentSlice:rest) ->
      put sstate
          {callStack = currentSlice{localVariables=M.insert name (theType, newVariable) $ localVariables currentSlice}:rest}


runTheCall :: Address -> Contract -> SHA -> CodeCollection -> Xabi.Func -> [Value] -> SM (Maybe Value)
runTheCall address' contract' hsh cc theFunction argVals = do
  --
  let returnMeta = map (\(n, Xabi.IndexedType _ t) -> (T.unpack n, t)) .  M.toList $ Xabi.funcVals theFunction
      returns = map (\(n, t) -> (n, (t, defaultValue contract' t))) returnMeta
      argMeta = map fst . sortWith snd
              . map (\(n, Xabi.IndexedType i t) -> ((T.unpack n, t), i))
              . M.toList $ Xabi.funcArgs theFunction
      args = zipWith (\(n, t) v -> (n, (t, v))) argMeta argVals
      locals = args ++ returns

  onTraced $ liftIO $ putStrLn $ "            args: " ++ show (map fst args)
  onTraced $ liftIO $ putStrLn $ "    named return: " ++ show (map fst returns)

  addCallInfo address' contract' hsh cc $ M.fromList [(n, (t, Constant v)) | (n, (t, v)) <- locals]
  forM_ locals $ \(n, (_, v)) -> do
    initializeStorage (AddressedPath (Left LocalVar) . MS.singleton $ BC.pack n) v
  let Just commands = Xabi.funcContents theFunction
  val <- runStatements commands
  let findNamedReturns = do
        let paths = map (AddressedPath (Left LocalVar) . MS.singleton . BC.pack . fst) returns
        rs <- mapM (getVar . StorageItem) paths
        case rs of
          [] -> return Nothing
          [x] -> return $ Just x
          _ -> todo "multiple named return values" rs
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
logVals val1 val2 = onTraced . liftIO . putStrLn $ printf
  "            %%%% val1 = %s\n\
  \            %%%% val2 = %s" (show val1) (show val2)

--TODO- It would be nice to hold type information in the return value....  Unfortunately to be backwards compatible with the old API, for now we can not include this.
encodeForReturn :: Value -> SM ByteString
encodeForReturn (SInteger i) = return . word256ToBytes . fromIntegral $ i
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
