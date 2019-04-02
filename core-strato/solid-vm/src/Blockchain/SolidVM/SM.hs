{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances  #-}


--{-# OPTIONS -fno-warn-unused-top-binds  #-}

module Blockchain.SolidVM.SM (
  CallInfo(..),
  SState(..),
  SM,
  action,
  runSM,
  getCurrentAddress,
  addCallInfo,
  popCallInfo,
  getLocal,
  setLocal,
  getCurrentCallInfo,
  getCurrentContract,
  getCurrentCodeCollection,
  getEnv,
  getVariableOfName,
  getTypeOfName,
  getXabiType,
  getXabiValueType,
  getValueType,
  initializeAction,
  markDiffForAction
  ) where

import           Control.Applicative ((<|>))
import           Control.Lens
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import           Data.Bifunctor (first)
import           Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import           Data.IORef
import qualified Data.HashMap.Strict as HM
import           Data.List (foldl')
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Maybe
import qualified Data.Text as T
import           Data.Text.Encoding(encodeUtf8,decodeUtf8)

import           Blockchain.Data.Address
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB
import           Blockchain.Strato.Model.Action
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.SolidVM.Environment     as Env
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.Value
import           Blockchain.VMContext

import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Statement as Xabi
import qualified SolidVM.Solidity.Xabi.Type as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

import CodeCollection






data CallInfo =
  CallInfo {
    currentAddress :: Address,
    currentContract :: Contract,
    codeCollection :: CodeCollection,
    collectionHash :: SHA,
    localVariables :: Map String (Xabi.Type, Variable),
    localByPath :: HM.HashMap MS.StoragePath MS.BasicValue
    } deriving (Show)

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

data SState =
  SState {
    env :: Env.Environment,
    callStack :: [CallInfo],
    codeDB                 :: CodeDB,
    hashDB                 :: HashDB,
    stateDB                :: MP.MPDB,
    addressStateTxDBMap    :: M.Map Address AddressStateModification,
    addressStateBlockDBMap :: M.Map Address AddressStateModification,
    storageTxMap           :: M.Map (Address, B.ByteString) B.ByteString,
    storageBlockMap        :: M.Map (Address, B.ByteString) B.ByteString,
    _action                 :: Action
  }

makeLenses ''SState

type SM = StateT SState (ResourceT IO)

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

runSM :: (Maybe ByteString) -> Env.Environment -> SM a -> ContextM a
runSM maybeCode env f = do
  vmcontext <- get

  let startingState =
        SState {
        env = env,
        callStack = [],
        codeDB = contextCodeDB vmcontext,
        hashDB = contextHashDB vmcontext,
        stateDB = contextStateDB vmcontext,
        addressStateTxDBMap = contextAddressStateTxDBMap vmcontext,
        addressStateBlockDBMap = contextAddressStateBlockDBMap vmcontext,
        storageTxMap = contextStorageTxMap vmcontext,
        storageBlockMap = contextStorageBlockMap vmcontext,
        _action = startingAction maybeCode env
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


startingAction :: Maybe ByteString -> Env.Environment -> Action
startingAction maybeCode env' = Action
  { _actionBlockHash          = blockHeaderHash $ Env.blockHeader env'
  , _actionBlockTimestamp     = blockHeaderTimestamp $ Env.blockHeader env'
  , _actionBlockNumber        = blockHeaderBlockNumber $ Env.blockHeader env'
  , _actionTransactionHash    = Env.txHash env'
  , _actionTransactionChainId = Env.chainId env'
  , _actionTransactionSender  = Env.sender env'
  , _actionData               = M.empty
  , _actionMetadata           =
      case maybeCode of
        Just theCode ->
          Just $ M.insert "src" (T.pack $ BC.unpack theCode) $ fromMaybe M.empty $ Env.metadata env'
        Nothing -> Env.metadata env'
  }




getEnv :: SM Env.Environment
getEnv = do
  fmap env get


toMaybe :: Bool -> a -> Maybe a
toMaybe True x = Just x
toMaybe False _ = Nothing


getVariableOfName :: String -> SM Variable
getVariableOfName name = do
  sstate <- get
  let currentCallInfo =
        case callStack sstate of
          [] -> internalError "getVariableValue called with an empty stack" name
          (x:_) -> x
      vars = localVariables currentCallInfo
      t s v = ('x':s) `seq` v
  maybeLocalValue <-
    -- TODO(tim): consult memory map for locals instead of storage
    case M.lookup name vars of
      Nothing -> return Nothing
      Just (_, var) -> Just <$> case var of
        Constant (SReference ap) -> return $ StorageItem ap
        Variable v -> do
          val <- liftIO $ readIORef v
          case val of
            SReference ap -> return $ StorageItem ap
            _ -> return . StorageItem . AddressedPath (Left LocalVar)
                        . MS.singleton $ BC.pack name
        s@StorageItem{} -> return s
        Constant{} -> return . StorageItem . AddressedPath (Left LocalVar)
                             . MS.singleton $ BC.pack name

  let maybeContractFunction :: Maybe Variable
      maybeContractFunction = fmap (t "constant function" . Constant . SFunction) $ M.lookup name $ currentContract currentCallInfo^.functions

      maybeBuiltinFunction :: Maybe Variable
      maybeBuiltinFunction = toMaybe (name `elem` ["uint", "byte", "string", "keccak256"
                                                  , "require", "revert", "assert", "sha3"
                                                  , "sha256", "ecrecover", "addmod", "mulmod"
                                                  , "selfdestruct", "suicide", "bytes32ToString"]) $
        t "builtin function" $ Constant $ SBuiltinFunction name Nothing

      maybeBuiltinVariable :: Maybe Variable
      maybeBuiltinVariable = toMaybe (name `elem` ["msg", "block", "tx", "super"]) $
        t "builtin variable" $ Constant $ SBuiltinVariable name

      maybeEnum :: Maybe Variable
      maybeEnum = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.enums)) $
        t "enum" $ Constant $ SEnum name

      maybeConstant :: Maybe Variable
      maybeConstant = fmap (t "constant constant" . Constant) $ do
        let ctract = currentContract currentCallInfo
        Xabi.ConstantDecl{..} <- M.lookup name $ ctract ^. constants
        return $ coerceType ctract constType $ case constInitialVal of
                                            Xabi.NumberLiteral x _ -> SInteger x
                                            x -> todo "constant initial val" x

      maybeStructDef :: Maybe Variable
      maybeStructDef = toMaybe (name `elem` M.keys (currentContract currentCallInfo^.structs)) $
        t "struct def" $ Constant $ SStructDef name

      maybeContract :: Maybe Variable
      maybeContract = toMaybe (name `elem` M.keys (codeCollection currentCallInfo^.contracts)) $
        t "contract" $ Constant $ SContractDef name

      maybeStorageItem :: Maybe Variable
      maybeStorageItem =
        -- TODO(tim): This might just be restricted to a field name
        if name `elem` M.keys (currentContract currentCallInfo^.storageDefs)
        then Just . StorageItem $ AddressedPath
                (Right $ currentAddress currentCallInfo)
                (MS.singleton $ BC.pack name)
        else Nothing

      maybeThis :: Maybe Variable
      maybeThis = toMaybe (name == "this") . t "this" . Constant . SAddress . currentAddress $ currentCallInfo



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
        return $ Just $ Constant $ val
-}

  return . fromMaybe (unknownVariable "getVariableOfName" name) . foldr1 (<|>) $
      [ maybeLocalValue
      , maybeStorageItem
      , maybeContractFunction
      , maybeBuiltinFunction
      , maybeBuiltinVariable
      , maybeEnum
      , maybeStructDef
      , maybeContract
      , maybeThis
      , maybeConstant
      , unknownVariable "getVariableOfName" name
      ]



getTypeOfName :: String -> SM Typo
getTypeOfName s = do
  let lookInContract :: Contract -> [Typo]
      lookInContract (Contract{..}) = catMaybes
        [ fmap StructTypo (M.lookup s _structs)
        , fmap EnumTypo (M.lookup s _enums)
        ]
  CodeCollection ccs <- fmap codeCollection getCurrentCallInfo
  let ctrs = map ContractTypo $ M.keys ccs
  case concatMap lookInContract ccs ++ ctrs of
    [] -> internalError "getTypeOfName" s
    (typo:_) -> return typo



addCallInfo :: Address -> Contract -> SHA -> CodeCollection -> Map String (Xabi.Type, Variable) -> SM ()
addCallInfo a c hsh cc initialLocalVariables = do
  sstate <- get
  let newCallInfo =
        CallInfo {
          currentAddress=a,
          currentContract=c,
          codeCollection=cc,
          collectionHash=hsh,
          localVariables=initialLocalVariables,
          localByPath=HM.empty
        }

  put sstate{callStack = newCallInfo:callStack sstate}

popCallInfo :: SM ()
popCallInfo = do
  sstate <- get
  case callStack sstate of
    [] -> internalError "popCallInfo was called on an already empty stack" ()
    (_:rest) -> put sstate{callStack = rest}


getCurrentCallInfo :: SM CallInfo
getCurrentCallInfo = do
  sstate <- get
  case callStack sstate of
    [] -> internalError "getCurrentCallInfo called with an empty stack" ()
    (currentCallInfo:_) -> return currentCallInfo

getCurrentContract :: SM Contract
getCurrentContract = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ currentContract currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()

getCurrentAddress :: SM Address
getCurrentAddress = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return $ currentAddress currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()


getLocal :: MS.StoragePath -> SM MS.BasicValue
getLocal path = do
  locals <- gets (map localByPath . callStack)
  return . fromMaybe MS.BDefault . foldl' (<|>) Nothing . map (HM.lookup path) $ locals

setLocal :: MS.StoragePath -> MS.BasicValue -> SM ()
setLocal path val = do
  sstate <- get
  let stack = callStack sstate
      (info, rest) = case stack of
                (ci:r) -> (ci,r)
                [] -> internalError "setLocal stack underflow" ()
      locals = localByPath info
      newLocals = case val of
                    MS.BDefault -> HM.delete path locals
                    _ -> HM.insert path val locals
  put sstate{callStack=info{localByPath=newLocals}:rest}


getCurrentCodeCollection :: SM (SHA, CodeCollection)
getCurrentCodeCollection = do
  cs <- fmap callStack get
  case cs of
    (currentCallInfo:_) -> return (collectionHash currentCallInfo, codeCollection currentCallInfo)
    _ -> internalError "getCurrentContract called with an empty stack" ()

hintFromType :: Xabi.Type -> SM BasicType
hintFromType = \case
 Xabi.Address{} -> return TAddress
 Xabi.Bool{} -> return TBool
 Xabi.Bytes{} -> return TString
 Xabi.Int{} -> return TInteger
 Xabi.String{} -> return TString
 Xabi.Label s -> do
   t' <- getTypeOfName s
   case t' of
     ContractTypo{} -> return $ TContract s
     EnumTypo{} -> return $ TEnumVal s
     StructTypo fs -> do
       let upgrade :: (T.Text, Xabi.FieldType) -> SM (B.ByteString , BasicType)
           upgrade = mapM (hintFromType . Xabi.fieldTypeType) . first encodeUtf8
       TStruct s <$> mapM upgrade fs
 Xabi.Array{} -> return TComplex
 tt'' -> todo "hintFromType" tt''

getXabiType :: Either LocalVar Address -> B.ByteString -> SM (Maybe Xabi.Type)
getXabiType loc field = do
  -- This field might have been defined in e.g. a caller contract.
  -- We search from the top down for the home of this data
  case loc of
    Left LocalVar -> do
      -- Reading the entire stack of locals solves the problem of passing
      -- local arrays as arguments to functions. The parameter is a reference
      -- to the argument, so the parent or higher must be consulted to resolve it.
      -- This solution has the downside of potentially resolving variables that are not in scope:
      -- function called() { return x; }, function caller() { uint x = 200; uint y = called(); }
      locals_stack <- gets (map localVariables . callStack)
      return . foldl' (<|>) Nothing $ map (fmap fst . M.lookup (BC.unpack field)) locals_stack
    Right addr -> do
      stack <- gets callStack
      case filter ((== addr) . currentAddress) stack of
        [] -> internalError "address not found in call stack" (addr, stack)
        (callInfo:_) -> return
                      . M.lookup (BC.unpack field)
                      . fmap Xabi.varType
                      . _storageDefs
                      . currentContract
                      $ callInfo

getXabiValueType :: AddressedPath -> SM Xabi.Type
getXabiValueType (AddressedPath loc path) = do
  let field = MS.getField path
  mType <- getXabiType loc field
  case mType of
    Nothing -> todo "getXabiValueType/unknown storage reference" field
    Just v -> loop (tail $ MS.toList path) v
 where loop :: [MS.StoragePathPiece] -> Xabi.Type -> SM Xabi.Type
       loop [] = return
       loop [x] = \case
         Xabi.Mapping{Xabi.value=v} -> case x of
           MS.MapIndex{} -> return v
           _ -> typeError "non map index attribute of mapping" x
         Xabi.Array{Xabi.entry=v} -> case x of
           MS.Field "length" -> return Xabi.Int{signed=Just True, bytes=Nothing}
           MS.ArrayIndex{} -> return v
           _ -> typeError "non-length or array index attribute of array" x
         Xabi.Label s -> do
           t' <- getTypeOfName s
           case (x, t') of
             (MS.Field n, StructTypo fs) -> do
               let mt'' = lookup (decodeUtf8 n) fs
               case mt'' of
                Just t'' -> return $ Xabi.fieldTypeType t''
                Nothing -> error $ "field not present in struct definition: " ++ show (n, fs)
             (_, StructTypo{}) -> typeError "non field access to struct" x
             (_, ContractTypo{}) -> todo "getValueType/contract access" t'
             (_, EnumTypo{}) -> todo "getValueType/enum acess" t'
         t'' -> todo "atomic type does not have value type" t''
       loop (_:rs) = \case
          Xabi.Mapping{Xabi.value=t'} -> loop rs t'
          Xabi.Array{Xabi.entry=t'} -> loop rs t'
          t -> todo "getXabiValueType/loopnext unsupported type" t

getValueType :: AddressedPath -> SM BasicType
getValueType p = hintFromType =<< getXabiValueType p

initializeAction :: Address -> String -> SHA -> SM ()
initializeAction addr name hsh = do
  let newData = ActionData (SolidVMCode name hsh) SolidVM (ActionSolidVMDiff M.empty) []
  action . actionData %= M.insertWith mergeActionData addr newData

markDiffForAction :: Address -> MS.StoragePath -> MS.BasicValue -> SM ()
markDiffForAction owner key' val' = do
  let key = MS.unparsePath key'
      val = rlpSerialize $ rlpEncode val'
      ins = \case
              ActionSolidVMDiff m -> ActionSolidVMDiff $ M.insert key val m
              _ -> error "SolidVM Diff executing in EVM"
  (action . actionData . at owner . mapped . actionDataStorageDiffs) %= ins
