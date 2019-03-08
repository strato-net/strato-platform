{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.SolidVM
    (
      call
    , create
    ) where

import           Control.Lens hiding (assign)
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.State
import           Data.Bits
import           Data.ByteString                      (ByteString)
import qualified Data.ByteString                      as B
import qualified Data.ByteString.Char8                as BC
import qualified Data.ByteString.Short                   as BSS
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
import           Text.Parsec
import           Text.Printf

import qualified Blockchain.Colors                    as C
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Code
import           Blockchain.Data.ExecResults
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.SolidStorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.SetGet
import           Blockchain.SolidVM.Value
import           Blockchain.SHA
import           Blockchain.Strato.Model.Gas
import           Blockchain.VMContext
import           Blockchain.SolidVM.SM

import qualified SolidVM.Model.Storable as MS

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Parse.Statement
import           SolidVM.Solidity.Parse.UnParser (unparseStatement)
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Statement as Xabi
import qualified SolidVM.Solidity.Xabi.Type as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

import           CodeCollection




trace :: Bool
trace = True

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
create _ _ _ blockData _ sender' _ _ _ _ _ (Code initCode) _ _ metadata = do

  let maybeContractName = join $ fmap (M.lookup "name") metadata
      contractName' = T.unpack $ fromMaybe (error "TX is missing a metadata parameter called 'name'") maybeContractName

  let maybeArgString = join $ fmap (M.lookup "args") metadata
      argString = T.unpack $ fromMaybe (error "TX is missing metadata parameter called 'args'") maybeArgString
      maybeArgs = runParser parseArgs "" "" argString
      args = either (error . (++ ("\nfull args: " ++ show argString)) . ("args can not be parsed: " ++) . show) id maybeArgs
      maybeFile = runParser solidityFile "" "" $ BC.unpack initCode
      file =
        case maybeFile of
          Left e -> error $ show e
          Right v -> v

      namedContracts = [(T.unpack name, xabiToContract (T.unpack name) (map T.unpack parents') xabi) | NamedXabi name (xabi, parents') <- unsourceUnits file]

      cc = applyInheritence
        $ CodeCollection {
            _contracts=M.fromList namedContracts
          }


  runSM blockData $ do
    create' sender' cc contractName' args

create' :: Address -> CodeCollection -> String -> [Xabi.Expression] -> SM ExecResults
create' creator cc contractName' argExps = do
  nonce' <- fmap addressStateNonce $ getAddressState creator
  let newAddress = getNewAddress_unsafe creator nonce'
      ccString = BC.pack $ show cc

  newAddressState <- getAddressState newAddress
  putAddressState newAddress newAddressState{addressStateContractRoot=MP.emptyTriePtr, addressStateCodeHash=SolidVMCode contractName' $ hash ccString}

  addCode SolidVM ccString

  when trace $ liftIO $ putStrLn $ C.red $ "Creating Contract: " ++ show newAddress ++ " of type " ++ contractName'

  let contract' = fromMaybe (missingType "create'/contract" contractName') (cc ^. contracts . at contractName')

  -- Add Storage

  addCallInfo newAddress contract' cc M.empty

  forM_ (M.toList $ contract'^.storageDefs) $ \(n, (Xabi.VariableDecl theType _ maybeExpression)) -> do
    initialValue <-
      case maybeExpression of
        Just e -> getVar =<< expToVar e
        Nothing -> return $ defaultValue theType
    let fieldName :: MS.StoragePath -> MS.StoragePath
        fieldName = (MS.Field (BC.pack n):)
    -- TODO: It might make more sense to just leave it at BDefault and
    -- determine the result from that
    kvs <- case initialValue of
             SArray _ iv -> if V.null iv then return [(fieldName [MS.Field "length"], MS.BInteger 0)]
                                         else todo "initialized array storage" initialValue
             SMap _ im -> if M.null im then return [(fieldName [], MS.BDefault)]
                                       else todo "initialize map storage " initialValue
             SStruct _ fs -> forM (M.toList fs) $
                 \(f, var) -> ((fieldName [MS.Field $ BC.pack f],) . toBasic) <$> getVar var

             x -> return [(fieldName [], toBasic x)]
    mapM_ (uncurry $ putSolidStorageKeyVal' newAddress) kvs
  popCallInfo

  -- Run the constructor
  runTheConstructors cc newAddress contractName' argExps

  when trace $ liftIO $ putStrLn $ C.red $ "Done Creating Contract: " ++ show newAddress ++ " of type " ++ contractName'

  return ExecResults {
    erRemainingTxGas = 0, --Just use up all the allocated gas for now....
    erRefund = 0,
    erReturnVal = Just BSS.empty,
    erTrace = [],
    erLogs = [],
    erNewContractAddress = Just newAddress,
    erSuicideList = S.empty,
    erAction = Nothing,
    erException = Nothing
    }




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

call _ _ _ _ blockData _ _ codeAddress _ _ _ _ _ _ _ _ metadata = do

  let maybeFuncName = join $ fmap (M.lookup "funcName") metadata
      funcName = T.unpack $ fromMaybe (error "TX is missing a metadata parameter called 'funcName'") maybeFuncName
      maybeArgString = join $ fmap (M.lookup "args") metadata
      argString = T.unpack $ fromMaybe (error "TX is missing metadata parameter called 'args'") maybeArgString
      maybeArgs = runParser parseArgs "" "" argString
      args = either (error . (++ ("\nfull args: " ++ show argString)) . ("args can not be parsed: " ++) . show) id maybeArgs

  encodedReturnValue <- runSM blockData $ do
           argValues <- forM args $ \arg -> getVar =<< expToVar arg
           maybeRet <- call'' codeAddress funcName argValues
           case maybeRet of
             Just x -> fmap Just $ encodeForReturn x
             Nothing -> return Nothing

  return ExecResults {
    erRemainingTxGas = 0, --Just use up all the allocated gas for now....
    erRefund = 0,
    erReturnVal = fmap BSS.toShort encodedReturnValue,
    erTrace = [],
    erLogs = [],
    erNewContractAddress = Nothing,
    erSuicideList = S.empty,
    erAction = Nothing,
    erException = Nothing
    }


getCodeAndCollection :: Address -> SM (Contract, CodeCollection)
getCodeAndCollection address' = do
  callStack' <- fmap callStack get
  let maybeAddress =
        case callStack' of
          (current:_) -> Just $ currentAddress current
          _ -> Nothing

  liftIO $ putStrLn $ "----------------- caller address: " ++ fromMaybe "Nothing" (fmap format maybeAddress)
  liftIO $ putStrLn $ "----------------- callee address: " ++ format address'
  if Just address' == maybeAddress
    then do
    c' <- getCurrentContract
    cc' <- getCurrentCodeCollection
    return (c', cc')
    else do
    addressState <- getAddressState address'

    (contractName', codeString) <-
      case addressStateCodeHash addressState of
        SolidVMCode cn ch -> do
          c <- getEVMCode ch
          return (cn, c)
        ch -> internalError "SolidVM for non-solidvm code" ch

    let cc = read $ BC.unpack codeString

        contract' = fromMaybe (missingType "getCodeAndCollection" contractName') $ M.lookup contractName' $ cc^.contracts

    return (contract', cc)


logFunctionCall :: [Value] -> Address -> Contract -> String -> SM (Maybe Value) -> SM (Maybe Value)
logFunctionCall args address contract functionName f = do
  when trace $ do
    argStrings <- forM args showSM
    liftIO $ putStrLn $ box ["calling function: " ++ format address, (contract^.contractName) ++ "/" ++ functionName ++ "(" ++ intercalate ", " argStrings ++ ")"]

  result <- f

  when trace $ do
    resultString <-
      case result of
        Nothing -> return ""
        Just v -> showSM v

    liftIO $ putStrLn $ box ["returning from " ++ functionName ++ ":", resultString]


  return result


call'' :: Address -> String -> [Value] -> SM (Maybe Value)
call'' address functionName args = do
  (contract, cc) <-getCodeAndCollection address

  logFunctionCall args address contract functionName $
    case M.lookup functionName $ contract^.functions of
      Just theFunction -> do
        call' address contract cc theFunction args
      _ -> do --Maybe the function is actually a getter
        case M.lookup functionName $ contract^.storageDefs of
          Just _ -> do
            --TODO- this should only exist if the storage variable is declared
            -- "public", right now I just ignore this and allow anything to be called as a getter
            fmap Just $ getVar $ StorageItem [MS.Field $ BC.pack functionName]
          Nothing -> unknownFunction "logFunctionCall" (functionName, contract^.contractName)


runStatements :: [Xabi.Statement] -> SM (Maybe Value)
runStatements [] = return Nothing
runStatements (s:rest) = do
  when trace $
    if True
    then liftIO $ putStrLn $ C.green $ "statement> " ++ unparseStatement s
    else liftIO $ putStrLn $ C.green $ "statement> " ++ show s
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
  v1 <- expToPath e1
  v2 <- expToVar e2
  !value <- getVar v2
  when trace $ liftIO $ putStrLn $ "Variable to set is: " ++ show (v1, value)
  logAssigningVariable value
  setVar v1 value
  return Nothing
runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement e)) = do
  _ <- getVar =<< expToVar e
  return Nothing -- just throw away the return value

runStatement (Xabi.SimpleStatement (Xabi.VariableDefinition mType varNames maybeExpression)) = do
  value <-
    case maybeExpression of
      Just e -> do
        rhs <- expToVar e
        let getRef = SReference <$> expToPath e
            getValue = getVar =<< expToVar e
        case (rhs, mType) of
          (Constant c, _) -> return c
          (_, Just (Xabi.Label name)) -> do
            ty <- getTypeOfName name
            case ty of
              StructTypo{} -> getRef
              _ -> getValue
          _ -> getValue

      Nothing ->
        case varNames of
           [Just name] ->
             case mType of
               Nothing -> todo "type inference" name
               Just (Xabi.Label l) -> do
                 t' <- getTypeOfName l
                 case t' of
                    StructTypo fs ->  SStruct name <$> initializeStruct fs
                    _ -> todo "initialized type in variable definition" t'
               Just t -> return $ defaultValue t
           _ -> internalError "no single name for variable definition" varNames
  when trace $ do
    valueString <- showSM value
    liftIO $ putStrLn $ "             creating and setting variables: (" ++ intercalate ", " (map (fromMaybe "") varNames) ++ ")"
    liftIO $ putStrLn $ "             to: " ++ valueString


  case (varNames, value) of
    ([Just name], _) -> addLocalVariable name value
    (_, STuple variables) -> do
      checkArity "var declaration tuple" (V.length variables) (length varNames)
      forM_ [(n, v) | (Just n, v) <- zip varNames $ V.toList variables] $ \(name', variable') -> do
        value' <- getVar variable'
        addLocalVariable name' value'

    _ -> typeError "VariableDefinition expected a tuple" value

  return Nothing
    where
      initializeStruct :: [(T.Text, Xabi.FieldType)] -> SM (M.Map String Variable)
      initializeStruct = mapM initializeField . M.mapKeys T.unpack . M.fromList

      initializeField :: Xabi.FieldType -> SM Variable
      initializeField = fmap Variable . liftIO . newIORef . defaultValue . Xabi.fieldTypeType


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
      when trace $ liftIO $ putStrLn $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
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
  setVar path =<< getString var
  return Nothing

runStatement x = error $ "unknown statement in call to runStatement: " ++ show x

while :: SM Bool -> SM (Maybe Value) -> SM (Maybe Value)
while condition code = do
  c <- condition
  when trace $ liftIO $ putStrLn $ C.red $ "^^^^^^^^^^^^^^^^^^^^ loopy condition: " ++ show c
  if c
    then do
      result <- code
      case result of
        Nothing -> while condition code
        _ -> return result
    else return Nothing

getIndexType :: MS.StoragePath -> SM IndexType
getIndexType [] = internalError "getIndexType for root path" ([]::MS.StoragePath)
getIndexType p@(MS.Field field:_) = do
  ctract <- getCurrentContract
  let decls = ctract ^. storageDefs
  let n = length p - 1
  case M.lookup (BC.unpack field) decls of
    Nothing -> todo "unknown storage reference (examine locals?)" field
    Just Xabi.VariableDecl {Xabi.varType=v} -> return $! loop n v
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
getIndexType xs = internalError "getIndexType from non-field" xs



expToPath :: Xabi.Expression -> SM MS.StoragePath
expToPath (Xabi.Variable x) = return [MS.Field $ BC.pack x]
expToPath x@(Xabi.IndexAccess parent mIndex) = do
  parPath <- expToPath parent
  idxType <- getIndexType parPath
  idxVar <- maybe (typeError "empty index is only valid at type level" x) expToVar mIndex
  (parPath ++) <$> case idxType of
    MapAddressIndex -> do
      idx <- getAddress idxVar
      return $ case idx of
        SAddress a -> [MS.MapIndex $ MS.IAddress a]
        SInteger i -> [MS.MapIndex $ MS.IAddress $ fromIntegral i]
        _ -> typeError "invalid map of addresses index" idx
    MapBoolIndex -> do
      b <- getBool idxVar
      return [MS.MapIndex $ MS.IBool b]
    MapIntIndex -> do
      n <- getInt idxVar
      return [MS.MapIndex $ MS.INum n]
    MapStringIndex -> do
      idx <- getString idxVar
      return $ case idx of
        SString s -> [MS.MapIndex $ MS.IText $ BC.pack s]
        _ -> typeError "invalid map of strings index" idx
    ArrayIndex -> do
      n <- getInt  idxVar
      return [MS.ArrayIndex $ fromIntegral n]
expToPath (Xabi.MemberAccess parent field) = do
  parPath <- expToPath parent
  return $ parPath ++ [MS.Field $ BC.pack field]

expToPath x = todo "expToPath/unhandled" x


expToVar :: Xabi.Expression -> SM Variable
expToVar (Xabi.NumberLiteral v Nothing) = return $ Constant $ SInteger v --TODO- handle solidity units
expToVar (Xabi.StringLiteral s) = return $ Constant $ SString s
expToVar (Xabi.BoolLiteral b) = return $ Constant $ SBool b
expToVar (Xabi.Variable "bytes32ToString") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing
expToVar (Xabi.Variable "bytes") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing
expToVar (Xabi.Variable name) = do
  getVariableOfName name

expToVar (Xabi.PlusPlus e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var

  logAssigningVariable $ SInteger value

  setVar path $ SInteger $ value + 1
  return $ Constant $ SInteger value

expToVar (Xabi.Unitary "++" e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var
  let next = SInteger $ value + 1
  logAssigningVariable next

  setVar path next
  return $ Constant next

expToVar (Xabi.MinusMinus e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var
  logAssigningVariable $ SInteger value
  setVar path . SInteger $ value - 1
  return $ Constant $ SInteger value

expToVar (Xabi.Unitary "--" e) = do
  var <- expToVar e
  path <- expToPath e
  value <- getInt var
  let next = SInteger $ value -1
  logAssigningVariable next
  setVar path next
  return $ Constant next

expToVar (Xabi.Binary "+=" lhs rhs) = do
  let readInt e = getInt =<< expToVar e
  delta <- readInt rhs
  curValue <- readInt lhs
  path <- expToPath lhs
  let next = SInteger $ curValue + delta
  setVar path next
  return $ Constant next

expToVar (Xabi.MemberAccess (Xabi.Variable "Util") "bytes32ToString") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing

expToVar (Xabi.MemberAccess (Xabi.Variable "Util") "b32") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing

expToVar (Xabi.MemberAccess expr name) = do
  var <- expToVar expr

  case var of
    Constant c -> Constant <$> case (c, name) of
      (SEnum enumName, _) -> return $ SEnumVal enumName name
      (SBuiltinVariable "msg", "sender") -> (SAddress . sender) <$> getEnv
      (SBuiltinVariable "tx", "origin") -> (SAddress . origin) <$> getEnv
      (SStruct _ theMap, fieldName) ->
        let f = fromMaybe (missingField "struct member access" fieldName)
              $ M.lookup fieldName theMap
        in case f of
             Constant c' -> return c'
             _ -> internalError "constant struct refers to nonconstant" f
      (SContractDef contractName', constName) -> do
        cc <- getCurrentCodeCollection

        let cont = fromMaybe (missingType "contract function lookup" contractName')
                          (M.lookup contractName' $ cc^.contracts)

        let Xabi.ConstantDecl _ _ constExp = fromMaybe
             (unknownConstant "constant member access" (contractName', constName))
             (M.lookup constName $ cont^.constants)

        getContract constName =<< expToVar constExp

      (SBuiltinVariable "block", "timestamp") -> do
        env' <- getEnv
        return $ SInteger $ round $ utcTimeToPOSIXSeconds $ blockDataTimestamp $ blockHeader env'

      (SBuiltinVariable "block", "number") -> (SInteger . blockDataNumber . blockHeader) <$> getEnv

      (SAddress (Address a), itemName) -> return $ SContractItem (toInteger a) itemName

      (SContract contractName' a, funcName) -> return $ SContractFunction contractName' a funcName
      _ -> error $ "invalid constant: " ++ show c

    Variable vref -> do
      val' <- liftIO $ readIORef vref
      case val' of
        SAddress (Address a) -> return . Constant $ SContractItem (toInteger a) name
        SStruct _ theMap -> return
                $ fromMaybe (error $ "fetched a struct field that doesn't exist: " ++ name)
                $ M.lookup name theMap
        SReference ref -> do
          return $ StorageItem $ ref ++ [MS.Field $ BC.pack name]
        _ -> todo "access member of variable" (val', name)
    StorageItem p -> return $
      if name == "push"
        then Constant $ SPush p
        else StorageItem $ p ++ [MS.Field $ BC.pack name]

expToVar x@(Xabi.IndexAccess{}) = do
  idxPath <- expToPath x
  value <- getVar $ StorageItem idxPath
  Variable <$> liftIO (newIORef value)

expToVar (Xabi.Binary "+" expr1 expr2) = expToVarInteger expr1 (+) expr2 SInteger
expToVar (Xabi.Binary "*" expr1 expr2) = expToVarInteger expr1 (+) expr2 SInteger
expToVar (Xabi.Binary "|" expr1 expr2) = expToVarInteger expr1 (.|.) expr2 SInteger
expToVar (Xabi.Binary "&" expr1 expr2) = expToVarInteger expr1 (.&.) expr2 SInteger
expToVar (Xabi.Binary "^" expr1 expr2) = expToVarInteger expr1 xor expr2 SInteger
expToVar (Xabi.Binary "**" expr1 expr2) = expToVarInteger expr1 (^) expr2 SInteger
expToVar (Xabi.Binary "<<" expr1 expr2) = expToVarInteger expr1 (\x i -> x `shift` fromInteger i) expr2 SInteger
expToVar (Xabi.Binary "%" expr1 expr2) = expToVarInteger expr1 rem expr2 SInteger

expToVar (Xabi.Unitary "!" expr) = do
  (Constant . SBool . not) <$> (getBool =<< expToVar expr)
expToVar (Xabi.Unitary "delete" expr) = do
  p <- expToPath expr
  deleteVar p
  return . Constant $ SNULL

expToVar (Xabi.Binary "!=" expr1 expr2) = do --TODO- generalize all of these Binary operations to a single function
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  return . Constant . SBool . not $ val1 `valEquals` val2

expToVar (Xabi.Binary "==" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  return . Constant . SBool $ val1 `valEquals` val2

expToVar (Xabi.Binary "<" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 < i2
    _ -> typeError "binary '<' on non-ints" (val1, val2)

expToVar (Xabi.Binary ">" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 > i2
    _ -> typeError "binary '>' on non-ints" (val1, val2)

expToVar (Xabi.Binary ">=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 >= i2
    _ -> typeError "binary '>=' used on non-ints" (val1, val2)

expToVar (Xabi.Binary "<=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  logVals val1 val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 <= i2
    _ -> typeError "binary '<=' used on non-ints" (val1, val2)

expToVar (Xabi.Binary "&&" expr1 expr2) = do
  b1 <- getBool =<< expToVar expr1
  b2 <- getBool =<< expToVar expr2
  logVals b1 b2
  return $ Constant $ SBool $ b1 && b2

expToVar (Xabi.Binary "||" expr1 expr2) = do
  b1 <- getBool =<< expToVar expr1

  b2 <- getBool =<< expToVar expr2
  logVals b1 b2
  return $ Constant $ SBool $ b1 || b2

expToVar (Xabi.TupleExpression exps) = do
  vars <- for exps expToVar
  return $ Constant $ STuple $ V.fromList vars

expToVar (Xabi.Ternary condition expr1 expr2) = do
  c <- getBool =<< expToVar condition
  expToVar $ if c then expr1 else expr2

expToVar (Xabi.FunctionCall (Xabi.NewExpression (Xabi.Label contractName')) args) = do
  creator <- getCurrentAddress
  let argExps = map (\(Nothing, arg) -> arg) args  --TODO- add support for named arguments
  cc <- getCurrentCodeCollection
  incrementNonce creator
  execResults <- create' creator cc contractName' argExps
  return $ Constant $ SAddress
    $ fromMaybe (internalError "a call to create did not create an address" execResults)
    $  erNewContractAddress execResults

expToVar (Xabi.FunctionCall e args) = do
  var <- expToVar e
  argVals <- for args $ \(Nothing, arg) -> getVar =<< expToVar arg --TODO- add support for named arguments
  case var of
    Constant (SBuiltinFunction name o) -> fmap Constant $ callBuiltin name argVals o
    Constant (SFunction name) -> do
      contract' <- getCurrentContract
      address <- getCurrentAddress
      cc <- getCurrentCodeCollection

      res <- call' address contract' cc name argVals
      case res of
        Just v -> return $ Constant $ v
        Nothing -> return $ Constant $ SNULL

    Constant (SStructDef structName) -> do
      contract' <- getCurrentContract
      let vals = fromMaybe (missingType "struct constructor not found" structName)
               $ M.lookup structName $ contract'^.structs
      return $ Constant $ SStruct structName $ M.fromList
        $ zip (map (T.unpack . fst) vals) $ map Constant argVals

    Constant (SContractDef contractName') -> do
      case argVals of
        [SInteger address] -> --TODO- clean up this ambiguity between SAddress and SInteger....
          return $ Constant $ SContract contractName' address
        [SAddress (Address address)] ->
          return $ Constant $ SContract contractName' $ toInteger address
        _ -> typeError "contract variable creation" argVals

    Constant (SContractItem address itemName) -> do
      result <- call'' (Address $ fromInteger address) itemName argVals
      case result of
        Just value -> return $ Constant value
        Nothing -> return $ Constant SNULL

    Constant (SContractFunction _ address functionName) -> do
      result <- call'' (Address $ fromInteger address) functionName argVals
      case result of
        Just value -> return $ Constant value
        Nothing -> return $ Constant SNULL

    Constant (SEnum enumName) -> do
      case argVals of
        [SInteger i] -> do
          c <- getCurrentContract
          let theEnum = fromMaybe (missingType "enum constructor" enumName)
                      $ M.lookup enumName $ c^.enums
          return $ Constant $ SEnumVal enumName $ theEnum !! fromInteger i
        _ -> typeError "called enum constructor with improper args" argVals

    Constant (SPush path) -> do
      let lenPath = path ++ [MS.Field "length"]

      len' <- getInt $ StorageItem lenPath
      let len :: Int = fromIntegral len'
          newLen = SInteger $ fromIntegral $ len + 1
      let idxPath = path ++ [MS.ArrayIndex len]
      setVar lenPath newLen
      case argVals of
        [av] -> setVar idxPath av
        _ -> arityMismatch "push" (length argVals) 1
      return $ Constant newLen

    _ -> typeError "cannot call non-function" var


{-
SimpleStatement (ExpressionStatement (Binary "=" (Variable "tickets") (FunctionCall (NewExpression (Label "Hashmap")) [])))
-}

expToVar x = todo "expToVar/unhandled" x

--------------

expToVarInteger :: Xabi.Expression -> (Integer->Integer->a) -> Xabi.Expression -> (a->Value) -> SM Variable
expToVarInteger expr1 o expr2 retType = do
  i1 <- getInt =<< expToVar expr1
  i2 <- getInt =<< expToVar expr2
  return . Constant . retType $ i1 `o` i2


callBuiltin :: String -> [Value] -> Maybe Value -> SM Value
callBuiltin "uint" [SEnumVal enumName enumVal] _ = do
  contract' <- getCurrentContract
  let maybeEnumVals = M.lookup enumName $ contract'^.enums
      enumVals = fromMaybe (missingType "callBuiltin enum castBuilt" enumName) maybeEnumVals
  return
    $ SInteger
    $ toInteger
    $ fromMaybe (missingType "call builtin enum cast" (enumVal, enumName))
    $ enumVal `elemIndex` enumVals

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


runTheConstructors :: CodeCollection -> Address -> String -> [Xabi.Expression] -> SM ()
runTheConstructors cc address contractName' argExps = do
  let contract' =
          fromMaybe (missingType "contract inherits from a contract that doesn't exist" contractName')
          $ cc^.contracts . at contractName'

      argNames = map fst $ sortWith snd $ [ (T.unpack n, i) | (n, Xabi.IndexedType{Xabi.indexedTypeIndex=i}) <- M.toList $ fromMaybe M.empty $ fmap Xabi.funcArgs $ contract'^.constructor]

  when trace $ liftIO $ putStrLn $ box ["running constructor: " ++ contractName' ++ "(" ++ intercalate ", " argNames ++ ")"]

  argVals <- for argExps $ \arg -> getVar =<< expToVar arg

  addCallInfo address contract' cc (M.fromList $ zip argNames (map Constant argVals))

  forM_ (reverse $ contract'^.parents) $ \parent -> do
    let args = fromMaybe []
               $ M.lookup parent =<< (fmap Xabi.funcConstructorCalls $ contract'^.constructor)
    runTheConstructors cc address parent args

  _ <-
    case contract'^.constructor of
      Just theFunction -> do
        --argVals <- forM argExps evaluate
        --_ <- call' address contract' theFunction argVals
        let Just commands = Xabi.funcContents theFunction
        _ <- runStatements commands
        return ()

      Nothing -> return ()

  popCallInfo

  return ()




call' :: Address -> Contract -> CodeCollection -> Xabi.Func -> [Value] -> SM (Maybe Value)
call' address' contract' cc theFunction argVals = do
  let argNames = map fst $ sortWith snd $ [ (T.unpack n, i) | (n, Xabi.IndexedType{Xabi.indexedTypeIndex=i}) <- M.toList $ Xabi.funcArgs theFunction]

  when trace $ liftIO $ putStrLn $ "            args: " ++ show argNames

  addCallInfo address' contract' cc (M.fromList $ zip argNames (map Constant argVals))

  let Just commands = Xabi.funcContents theFunction
  val <- runStatements commands

  popCallInfo

  return val





box :: [String] -> String
box strings = unlines $
  [C.magenta ("╔" ++ replicate (width - 2) '═' ++ "╗")]
  ++ map (\s -> C.magenta "║ " ++ C.white s ++ replicate (width - printedLength s - 4) ' ' ++ C.magenta " ║") strings
  ++ [C.magenta ("╚" ++ replicate (width - 2) '═' ++ "╝")]
  where width = maximum (map length strings) + 4
        printedLength = go False
        go :: Bool -> String -> Int
        go True ('m':t) = go False t
        go True (_:t) = go True t
        go False ('\ESC':t) = go True t
        go False (_:t) = 1 + go False t
        go _ [] = 0




logAssigningVariable :: Value -> SM ()
logAssigningVariable v = do
  valueString <- showSM v
  liftIO $ putStrLn $ "            %%%% assigning variable: " ++ valueString

logVals :: (Show a, Show b) => a -> b -> SM ()
logVals val1 val2 = when trace . liftIO . putStrLn $ printf
  "            %%%% val1 = %s\n\
  \            %%%% val2 = %s" (show val1) (show val2)

--TODO- It would be nice to hold type information in the return value....  Unfortunately to be backwards compatible with the old API, for now we can not include this.
encodeForReturn :: Value -> SM ByteString
encodeForReturn (SInteger i) = return $ rlpSerialize $ rlpEncode i
encodeForReturn (SString s) = -- TODO- this is a sloppy first partial attempt, I need to call the appropriate library call to encode properly
  return $ word256ToBytes 0x20 `B.append` word256ToBytes (fromIntegral $ length s) `B.append` stringBytes `B.append` B.replicate (32 - B.length stringBytes) 0
  where stringBytes = BC.pack s
encodeForReturn (STuple items) = do
  encodedBytestrings <- forM (V.toList items) $ \i -> encodeForReturn =<< getVar i
  return $ B.concat encodedBytestrings
encodeForReturn x = todo "encodeForReturn type case" x
