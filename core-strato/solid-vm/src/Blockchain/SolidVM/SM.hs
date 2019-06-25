{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}


module Blockchain.SolidVM.SM (
  CallInfo(..),
  SState(..),
  SM,
  MonadSM,
  action,
  runSM,
  getCurrentAddress,
  addCallInfo,
  popCallInfo,
  getLocal,
  setLocal,
  getCurrentCallInfo,
  getCurrentContract,
  getCurrentFunctionName,
  getCurrentCodeCollection,
  getEnv,
  getVariableOfName,
  getTypeOfName,
  getXabiType,
  getXabiValueType,
  getValueType,
  pushSender,
  initializeAction,
  markDiffForAction,
  addEvent
  ) where

import           Control.Applicative ((<|>))
import           Control.Exception
import           Control.Lens
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Trans.State
import           Data.Bifunctor (first)
import           Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
--import           Data.IORef
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Maybe
import qualified Data.NibbleString as N
import qualified Data.Sequence as S
import qualified Data.Text as T
import           Data.Text.Encoding(encodeUtf8,decodeUtf8)

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StateDB
import           Blockchain.Output
import           Blockchain.Strato.Model.Action
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Event
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.SolidVM.Environment     as Env
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.Value
import           Blockchain.VMContext
import           Blockchain.VMOptions

import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Solidity.Xabi as Xabi
import qualified SolidVM.Solidity.Xabi.Statement as Xabi
import qualified SolidVM.Solidity.Xabi.Type as Xabi
import qualified SolidVM.Solidity.Xabi.VarDef as Xabi

import CodeCollection






data CallInfo =
  CallInfo {
    currentFunctionName :: String,
    currentAddress :: Address,
    currentContract :: Contract,
    codeCollection :: CodeCollection,
    collectionHash :: SHA,
    localVariables :: Map String (Xabi.Type, Variable)
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
    ssEvents               :: S.Seq Event,
    addressStateTxDBMap    :: M.Map Address AddressStateModification,
    addressStateBlockDBMap :: M.Map Address AddressStateModification,
    storageTxMap           :: M.Map (Address, B.ByteString) B.ByteString,
    storageBlockMap        :: M.Map (Address, B.ByteString) B.ByteString,
    _action                :: Action
  }

makeLenses ''SState

type SM = StateT SState IO

type MonadSM m = ( (Address `A.Alters` AddressState) m
                 , (SHA `A.Alters` DBCode) m
                 , HasRawStorageDB m
                 , Mod.Accessible Env.Environment m
                 , Mod.Modifiable Env.Sender m
                 , Mod.Modifiable [CallInfo] m
                 , Mod.Modifiable Action m
                 , MonadIO m --todo: remove
                 )

instance HasMemAddressStateDB SM where
  getAddressStateTxDBMap = addressStateTxDBMap <$> get
  putAddressStateTxDBMap theMap = do
    sstate <- get
    put $ sstate{addressStateTxDBMap=theMap}
  getAddressStateBlockDBMap = addressStateBlockDBMap <$> get
  putAddressStateBlockDBMap theMap = do
    sstate <- get
    put $ sstate{addressStateBlockDBMap=theMap}

instance HasMemRawStorageDB SM where
  getMemRawStorageTxDB = do
    cxt <- get
    return (MP.ldb $ stateDB cxt, --storage and states use the same database!
            storageTxMap cxt)
  putMemRawStorageTxMap theMap = do
    cxt <- get
    put cxt{storageTxMap=theMap}
  getMemRawStorageBlockDB = do
    cxt <- get
    return (MP.ldb $ stateDB cxt, --storage and states use the same database!
            storageBlockMap cxt)
  putMemRawStorageBlockMap theMap = do
    cxt <- get
    put cxt{storageBlockMap=theMap}

instance (RawStorageKey `A.Alters` RawStorageValue) SM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance Mod.Modifiable MP.StateRoot SM where
  get _    = gets (MP.stateRoot . stateDB)
  put _ sr = get >>= \c -> put c{stateDB = (stateDB c){MP.stateRoot = sr}}

instance (Address `A.Alters` AddressState) SM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (MP.StateRoot `A.Alters` MP.NodeData) SM where
  lookup _ = MP.genericLookupDB $ gets (MP.ldb . stateDB)
  insert _ = MP.genericInsertDB $ gets (MP.ldb . stateDB)
  delete _ = MP.genericDeleteDB $ gets (MP.ldb . stateDB)

instance (SHA `A.Alters` DBCode) SM where
  lookup _ = genericLookupCodeDB $ gets codeDB
  insert _ = genericInsertCodeDB $ gets codeDB
  delete _ = genericDeleteCodeDB $ gets codeDB

instance (N.NibbleString `A.Alters` N.NibbleString) SM where
  lookup _ = genericLookupHashDB $ gets hashDB
  insert _ = genericInsertHashDB $ gets hashDB
  delete _ = genericDeleteHashDB $ gets hashDB

instance Mod.Accessible Env.Environment SM where
  access _ = gets env

instance Mod.Modifiable Env.Sender SM where
  get _ = Env.Sender . Env.sender <$> gets env
  put _ (Env.Sender s) = modify $ \ss@SState{env=e} -> ss{env = e{Env.sender = s}}

instance Mod.Modifiable [CallInfo] SM where
  get _ = gets callStack
  put _ cs = modify $ \ss -> ss{callStack = cs}

instance Mod.Modifiable Action SM where
  get _ = use action
  put _ = assign action

instance Mod.Modifiable (S.Seq Event) SM where
  -- adding events to the action so that slipstream gets them,
  --   and also to the events field of the sstate, so that they get sent to
  --    TxrIndexer for governance updates
  get    _   = gets ssEvents
  put    _ q = do
    action . actionEvents .= q
    modify $ \sstate -> sstate { ssEvents = q }
  modify _ f = do
    aEvents <- use action . actionEvents
    aEvents' <- f aEvents
    assign (action . actionEvents) aEvents'

    sstate <- get
    ssEvents' <- f (ssEvents sstate)
    put sstate { ssEvents = ssEvents' }
    pure ssEvents'

runSM :: (Maybe ByteString) -> Env.Environment -> SM a -> ContextM (Either SolidException a)
runSM maybeCode env f = do
  vmcontext <- get

  let startingState =
        SState {
        env = env,
        callStack = [],
        codeDB = contextCodeDB vmcontext,
        hashDB = contextHashDB vmcontext,
        stateDB = contextStateDB vmcontext,
        ssEvents = S.empty,
        addressStateTxDBMap = contextAddressStateTxDBMap vmcontext,
        addressStateBlockDBMap = contextAddressStateBlockDBMap vmcontext,
        storageTxMap = contextStorageTxMap vmcontext,
        storageBlockMap = contextStorageBlockMap vmcontext,
        _action = startingAction maybeCode env
        }

  eValState <- liftIO . try $ runStateT f startingState
  case eValState of
    -- InternalError should *never* happen.
    -- TODO should also not happen, but since this is a work in progress they
    -- are a fact of life and should be fixed on demand.
    -- The rest should always be a user error and handled safely
    Left ie@InternalError{} -> do
      $logErrorLS "runSM/internalError" ie
      throw ie
    Left se -> do
      $logErrorLS "runSM/error" se
      if flags_svmDev
        then do
          $logErrorLS "runSM/error_code" maybeCode
          throw se
        else return $ Left se
    Right (value, sstateAfter) -> do
      vmcontext' <- get
      put vmcontext'{
        contextAddressStateTxDBMap = addressStateTxDBMap sstateAfter,
        contextAddressStateBlockDBMap = addressStateBlockDBMap sstateAfter,
        contextStorageTxMap = storageTxMap sstateAfter,
        contextStorageBlockMap = storageBlockMap sstateAfter
        }
      setStateDBStateRoot $ MP.stateRoot $ stateDB sstateAfter
      return $ Right value


-- When calling a remote contract, the new `msg.sender` is the contract
-- that the call is initiated from.
pushSender :: MonadSM m => Address -> m a -> m a
pushSender newSender mv = do
  oldSender <- Mod.get (Mod.Proxy @Env.Sender)
  Mod.put (Mod.Proxy @Env.Sender) (Env.Sender newSender)
  ret <- mv
  Mod.put (Mod.Proxy @Env.Sender) oldSender
  return $ ret

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
  , _actionEvents             = S.empty
  }




getEnv :: MonadSM m => m Env.Environment
getEnv = Mod.access (Mod.Proxy @Env.Environment)

toMaybe :: Bool -> a -> Maybe a
toMaybe True x = Just x
toMaybe False _ = Nothing


getVariableOfName :: MonadSM m => String -> m Variable
getVariableOfName name = do
  cStack <- Mod.get (Mod.Proxy @[CallInfo])
  let currentCallInfo =
        case cStack of
          [] -> internalError "getVariableValue called with an empty stack" name
          (x:_) -> x
      vars = localVariables currentCallInfo
      t s v = ('x':s, v) `seq` v

  let maybeLocalValue = fmap snd $ M.lookup name vars

  let maybeContractFunction :: Maybe Variable
      maybeContractFunction = fmap (t "constant function" . Constant . SFunction name) $ M.lookup name $ currentContract currentCallInfo^.functions

      maybeBuiltinFunction :: Maybe Variable
      maybeBuiltinFunction = toMaybe (name `elem` ["address", "uint", "int", "byte", "bytes"
                                                  , "string", "keccak256"
                                                  , "require", "revert", "assert", "sha3"
                                                  , "sha256", "ecrecover", "addmod", "mulmod"
                                                  , "selfdestruct", "suicide", "bytes32ToString"]) $
        t "builtin function" $ Constant $ SBuiltinFunction name Nothing

      maybeBuiltinVariable :: Maybe Variable
      maybeBuiltinVariable = toMaybe (name `elem` ["msg", "block", "tx", "super", "now"]) $
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
        then Just . Constant . SReference $ AddressedPath
                (currentAddress currentCallInfo)
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



getTypeOfName :: MonadSM m => String -> m Typo
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



addCallInfo :: MonadSM m
            => Address
            -> Contract
            -> String
            -> SHA
            -> CodeCollection
            -> Map String (Xabi.Type, Variable)
            -> m ()
addCallInfo a c fn hsh cc initialLocalVariables = do
  let newCallInfo =
        CallInfo {
          currentFunctionName=fn,
          currentAddress=a,
          currentContract=c,
          codeCollection=cc,
          collectionHash=hsh,
          localVariables=initialLocalVariables
        }

  Mod.modify_ (Mod.Proxy @[CallInfo]) $ pure . (newCallInfo:)

popCallInfo :: MonadSM m => m ()
popCallInfo = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    [] -> internalError "popCallInfo was called on an already empty stack" ()
    (_:rest) -> Mod.put (Mod.Proxy @[CallInfo]) rest


getCurrentCallInfo :: MonadSM m => m CallInfo
getCurrentCallInfo = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    [] -> internalError "getCurrentCallInfo called with an empty stack" ()
    (currentCallInfo:_) -> return currentCallInfo

getCurrentContract :: MonadSM m => m Contract
getCurrentContract = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo:_) -> return $ currentContract currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()

getCurrentAddress :: MonadSM m => m Address
getCurrentAddress = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo:_) -> return $ currentAddress currentCallInfo
    _ -> internalError "getCurrentAddress called with an empty stack" ()


getCurrentFunctionName :: MonadSM m => m String
getCurrentFunctionName = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo:_) -> return $ currentFunctionName currentCallInfo
    _ -> internalError "getCurrentFunctionName called with an empty stack" ()


getLocal :: MonadSM m => String -> m (Maybe Variable)
getLocal name = do
  currentCallInfo <- getCurrentCallInfo
  return $ fmap snd $ M.lookup name $ localVariables currentCallInfo

setLocal :: MonadSM m => String -> Variable -> m ()
setLocal name val = do
  stack <- Mod.get (Mod.Proxy @[CallInfo])
  let (info, rest) = case stack of
                (ci:r) -> (ci,r)
                [] -> internalError "setLocal stack underflow" ()
      locals = localVariables info
      (theType, _) = fromMaybe (error $ "setLocal called for variable that doesn't exist: " ++ name)
                     $ M.lookup name locals
      newVariables = M.insert name (theType, val) locals
  Mod.put (Mod.Proxy @[CallInfo]) $ info{localVariables=newVariables} : rest


getCurrentCodeCollection :: MonadSM m => m (SHA, CodeCollection)
getCurrentCodeCollection = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo:_) -> return (collectionHash currentCallInfo, codeCollection currentCallInfo)
    _ -> internalError "getCurrentContract called with an empty stack" ()

hintFromType :: MonadSM m => Xabi.Type -> m BasicType
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
       let upgrade :: MonadSM m => (T.Text, Xabi.FieldType) -> m (B.ByteString , BasicType)
           upgrade = mapM (hintFromType . Xabi.fieldTypeType) . first encodeUtf8
       TStruct s <$> mapM upgrade fs
 Xabi.Array{} -> return TComplex
 tt'' -> todo "hintFromType" tt''

getXabiType :: MonadSM m => Address -> B.ByteString -> m (Maybe Xabi.Type)
getXabiType addr field = do
  -- This field might have been defined in e.g. a caller contract.
  -- We search from the top down for the home of this data
  stack <- Mod.get (Mod.Proxy @[CallInfo])
  case filter ((== addr) . currentAddress) stack of
    [] -> internalError "address not found in call stack" (addr, stack)
    (callInfo:_) -> return
                    . M.lookup (BC.unpack field)
                    . fmap Xabi.varType
                    . _storageDefs
                    . currentContract
                    $ callInfo

getXabiValueType :: MonadSM m => AddressedPath -> m Xabi.Type
getXabiValueType (AddressedPath loc path) = do
  let field = MS.getField path
  mType <- getXabiType loc field
  case mType of
    Nothing -> todo "getXabiValueType/unknown storage reference" field
    Just v -> loop (tail $ MS.toList path) v
 where loop :: MonadSM m => [MS.StoragePathPiece] -> Xabi.Type -> m Xabi.Type
       loop [] = return
       loop [x] = \case
         Xabi.Mapping{Xabi.value=v} -> case x of
           MS.MapIndex{} -> return v
           _ -> typeError "non map index attribute of mapping" x
         Xabi.Array{Xabi.entry=v} -> case x of
           MS.Field "length" -> return Xabi.Int{signed=Just True, bytes=Nothing}
           MS.ArrayIndex{} -> return v
           _ -> typeError "non-length or array index attribute of array" x
         Xabi.String{} -> case x of
           MS.Field "length" -> return Xabi.Int{signed=Just True, bytes=Nothing}
           _ -> typeError "non-length attribute of string" x
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

getValueType :: MonadSM m => AddressedPath -> m BasicType
getValueType p = hintFromType =<< getXabiValueType p

initializeAction :: Mod.Modifiable Action m => Address -> String -> SHA -> m ()
initializeAction addr name hsh = do
  let newData = ActionData (SolidVMCode name hsh) SolidVM (ActionSolidVMDiff M.empty) []
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    actionData %= M.insertWith mergeActionData addr newData

markDiffForAction :: Mod.Modifiable Action m => Address -> MS.StoragePath -> MS.BasicValue -> m ()
markDiffForAction owner key' val' = do
  let key = MS.unparsePath key'
      val = rlpSerialize $ rlpEncode val'
      ins = \case
              ActionSolidVMDiff m -> ActionSolidVMDiff $ M.insert key val m
              _ -> error "SolidVM Diff executing in EVM"
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    actionData . at owner . mapped . actionDataStorageDiffs %= ins

addEvent :: Mod.Modifiable (S.Seq Event) m => Event -> m ()
addEvent newEvent = Mod.modify_ (Mod.Proxy @(S.Seq Event)) $ pure . (S.|> newEvent)
