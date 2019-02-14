
module Blockchain.SolidVM.SM where

import Control.Lens
import Control.Monad.IO.Class
import Control.Monad.Trans.State
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as M
import Data.Maybe
import Data.Time

--import qualified BlockApps.Solidity.Xabi as Xabi
import qualified BlockApps.Solidity.Xabi.Statement as Xabi

import Blockchain.Data.Address
--import Blockchain.Strato.Model.Address

import Account
import CodeCollection
import Value

data CallInfo =
  CallInfo {
    currentAddress :: Address,
    currentContract :: Contract,
    localVariables :: Map String Variable
    }

data BlockHeader =
  BlockHeader {
  timestamp :: UTCTime,
  number :: Integer
  }

{-
BlockData
    parentHash SHA
    unclesHash SHA
    coinbase Address
    stateRoot StateRoot
    transactionsRoot StateRoot
    receiptsRoot StateRoot
    logBloom BS.ByteString
    difficulty Integer sqltype=numeric(1000,0)
    number Integer sqltype=numeric(1000,0)
    gasLimit Integer sqltype=numeric(1000,0)
    gasUsed Integer sqltype=numeric(1000,0)
    timestamp UTCTime
    extraData BS.ByteString
    nonce Word64
    mixHash SHA
    deriving Eq Read Show Generic
-}

data Environment =
  Environment {
    sender :: Address,
    origin :: Address,
    blockHeader :: BlockHeader
    }

data SState =
  SState {
    env :: Environment,
    codeCollection :: CodeCollection,
    accounts :: Map Address Account,
    callStack :: [CallInfo]
  }

type SM a = StateT SState IO a


runSM :: SState -> SM a -> IO a
runSM sstate f = do
  (value, _) <- runStateT f sstate
  return value

getEnv :: SM Environment
getEnv = do
  fmap env get

addLocalVariable :: String -> Value -> SM ()
addLocalVariable name value = do
  newVariable <- liftIO $ fmap Variable $ newIORef value
  sstate <- get
  case callStack sstate of
    [] -> error "addLocalVariable called with an empty stack"
    (currentSlice:rest) -> 
      put sstate
          {callStack = currentSlice{localVariables=M.insert name newVariable $ localVariables currentSlice}:rest}

getVariableOfName :: String -> SM Variable
getVariableOfName name = do
  sstate <- get

  let currentCallInfo =
        case callStack sstate of
          [] -> error "getVariableValue called with an empty stack"
          (x:_) -> x
      vars = localVariables currentCallInfo
      maybeLocalValue = M.lookup name $ vars

      maybeStorageValue :: Maybe Variable
      maybeStorageValue =
        M.lookup (currentAddress currentCallInfo) (accounts sstate) >>= M.lookup name . storage

      maybeContractFunction :: Maybe Variable
      maybeContractFunction = fmap (Constant . SFunction) $ M.lookup name $ currentContract currentCallInfo^.functions
      
      maybeBuiltinFunction :: Maybe Variable
      maybeBuiltinFunction =
        if name `elem` ["uint"]
        then Just $ Constant $ SBuiltinFunction name Nothing
        else Nothing
        
      maybeBuiltinVariable :: Maybe Variable
      maybeBuiltinVariable =
        if name `elem` ["msg", "block", "tx"]
        then Just $ Constant $ SBuiltinVariable name
        else Nothing
        
      maybeEnum :: Maybe Variable
      maybeEnum =
        if name `elem` M.keys (currentContract currentCallInfo^.enums)
        then Just $ Constant $ SEnum name
        else Nothing

      maybeStructDef :: Maybe Variable
      maybeStructDef =
        if name `elem` M.keys (currentContract currentCallInfo^.structs)
        then Just $ Constant $ SStructDef name
        else Nothing

      maybeContract :: Maybe Variable
      maybeContract =
        if name `elem` M.keys (codeCollection sstate^.contracts)
        then Just $ Constant $ SContractDef name
        else Nothing

  --TODO- Add the constant lookup properly
  {-
  maybeConstantValue <- do
--    M.lookup (currentAddress currentCallInfo) (accounts sstate) >>= M.lookup name . constants
    liftIO $ putStrLn $ " @@@@@@@@@@@@@@@@@@@ available constants: " ++ show (M.keys $ currentContract currentCallInfo^.constants)
    case M.lookup name $ currentContract currentCallInfo^.constants of
      Nothing -> return Nothing
      Just (Xabi.ConstantDecl _ _ e) -> do
        let val = constExpToVar e
        --error "gonna constant"
        return $ Just $ Constant $ val
-}
  
  return
    $ flip fromMaybe maybeLocalValue
    $ flip fromMaybe maybeStorageValue
    $ flip fromMaybe maybeContractFunction
    $ flip fromMaybe maybeBuiltinFunction
    $ flip fromMaybe maybeBuiltinVariable
    $ flip fromMaybe maybeEnum
    $ flip fromMaybe maybeStructDef
    $ flip fromMaybe maybeContract
--    $ flip fromMaybe maybeConstantValue
    $ (error $ "No variable with name " ++ name)

{-
  c <- fmap (currentContract . head . callStack) get
  let contractVariables = undefined
      theFunction =
        flip fromMaybe (M.lookup name $ c^.functions)
        $ flip fromMaybe (M.lookup name contractVariables)
        $ error $ "No variable named " ++ name
      Just funcStatements = funcContents theFunction

  runStatements funcStatements
-}

constExpToVar :: Xabi.Expression -> Value
constExpToVar x = error $ "constExpToVar not defined for " ++ show x


addCallInfo :: Address -> Contract -> Map String Variable -> SM ()
addCallInfo a c initialLocalVariables = do
  sstate <- get
  
  let newCallInfo =
        CallInfo {
          currentAddress=a,
          currentContract=c,
          localVariables=initialLocalVariables
        }
        
  put sstate{callStack = newCallInfo:callStack sstate}

popCallInfo :: SM ()
popCallInfo = do
  sstate <- get
  case callStack sstate of
    [] -> error "popCallInfo was called on an already empty stack"
    (_:rest) -> put sstate{callStack = rest}


getCurrentContract :: SM Contract
getCurrentContract = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ currentContract currentCallInfo
    _ -> error $ "getCurrentContract called with an empty stack"

getCurrentAddress :: SM Address
getCurrentAddress = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ currentAddress currentCallInfo
    _ -> error $ "getCurrentContract called with an empty stack"

{-
setStorage :: Address -> String -> Value -> SM ()
setStorage address name value = do
  sstate <- get
  let account = fromMaybe initialAccount $ M.lookup address $ accounts sstate :: Account
      newAccount = account{storage=M.insert name value $ storage account} :: Account
  put sstate{accounts = M.insert address newAccount $ accounts sstate}

getStorage :: Address -> String -> SM (Maybe Value)
getStorage address name = do
  sstate <- get
  case M.lookup address $ accounts sstate of
    Nothing -> return Nothing
    Just account ->return $ M.lookup name $ storage account
-}

addToStorage :: Address -> String -> Value -> SM ()
addToStorage address name value = do
  variable <- liftIO $ fmap Variable $ newIORef value
  sstate <- get
  let account = fromMaybe initialAccount $ M.lookup address $ accounts sstate :: Account
      newAccount = account{storage=M.insert name variable $ storage account} :: Account
  put sstate{accounts = M.insert address newAccount $ accounts sstate}


getAccount :: Address -> SM Account
getAccount a = do
  sstate <- get
  return $ fromMaybe initialAccount $ M.lookup a $ accounts sstate

addAccount :: Address -> Account -> SM ()
addAccount a account = do
  sstate <- get
  put sstate{accounts=M.insert a account $ accounts sstate}

getNonce :: Address -> SM Integer
getNonce a = do
  account <- getAccount a
  return $ nonce account

setNonce :: Address -> Integer -> SM ()
setNonce a n = do
  account <- getAccount a
  sstate <- get
  put sstate{accounts=M.insert a account{nonce = n} $ accounts sstate}
  
