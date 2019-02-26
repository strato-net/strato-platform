{-# LANGUAGE OverloadedStrings #-}

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
import           Blockchain.DB.RawStorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.SolidVM.Account
import           Blockchain.SolidVM.SetGet
import           Blockchain.SolidVM.Value
import           Blockchain.SHA
import           Blockchain.Strato.Model.Gas
import           Blockchain.VMContext
import           Blockchain.SolidVM.SM

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
create _ _ _ _ _ _ _ _ _ _ _ (PrecompiledCode _) _ _ _ = error "you can't call a precompiled function in SolidVM"
create _ _ _ _ _ sender' _ _ _ _ newAddress (Code initCode) _ _ _ = do
  addCode SolidVM $ initCode

  newAddressState <- getAddressState newAddress
  putAddressState newAddress newAddressState{addressStateContractRoot=MP.emptyTriePtr, addressStateCodeHash=SolidVMCode "<unknown>" $ hash initCode}

  runSM initCode $ do
    create' sender' "qq" []

create' :: Address -> String -> [Xabi.Expression] -> SM ExecResults
create' creator name argExps = do
  sstate <- get
  let cc = codeCollection sstate

  --TODO- Replace this address creation with the safe version:
  nonce' <- getNonce creator
  setNonce creator $ nonce'+1
  let address = getNewAddress_unsafe creator nonce'
  --------------------------------

  when trace $ liftIO $ putStrLn $ C.red $ "Creating Contract: " ++ show address ++ " of type " ++ name

  let account = initialAccount{contract=(name, cc)}

  addAccount address account

  let contract' = fromMaybe (error $ "no contract with name " ++ name) (cc ^. contracts . at name)

  -- Add Storage

  addCallInfo address contract' M.empty

  forM_ (M.toList $ contract'^.storageDefs) $ \(n, (Xabi.VariableDecl theType _ maybeExpression)) -> do
    initialValue <-
      case maybeExpression of
        Just e -> getVar =<< expToVar e
        Nothing -> return $ defaultValue theType
    putRawStorageKeyVal' address (BC.pack n) $ rlpSerialize $ rlpEncode initialValue
--    addToStorage address n initialValue

  popCallInfo

  -- Run the constructor
  runTheConstructors cc address name argExps

  when trace $ liftIO $ putStrLn $ C.red $ "Done Creating Contract: " ++ show address ++ " of type " ++ name

  return ExecResults {
    erRemainingTxGas = 0, --Just use up all the allocated gas for now....
    erRefund = 0,
    erReturnVal = Just B.empty,
    erTrace = [],
    erLogs = [],
    erNewContractAddress = Just address,
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

call _ _ _ _ _ _ _ codeAddress _ _ _ _ _ _ _ _ metadata = do


  let maybeFuncName = join $ fmap (M.lookup "funcName") metadata
      funcName = T.unpack $ fromMaybe (error "TX is missing a metadata parameter called 'funcName'") maybeFuncName
      maybeArgString = join $ fmap (M.lookup "args") metadata
      argString = T.unpack $ fromMaybe (error "TX is missing metadata parameter called 'args'") maybeArgString
      maybeArgs = runParser parseArgs "qq" "qq" argString
      args = either (error . ("args can not be parsed: " ++) . show) id maybeArgs 
      
  addressState <- getAddressState codeAddress

  ccString <-
    case addressStateCodeHash addressState of
      SolidVMCode _ ch -> getEVMCode ch
      _ -> error "internal error- SolidVM was called for non-solid-vm code"


  returnValue <- runSM ccString $ do
           argValues <- forM args $ \arg -> getVar =<< expToVar arg
           call'' codeAddress funcName argValues



  return ExecResults {
    erRemainingTxGas = 0, --Just use up all the allocated gas for now....
    erRefund = 0,
    erReturnVal = fmap encodeForReturn returnValue,
    erTrace = [],
    erLogs = [],
    erNewContractAddress = Nothing,
    erSuicideList = S.empty,
    erAction = Nothing,
    erException = Nothing
    }



call'' :: Address -> String -> [Value] -> SM (Maybe Value)
call'' address functionName args = do
  sstate <- get

  let contractName = "qq"
      cc = codeCollection sstate

  when trace $ do
    argStrings <- forM args showSM
    liftIO $ putStrLn $ box ["calling function: " ++ format address, contractName ++ "/" ++ functionName ++ "(" ++ intercalate ", " argStrings ++ ")"]

  let contract' = fromMaybe (error $ "contract name doesn't exist in CodeCollection: " ++ contractName) $  M.lookup contractName $ cc^.contracts

--  liftIO $ putStrLn $ "            available contracts: " ++ show (M.keys $ cc^.contracts)
--  liftIO $ putStrLn $ "            available functions: " ++ show (M.keys $ contract'^.functions)

  case M.lookup functionName $ contract'^.functions of
    Just theFunction -> do
      result <- call' address contract' theFunction args

      when trace $ do
        resultString <-
          case result of
            Nothing -> return ""
            Just v -> showSM v

        liftIO $ putStrLn $ box ["returning from " ++ functionName ++ ":", resultString]

      return result

    _ -> do --Maybe the function is actually a getter
      case M.lookup functionName $ contract'^.storageDefs of
        Just _ -> do --TODO- this should only exist if the storage variable is declared "public", right now I just ignore this and allow anything to be called as a getter
          val <- getVar $ StorageItem functionName
          return $ Just val
        Nothing -> error $ "No function '" ++ functionName ++ "' in contract '" ++ contractName ++ "'"


---------------------------------------------






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
  v <- getVar var
  let value =
        case v of
          (SInteger i) -> i
          _ -> error "PlusPlus applied to a non integer"

  when trace $ logAssigningVariable $ SInteger value

  setVar var $ SInteger $ value + 1
  return Nothing




runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement (Xabi.Binary "=" e1 e2))) = do
  v1 <- expToVar e1
  v2 <- expToVar e2
  value <- getVar v2

  when trace $ liftIO $ putStrLn $ "Variable to set is: " ++ show v1
  when trace $ logAssigningVariable value
  setVar v1 value
  return Nothing
runStatement (Xabi.SimpleStatement (Xabi.ExpressionStatement e)) = do
  _ <- getVar =<< expToVar e
  return Nothing -- just throw away the return value

runStatement (Xabi.SimpleStatement (Xabi.VariableDefinition _ varNames maybeExpression)) = do  -- TODO- figure out if we want types, I am currently ignoring them

  value <-
    case maybeExpression of
      Just e -> getVar =<< expToVar e
      Nothing -> return SNULL

  when trace $ do
    valueString <- showSM value
    liftIO $ putStrLn $ "             creating and setting variables: (" ++ intercalate ", " (map (fromMaybe "") varNames) ++ ")"
    liftIO $ putStrLn $ "             to: " ++ valueString


  case (varNames, value) of
    ([Just name], _) -> addLocalVariable name value
    (_, STuple variables) -> do
      when (V.length variables /= length varNames) $ error $ "var declaration returned a tuple of the wrong length"
      forM_ [(n, v) | (Just n, v) <- zip varNames $ V.toList variables] $ \(name', variable') -> do
        value' <- getVar variable'
        addLocalVariable name' value'

    _ -> error "VariableDefinition expected a tuple, but the returned value was not one"

  return Nothing

runStatement (Xabi.IfStatement condition code' maybeElseCode) = do
  conditionResult <- getVar =<< expToVar condition
  case conditionResult of
    SBool True -> runStatements code'
    SBool False ->
      case maybeElseCode of
        Just elseCode -> runStatements elseCode
        Nothing -> return Nothing
    _ -> error "IfStatement returned a non bool value"

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
          Nothing -> error "can't handle for loops with no loop expression yet"

  let condition = getVar =<< expToVar conditionExp

  while condition $ do
      when trace $ liftIO $ putStrLn $ C.red "^^^^^^^^^^^^^^^^^^^^ loopy! "
      result <- runStatements code
      _ <- getVar =<< expToVar loopExp
      return result

--  error $ "gonna for: " ++ show code

{-
  conditionResult <- getVar =<< expToVar condition
  case conditionResult of
    SBool True -> runStatements code'
    SBool False -> return Nothing
    _ -> error "IfStatement returned a non bool value"
-}

runStatement (Xabi.Return maybeExpression) = do
  case maybeExpression of
    Just e -> fmap Just $ getVar =<< expToVar e
    Nothing -> return $ Just SNULL

runStatement x = error $ "unknown statement in call to runStatement: " ++ show x

while :: SM Value -> SM (Maybe Value) -> SM (Maybe Value)
while condition code = do
  val <- condition
  when trace $ liftIO $ putStrLn $ C.red $ "^^^^^^^^^^^^^^^^^^^^ loopy condition: " ++ show val

  case val of
    SBool True -> do
      result <- code
      case result of
        Nothing -> while condition code
        _ -> return result
    SBool False -> return Nothing
    x -> error $ "condition in for loop didn't evaluate to a bool: " ++ show x

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
  v <- getVar var
  let value =
        case v of
          (SInteger i) -> i
          _ -> error "PlusPlus applied to a non integer"

  when trace $ logAssigningVariable $ SInteger value

  setVar var $ SInteger $ value + 1
  return $ Constant $ SInteger value

expToVar (Xabi.Unitary "++" e) = do
  var <- expToVar e
  v <- getVar var
  let value =
        case v of
          (SInteger i) -> i
          _ -> error "PlusPlus applied to a non integer"

  when trace $ logAssigningVariable $ SInteger value

  setVar var $ SInteger $ value + 1
  return $ Constant $ SInteger $ value + 1



expToVar (Xabi.MemberAccess (Xabi.Variable "Util") "bytes32ToString") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing

expToVar (Xabi.MemberAccess (Xabi.Variable "Util") "b32") = do --TODO- remove this hardcoded case
  return $ Constant $ SBuiltinFunction "identity" Nothing

expToVar (Xabi.MemberAccess expr name) = do
  var <- expToVar expr
  val <- getVar var

  when trace $ liftIO $ putStrLn $ "         val = " ++ show val

  case (val, name) of
    (SEnum enumName, _) -> return $ Constant $ SEnumVal enumName name
    (SBuiltinVariable "msg", "sender") -> do
      env' <- getEnv
      let (Address senderInteger) = sender env'
      return $ Constant $ SInteger $ toInteger senderInteger
    (SBuiltinVariable "tx", "origin") -> do
      env' <- getEnv
      let (Address senderInteger) = origin env'
      return $ Constant $ SInteger $ toInteger senderInteger
    (SStruct _ theMap, fieldName) -> do
      let x = fromMaybe (error $ "fetched a struct field that doesn't exist: " ++ fieldName) $ M.lookup fieldName theMap
      return x
    (SContractDef contractName, constName) -> do
      sstate <- get


      let c = fromMaybe (error $ "code refers to a contract that doesn't exist: " ++ contractName) (M.lookup contractName $ codeCollection sstate^.contracts)

      let Xabi.ConstantDecl _ _ constExp = fromMaybe (error $ "code refers to a const that doesn't exist: " ++ contractName ++ "." ++ constName) (M.lookup constName $ c^.constants)

      fmap Constant $ getVar =<< expToVar constExp

    (SBuiltinVariable "block", "timestamp") -> do
      env' <- getEnv
      return $ Constant $ SInteger $ round $ utcTimeToPOSIXSeconds $ timestamp $ blockHeader env'

    (SBuiltinVariable "block", "number") -> do
      env' <- getEnv
      return $ Constant $ SInteger $ number $ blockHeader env'

    (SAddress (Address a), itemName) -> do
{-
      (contractName, cc) <- fmap contract $ getAccount $ Address a

      if isFunction
        then return $ Constant $ SContractFunction contractName a itemName
        else return $ Constant $ SContractItem a itemName
-}
      return $ Constant $ SContractItem (toInteger a) itemName


    (SContract contractName a, funcName) -> do
      return $ Constant $ SContractFunction contractName a funcName

    _ -> return $ Property name var

expToVar (Xabi.IndexAccess e (Just iExp)) = do
  var <- expToVar e
  val <- getVar var
  iVal <- getVar =<< expToVar iExp
  case (val, iVal) of
    (SArray _ v, SInteger i) -> do
      return $ v V.! fromInteger i
    (SMap valType m, val') -> do
      return $ fromMaybe (UnsetMapItem var val' valType) $ M.lookup val' m

    _ -> error $ "code tried to get an index, but the values weren't correct:\n" ++ show val ++ "\n" ++ show iVal

expToVar (Xabi.Binary "+" expr1 expr2) = expToVarInteger expr1 (+) expr2 SInteger
expToVar (Xabi.Binary "*" expr1 expr2) = expToVarInteger expr1 (+) expr2 SInteger
expToVar (Xabi.Binary "|" expr1 expr2) = expToVarInteger expr1 (.|.) expr2 SInteger
expToVar (Xabi.Binary "&" expr1 expr2) = expToVarInteger expr1 (.&.) expr2 SInteger
expToVar (Xabi.Binary "<<" expr1 expr2) = expToVarInteger expr1 (\x i -> x `shift` fromInteger i) expr2 SInteger
expToVar (Xabi.Binary "%" expr1 expr2) = expToVarInteger expr1 rem expr2 SInteger

expToVar (Xabi.Unitary "!" expr) = do
  res <- getVar =<< expToVar expr
  case res of
    SBool v -> return $ Constant $ SBool $ not v
    _ -> error "Unitary ! calculated a non bool value"

expToVar (Xabi.Binary "!=" expr1 expr2) = do --TODO- generalize all of these Binary operations to a single function
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  isEqual <- liftIO $ val1 `valEquals` val2
  if not $ isEqual
    then return $ Constant $ SBool True
    else return $ Constant $ SBool False

expToVar (Xabi.Binary "==" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n%%%% val2 = " ++ show val2
  isEqual <- liftIO $ val1 `valEquals` val2
  if isEqual
    then return $ Constant $ SBool True
    else return $ Constant $ SBool False

expToVar (Xabi.Binary "<" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 < i2
    _ -> error $ "binary '<' used on non number values"

expToVar (Xabi.Binary ">" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 > i2
    _ -> error $ "binary '<' used on non number values"

expToVar (Xabi.Binary ">=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 >= i2
    _ -> error $ "binary '<' used on non number values"

expToVar (Xabi.Binary "<=" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ SBool $ i1 <= i2
    _ -> error $ "binary '<' used on non number values"

expToVar (Xabi.Binary "&&" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  case (val1, val2) of
    (SBool b1, SBool b2) -> return $ Constant $ SBool $ b1 && b2
    _ -> error $ "binary '<' used on non number values"

expToVar (Xabi.Binary "||" expr1 expr2) = do
  val1 <- getVar =<< expToVar expr1

  val2 <- getVar =<< expToVar expr2
  when trace $ liftIO $ putStrLn $ "            %%%% val1 = " ++ show val1 ++ "\n            %%%% val2 = " ++ show val2
  case (val1, val2) of
    (SBool b1, SBool b2) -> return $ Constant $ SBool $ b1 || b2
    _ -> error $ "binary '<' used on non number values"

expToVar (Xabi.TupleExpression exps) = do
  vars <- for exps expToVar
  return $ Constant $ STuple $ V.fromList vars

expToVar (Xabi.Ternary condition expr1 expr2) = do
  conditionVal <- getVar =<< expToVar condition
  case conditionVal of
    SBool True -> do
      expToVar expr1
    SBool False -> do
      expToVar expr2
    x -> error $ "ternary condition is not a bool: " ++ show x


expToVar (Xabi.FunctionCall (Xabi.NewExpression (Xabi.Label contractName)) args) = do
  creator <- getCurrentAddress
  let argExps = map (\(Nothing, arg) -> arg) args  --TODO- add support for named arguments
  execResults <- create' creator contractName argExps
  return $ Constant $ SAddress $ fromMaybe (error "a call to create did not create an address") $  erNewContractAddress execResults

expToVar (Xabi.FunctionCall e args) = do
  var <- expToVar e
  argVals <- for args $ \(Nothing, arg) -> getVar =<< expToVar arg --TODO- add support for named arguments
  case var of
    Constant (SBuiltinFunction name o) -> fmap Constant $ callBuiltin name argVals o
    Constant (SFunction name) -> do
      contract' <- getCurrentContract
      address <- getCurrentAddress

      res <- call' address contract' name argVals
      case res of
        Just v -> return $ Constant $ v
        Nothing -> return $ Constant $ SNULL

    Constant (SStructDef structName) -> do
      contract' <- getCurrentContract
      let vals = fromMaybe (error $ "code refers to a struct that does not exist in the contract: " ++ structName) $ M.lookup structName $ contract'^.structs

      return $ Constant $ SStruct structName $ M.fromList $ zip (map (T.unpack . fst) vals) $ map Constant argVals

    Constant (SContractDef contractName) -> do
      case argVals of
        [SInteger address] -> --TODO- clean up this ambiguity between SAddress and SInteger....
          return $ Constant $ SContract contractName address
        [SAddress (Address address)] ->
          return $ Constant $ SContract contractName $ toInteger address
        x -> error $ "args wrong for contract variable creation: " ++ show x

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
          let theEnum = fromMaybe (error $ "code refers to enum that doesn't exist: " ++ enumName) $ M.lookup enumName $ c^.enums
          return $ Constant $ SEnumVal enumName $ theEnum !! fromInteger i
        _ -> error "called enum constructor with improper args"

    Property "push" var' -> do
      val <- getVar var'
      case (val, argVals) of
        (SArray valType vec, [newVal]) -> do
          newVar <- liftIO $ fmap Variable $ newIORef newVal
          setVar var' $ SArray valType $ vec `V.snoc` newVar
          return $ Constant SNULL
        x -> error $ "push property called on a type that is not a SArray: " ++ show x

    _ -> error $ "code tried to call a function on a non-funciton value:\n" ++ show var


{-
SimpleStatement (ExpressionStatement (Binary "=" (Variable "tickets") (FunctionCall (NewExpression (Label "Hashmap")) [])))
-}

expToVar x = error $ "unhandled expression in call to expToVar: " ++ show x

--------------

expToVarInteger :: Xabi.Expression -> (Integer->Integer->a) -> Xabi.Expression -> (a->Value) -> SM Variable
expToVarInteger expr1 o expr2 retType = do
  val1 <- getVar =<< expToVar expr1
  val2 <- getVar =<< expToVar expr2
  case (val1, val2) of
    (SInteger i1, SInteger i2) -> return $ Constant $ retType $ i1 `o` i2
    _ -> error $ "code tried to perform math on two values that aren't SIntegers:\n" ++ show val1 ++ "\n" ++ show val2






callBuiltin :: String -> [Value] -> Maybe Value -> SM Value
callBuiltin "uint" [SEnumVal enumName enumVal] _ = do
  contract' <- getCurrentContract
  let maybeEnumVals = M.lookup enumName $ contract'^.enums
      enumVals = fromMaybe (error $ "code refers to an enum that does not exist in the contract: " ++ enumName) maybeEnumVals
  return
    $ SInteger
    $ toInteger
    $ fromMaybe (error $ "code refers to an enum val that is not in the enum: " ++ enumVal ++ " is not in " ++ enumName)
    $ enumVal `elemIndex` enumVals

callBuiltin "uint" args _ = do
  error $ "uint undefined for args: " ++ show args
callBuiltin "push" [v] (Just o) = do
  error $ "push undefined for args: " ++ show v ++ ", " ++ show o
callBuiltin "identity" [v] Nothing = do
  return v
callBuiltin x _ _ = error $ "callBuiltin called for an unknown function: " ++ x


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
runTheConstructors cc address contractName argExps = do
  let contract' =
          fromMaybe (error $ "contract inherits from a contract that doesn't exits: " ++ contractName)
          $ cc^.contracts . at contractName

      argNames = map fst $ sortWith snd $ [ (T.unpack n, i) | (n, Xabi.IndexedType{Xabi.indexedTypeIndex=i}) <- M.toList $ fromMaybe M.empty $ fmap Xabi.funcArgs $ contract'^.constructor]

  when trace $ liftIO $ putStrLn $ box ["running constructor: " ++ contractName ++ "(" ++ intercalate ", " argNames ++ ")"]

  argVals <- for argExps $ \arg -> getVar =<< expToVar arg

  addCallInfo address contract' (M.fromList $ zip argNames (map Constant argVals))

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
{-
create :: Address -> CodeCollection -> String -> [Xabi.Expression] -> SM Address
create creator cc name argExps = do
  address <- getContractAddress creator
  when trace $ liftIO $ putStrLn $ C.red $ "Creating Contract: " ++ show address ++ " of type " ++ name
  let account = Account 0 0 M.empty (name, cc)

  addAccount address account

  let contract' = fromMaybe (error $ "no contract with name " ++ name) (cc ^. contracts . at name)

  -- Add Storage

  addCallInfo address contract' M.empty

  forM_ (M.toList $ contract'^.storageDefs) $ \(n, (Xabi.VariableDecl theType _ maybeExpression)) -> do
    initialValue <-
      case maybeExpression of
        Just e -> getVar =<< expToVar e
        Nothing -> return $ defaultValue theType
    addToStorage address n initialValue

  popCallInfo

  -- Run the constructor
  runTheConstructors cc address name argExps

  when trace $ liftIO $ putStrLn $ C.red $ "Done Creating Contract: " ++ show address ++ " of type " ++ name

  return address
-}

call' :: Address -> Contract -> Xabi.Func -> [Value] -> SM (Maybe Value)
call' address' contract' theFunction argVals = do
  let argNames = map fst $ sortWith snd $ [ (T.unpack n, i) | (n, Xabi.IndexedType{Xabi.indexedTypeIndex=i}) <- M.toList $ Xabi.funcArgs theFunction]

  when trace $ liftIO $ putStrLn $ "            args: " ++ show argNames

  addCallInfo address' contract' (M.fromList $ zip argNames (map Constant argVals))

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



--TODO- It would be nice to hold type information in the return value....  Unfortunately to be backwards compatible with the old API, for now we can not include this.
encodeForReturn :: Value -> ByteString
encodeForReturn (SInteger i) = rlpSerialize $ rlpEncode i
encodeForReturn x = error $ "encodeForReturn called for undefined value: " ++ show x
