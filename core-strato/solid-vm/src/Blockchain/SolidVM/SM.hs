{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.SolidVM.SM where

import           Control.Lens
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import           Data.IORef
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Maybe

import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Solidity.Xabi.Statement as Xabi

import           Blockchain.Data.Address
import           Blockchain.Data.DataDefs (BlockData(..))
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB
import           Blockchain.SolidVM.Account
import           Blockchain.SolidVM.Value
import           Blockchain.VMContext

import CodeCollection








data CallInfo =
  CallInfo {
    currentAddress :: Address,
    currentContract :: Contract,
    codeCollection :: CodeCollection,
    localVariables :: Map String Variable
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
    blockHeader :: BlockData
    }

data SState =
  SState {
    env :: Environment,
    accounts :: Map Address Account,
    callStack :: [CallInfo],
    codeDB                 :: CodeDB,
    hashDB                 :: HashDB,
    stateDB                :: MP.MPDB,
    addressStateTxDBMap    :: M.Map Address AddressStateModification,
    addressStateBlockDBMap :: M.Map Address AddressStateModification,
    storageTxMap           :: M.Map (Address, B.ByteString) B.ByteString,
    storageBlockMap        :: M.Map (Address, B.ByteString) B.ByteString
  }

type SM = StateT SState (ResourceT IO)

--type ContextM = StateT Context (ReaderT Config (ResourceT (LoggingT IO)))

instance HasMemAddressStateDB SM where
  getAddressStateTxDBMap = addressStateTxDBMap <$> get
  putAddressStateTxDBMap theMap = do
    sstate <- get
    put $ sstate{addressStateTxDBMap=theMap}
  getAddressStateBlockDBMap = addressStateBlockDBMap <$> get
  putAddressStateBlockDBMap theMap = do
    sstate <- get
    put $ sstate{addressStateBlockDBMap=theMap}

instance HasRawStorageDB SM where
  getRawStorageTxDB = do
    cxt <- get
    return (MP.ldb $ stateDB cxt, --storage and states use the same database!
            storageTxMap cxt)
  putRawStorageTxMap theMap = do
    cxt <- get
    put cxt{storageTxMap=theMap}
  getRawStorageBlockDB = do
    cxt <- get
    return (MP.ldb $ stateDB cxt, --storage and states use the same database!
            storageBlockMap cxt)
  putRawStorageBlockMap theMap = do
    cxt <- get
    put cxt{storageBlockMap=theMap}

instance HasStateDB SM where
  getStateDB = stateDB <$> get
  setStateDBStateRoot sr = do
    cxt <- get
    put cxt{stateDB=(stateDB cxt){MP.stateRoot=sr}}

instance HasHashDB SM where
  getHashDB = hashDB <$> get

instance HasCodeDB SM where
  getCodeDB = codeDB <$> get

runSM :: BlockData -> SM a -> ContextM a
runSM blk f = do
  vmcontext <- get

  let startingState =
        SState {
        env = Environment {
            sender = Address 0x1234,
            origin = Address 0x1234,
            blockHeader = blk
            },
        accounts = M.empty,
        callStack = [],
        codeDB = contextCodeDB vmcontext,
        hashDB = contextHashDB vmcontext,
        stateDB = contextStateDB vmcontext,
        addressStateTxDBMap = contextAddressStateTxDBMap vmcontext,
        addressStateBlockDBMap = contextAddressStateBlockDBMap vmcontext,
        storageTxMap = contextStorageTxMap vmcontext,
        storageBlockMap = contextStorageBlockMap vmcontext
        }

  (value, sstateAfter) <- liftIO $ runResourceT $ runStateT f startingState

  vmcontext' <- get
  put vmcontext'{
    contextAddressStateTxDBMap = addressStateTxDBMap sstateAfter,
    contextAddressStateBlockDBMap = addressStateBlockDBMap sstateAfter,
    contextStorageTxMap = storageTxMap sstateAfter,
    contextStorageBlockMap = storageBlockMap sstateAfter
    }
  setStateDBStateRoot $ MP.stateRoot $ stateDB sstateAfter
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

toMaybe :: Bool -> a -> Maybe a
toMaybe True x = Just x
toMaybe False _ = Nothing

getVariableOfName :: String -> SM Variable
getVariableOfName name = do
  sstate <- get

  let currentCallInfo =
        case callStack sstate of
          [] -> error "getVariableValue called with an empty stack"
          (x:_) -> x
      vars = localVariables currentCallInfo
      maybeLocalValue = M.lookup name $ vars

      maybeContractFunction :: Maybe Variable
      maybeContractFunction = fmap (Constant . SFunction) $ M.lookup name $ currentContract currentCallInfo^.functions

      maybeBuiltinFunction :: Maybe Variable
      maybeBuiltinFunction = toMaybe (name `elem` ["uint", "keccak256", "require", "revert", "assert", "sha3", "sha256", "ecrecover", "addmod", "mulmod", "selfdestruct", "suicide"]) $
        Constant $ SBuiltinFunction name Nothing

      maybeBuiltinVariable :: Maybe Variable
      maybeBuiltinVariable = toMaybe (name `elem` ["msg", "block", "tx"]) $
        Constant $ SBuiltinVariable name

      maybeEnum :: Maybe Variable
      maybeEnum = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.enums)) $
        Constant $ SEnum name

      maybeStructDef :: Maybe Variable
      maybeStructDef = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.structs)) $
        Constant $ SStructDef name

      maybeContract :: Maybe Variable
      maybeContract = toMaybe (name `elem` M.keys (codeCollection currentCallInfo^.contracts)) $
        Constant $ SContractDef name

      maybeStorageItem :: Maybe Variable
      maybeStorageItem =
        -- TODO(tim): This might just be restricted to a field name
        if name `elem` M.keys (currentContract currentCallInfo^.storageDefs)
        then either (error . show) (Just . StorageItem) . MS.parsePath . BC.pack $ '.':name
        else Nothing

      maybeThis :: Maybe Variable
      maybeThis = toMaybe (name == "this") . Constant . SAddress . currentAddress $ currentCallInfo



--        M.lookup (currentAddress currentCallInfo) (accounts sstate) >>= M.lookup name . storage


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
    $ flip fromMaybe maybeStorageItem
    $ flip fromMaybe maybeContractFunction
    $ flip fromMaybe maybeBuiltinFunction
    $ flip fromMaybe maybeBuiltinVariable
    $ flip fromMaybe maybeEnum
    $ flip fromMaybe maybeStructDef
    $ flip fromMaybe maybeContract
    $ flip fromMaybe maybeThis
--    $ flip fromMaybe maybeConstantValue
    $ (error $ "No variable with name " ++ name)


getCurrentCallInfo :: SM CallInfo
getCurrentCallInfo = do
  sstate <- get
  case callStack sstate of
    [] -> error "getCurrentCallInfo called with an empty stack"
    (currentCallInfo:_) -> return currentCallInfo
        

getTypeOfName :: String -> SM Typo
getTypeOfName s = do
  let lookInContract :: Contract -> [Typo]
      lookInContract (Contract{..}) = catMaybes
        [ fmap StructTypo (M.lookup s _structs)
        , fmap EnumTypo (M.lookup s _enums)
        , fmap FuncTypo (M.lookup s _functions)
        ]

  CodeCollection ccs <- fmap codeCollection getCurrentCallInfo
  case concatMap lookInContract ccs of
    [] -> error $ "TODO(tim): unable to find type: " ++ show s
    (typo:_) -> return typo

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


addCallInfo :: Address -> Contract -> CodeCollection -> Map String Variable -> SM ()
addCallInfo a c cc initialLocalVariables = do
  sstate <- get

  let newCallInfo =
        CallInfo {
          currentAddress=a,
          currentContract=c,
          codeCollection=cc,
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

getCurrentCodeCollection :: SM CodeCollection
getCurrentCodeCollection = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ codeCollection currentCallInfo
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
{-
addToStorage :: Address -> String -> Value -> SM ()
addToStorage address name value = do
  variable <- liftIO $ fmap Variable $ newIORef value
  sstate <- get
  let account = fromMaybe initialAccount $ M.lookup address $ accounts sstate :: Account
      newAccount = account{storage=M.insert name variable $ storage account} :: Account
  put sstate{accounts = M.insert address newAccount $ accounts sstate}
-}

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

