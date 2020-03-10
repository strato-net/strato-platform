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
import           Control.Lens hiding (Context)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Class
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
import qualified Data.Sequence as Q
import qualified Data.Text as T
import           Data.Text.Encoding(encodeUtf8,decodeUtf8)

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
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

import           UnliftIO

import CodeCollection






data CallInfo = CallInfo
  { currentFunctionName            :: String
  , currentAddress                 :: Address
  , currentContract                :: Contract
  , codeCollection                 :: CodeCollection
  , collectionHash                 :: SHA
  , localVariables                 :: Map String (Xabi.Type, Variable)
  , callInfoAddressStateTxDBMap    :: M.Map Address AddressStateModification
  , callInfoAddressStateBlockDBMap :: M.Map Address AddressStateModification
  , callInfoStorageTxMap           :: M.Map (Address, B.ByteString) B.ByteString
  , callInfoStorageBlockMap        :: M.Map (Address, B.ByteString) B.ByteString
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

data SState = SState
  { env                    :: Env.Environment
  , callStack              :: [CallInfo]
  , ssEvents               :: Q.Seq Event
  , addressStateTxDBMap    :: M.Map Address AddressStateModification
  , addressStateBlockDBMap :: M.Map Address AddressStateModification
  , storageTxMap           :: M.Map (Address, B.ByteString) B.ByteString
  , storageBlockMap        :: M.Map (Address, B.ByteString) B.ByteString
  , _action                :: Action
  }

makeLenses ''SState

type SM m = StateT SState m

type MonadSM m = ( (Address `A.Alters` AddressState) m
                 , (SHA `A.Alters` DBCode) m
                 , HasRawStorageDB m
                 , HasMemAddressStateDB m
                 , HasMemRawStorageDB m
                 , Mod.Accessible Env.Environment m
                 , Mod.Modifiable Env.Sender m
                 , Mod.Modifiable [CallInfo] m
                 , Mod.Modifiable Action m
                 , Mod.Modifiable (Q.Seq Event) m
                 , MonadIO m --todo: remove
                 )

instance Monad m => HasMemAddressStateDB (SM m) where
  getAddressStateTxDBMap = do
    SState{..} <- get
    case callStack of
      CallInfo{..}:_ -> pure callInfoAddressStateTxDBMap
      [] -> pure addressStateTxDBMap
  putAddressStateTxDBMap theMap = modify $ \ss@SState{..} -> do
    case callStack of
      ci : cis -> ss{callStack = ci{callInfoAddressStateTxDBMap=theMap} : cis}
      [] -> ss{addressStateTxDBMap=theMap}
  getAddressStateBlockDBMap = do
    SState{..} <- get
    case callStack of
      CallInfo{..}:_ -> pure callInfoAddressStateBlockDBMap
      [] -> pure addressStateBlockDBMap
  putAddressStateBlockDBMap theMap = modify $ \ss@SState{..} -> do
    case callStack of
      ci : cis -> ss{callStack = ci{callInfoAddressStateBlockDBMap=theMap} : cis}
      [] -> ss{addressStateBlockDBMap=theMap}

instance Monad m => HasMemRawStorageDB (SM m) where
  getMemRawStorageTxDB = do
    SState{..} <- get
    case callStack of
      CallInfo{..}:_ -> pure callInfoStorageTxMap
      [] -> pure storageTxMap
  putMemRawStorageTxMap theMap =  modify $ \ss@SState{..} -> do
    case callStack of
      ci : cis -> ss{callStack = ci{callInfoStorageTxMap=theMap} : cis}
      [] -> ss{storageTxMap=theMap}
  getMemRawStorageBlockDB = do
    SState{..} <- get
    case callStack of
      CallInfo{..}:_ -> pure callInfoStorageBlockMap
      [] -> pure storageBlockMap
  putMemRawStorageBlockMap theMap =  modify $ \ss@SState{..} -> do
    case callStack of
      ci : cis -> ss{callStack = ci{callInfoStorageBlockMap=theMap} : cis}
      [] -> ss{storageBlockMap=theMap}

instance ( (MP.StateRoot `A.Alters` MP.NodeData) m
         , (N.NibbleString `A.Alters` N.NibbleString) m
         , Mod.Modifiable MP.StateRoot m
         ) => (RawStorageKey `A.Alters` RawStorageValue) (SM m) where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance Mod.Modifiable MP.StateRoot m => Mod.Modifiable MP.StateRoot (SM m) where
  get   = lift . Mod.get
  put p = lift . Mod.put p

instance ( (MP.StateRoot `A.Alters` MP.NodeData) m
         , (N.NibbleString `A.Alters` N.NibbleString) m
         , Mod.Modifiable MP.StateRoot m
         ) => (Address `A.Alters` AddressState) (SM m) where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (MP.StateRoot `A.Alters` MP.NodeData) m => (MP.StateRoot `A.Alters` MP.NodeData) (SM m) where
  lookup p   = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p   = lift . A.delete p

instance (SHA `A.Alters` DBCode) m => (SHA `A.Alters` DBCode) (SM m) where
  lookup p   = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p   = lift . A.delete p

instance (N.NibbleString `A.Alters` N.NibbleString) m => (N.NibbleString `A.Alters` N.NibbleString) (SM m) where
  lookup p   = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p   = lift . A.delete p

instance Monad m => Mod.Accessible Env.Environment (SM m) where
  access _ = gets env

instance Monad m => Mod.Modifiable Env.Sender (SM m) where
  get _ = Env.Sender . Env.sender <$> gets env
  put _ (Env.Sender s) = modify $ \ss@SState{env=e} -> ss{env = e{Env.sender = s}}

instance Monad m => Mod.Modifiable [CallInfo] (SM m) where
  get _ = gets callStack
  put _ cs = modify $ \ss -> ss{callStack = cs}

instance Monad m => Mod.Modifiable Action (SM m) where
  get _ = use action
  put _ = assign action

instance Monad m => Mod.Modifiable (Q.Seq Event) (SM m) where
  -- adding events to the action so that slipstream gets them,
  --   and also to the events field of the sstate, so that they get sent to
  --    TxrIndexer for governance updates
  get    _   = gets ssEvents
  put    _ q = do
    action . actionEvents .= q
    modify $ \sstate -> sstate { ssEvents = q }

runSM :: ( MonadIO m
         , MonadUnliftIO m
         , MonadLogger m
         , Mod.Modifiable Context m
         )
      => (Maybe ByteString)
      -> Env.Environment
      -> SM m a
      -> m (Either SolidException a)
runSM maybeCode env f = do
  vmcontext <- Mod.get (Mod.Proxy @Context)

  let startingState =
        SState {
        env = env,
        callStack = [],
        ssEvents = Q.empty,
        addressStateTxDBMap = contextAddressStateTxDBMap vmcontext,
        addressStateBlockDBMap = contextAddressStateBlockDBMap vmcontext,
        storageTxMap = contextStorageTxMap vmcontext,
        storageBlockMap = contextStorageBlockMap vmcontext,
        _action = startingAction maybeCode env
        }

  eValState <- try $ runStateT f startingState
  case eValState of
    -- NO errors will crash the VM.
    -- InternalError should *never* happen.
    -- TODO should also not happen, but since this is a work in progress they
    -- are a fact of life and should be fixed on demand.
    -- The rest should always be a user error and handled safely
    Left se -> do
      $logErrorLS "runSM/error" se
      if flags_svmDev
        then do
          $logErrorLS "runSM/error_code" maybeCode
          throwIO se
        else return $ Left se
    Right (value, sstateAfter) -> do
      vmcontext' <- Mod.get (Mod.Proxy @Context)
      Mod.put (Mod.Proxy @Context) vmcontext'{
        contextAddressStateTxDBMap = addressStateTxDBMap sstateAfter,
        contextAddressStateBlockDBMap = addressStateBlockDBMap sstateAfter,
        contextStorageTxMap = storageTxMap sstateAfter,
        contextStorageBlockMap = storageBlockMap sstateAfter
        }
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
  , _actionEvents             = Q.empty
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

getTypeOfName' :: String -> CodeCollection -> Typo
getTypeOfName' s (CodeCollection ccs) =
  let lookInContract :: Contract -> [Typo]
      lookInContract (Contract{..}) = catMaybes
        [ fmap StructTypo (M.lookup s _structs)
        , fmap EnumTypo (M.lookup s _enums)
        ]
      ctrs = map ContractTypo $ M.keys ccs
   in case concatMap lookInContract ccs ++ ctrs of
        [] -> internalError "getTypeOfName" s
        (typo:_) -> typo

getTypeOfName :: MonadSM m => String -> m Typo
getTypeOfName s = getTypeOfName' s . codeCollection <$> getCurrentCallInfo



addCallInfo :: MonadSM m
            => Address
            -> Contract
            -> String
            -> SHA
            -> CodeCollection
            -> Map String (Xabi.Type, Variable)
            -> m ()
addCallInfo a c fn hsh cc initialLocalVariables = do
  atx <- getAddressStateTxDBMap
  ab  <- getAddressStateBlockDBMap
  stx <- getMemRawStorageTxDB
  sb  <- getMemRawStorageBlockDB

  let newCallInfo =
        CallInfo {
          currentFunctionName=fn,
          currentAddress=a,
          currentContract=c,
          codeCollection=cc,
          collectionHash=hsh,
          localVariables=initialLocalVariables,
          callInfoAddressStateTxDBMap = atx,
          callInfoAddressStateBlockDBMap = ab,
          callInfoStorageTxMap = stx,
          callInfoStorageBlockMap = sb
        }

  Mod.modify_ (Mod.Proxy @[CallInfo]) $ pure . (newCallInfo:)

popCallInfo :: MonadSM m => m ()
popCallInfo = do
  atx <- getAddressStateTxDBMap
  ab  <- getAddressStateBlockDBMap
  stx <- getMemRawStorageTxDB
  sb  <- getMemRawStorageBlockDB
  Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
    [] -> internalError "popCallInfo was called on an already empty stack" ()
    (_:rest) -> pure rest
  putAddressStateTxDBMap atx
  putAddressStateBlockDBMap ab
  putMemRawStorageTxMap stx
  putMemRawStorageBlockMap sb


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
      (theType, _) = fromMaybe (unknownVariable "setLocal called for variable that doesn't exist" name)
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
 Xabi.Mapping{} -> return TComplex
 tt'' -> todo "hintFromType" tt''

getXabiType' :: B.ByteString -> CallInfo -> Maybe Xabi.Type
getXabiType' field callInfo = M.lookup (BC.unpack field)
                            . fmap Xabi.varType
                            . _storageDefs
                            . currentContract
                            $ callInfo

getCallInfoForAddress :: Mod.Modifiable [CallInfo] m => Address -> m CallInfo
getCallInfoForAddress addr = do
  -- This field might have been defined in e.g. a caller contract.
  -- We search from the top down for the home of this data
  stack <- Mod.get (Mod.Proxy @[CallInfo])
  case filter ((== addr) . currentAddress) stack of
    [] -> internalError "address not found in call stack" (addr, stack)
    (callInfo:_) -> return callInfo

getXabiType :: Mod.Modifiable [CallInfo] m => Address -> B.ByteString -> m (Maybe Xabi.Type)
getXabiType addr field = getXabiType' field <$> getCallInfoForAddress addr

getXabiValueType :: MonadSM m => AddressedPath -> m Xabi.Type
getXabiValueType (AddressedPath loc path) = do
  ccs' <- codeCollection <$> getCurrentCallInfo
  let field = MS.getField path
  mType <- getXabiType loc field
  case mType of
    Nothing -> todo "getXabiValueType/unknown storage reference" field
    Just v -> return $ loop ccs' (tail $ MS.toList path) v
 where loop :: CodeCollection -> [MS.StoragePathPiece] -> Xabi.Type -> Xabi.Type
       loop _ [] = id
       loop ccs [x] = \case
         Xabi.Mapping{Xabi.value=v} -> case x of
           MS.MapIndex{} -> v
           _ -> typeError "non map index attribute of mapping" x
         Xabi.Array{Xabi.entry=v} -> case x of
           MS.Field "length" -> Xabi.Int{signed=Just True, bytes=Nothing}
           MS.ArrayIndex{} -> v
           _ -> typeError "non-length or array index attribute of array" x
         Xabi.String{} -> case x of
           MS.Field "length" -> Xabi.Int{signed=Just True, bytes=Nothing}
           _ -> typeError "non-length attribute of string" x
         Xabi.Label s ->
           let t' = getTypeOfName' s ccs
            in case (x, t') of
                 (MS.Field n, StructTypo fs) ->
                   let mt'' = lookup (decodeUtf8 n) fs
                    in case mt'' of
                        Just t'' -> Xabi.fieldTypeType t''
                        Nothing -> missingField "field not present in struct definition" $ show (n, fs)
                 (_, StructTypo{}) -> typeError "non field access to struct" x
                 (_, ContractTypo{}) -> todo "getValueType/contract access" t'
                 (_, EnumTypo{}) -> todo "getValueType/enum acess" t'
         t'' -> todo "atomic type does not have value type" t''
       loop ccs (_:rs) = \case
          Xabi.Mapping{Xabi.value=t'} -> loop ccs rs t'
          Xabi.Array{Xabi.entry=t'} -> loop ccs rs t'
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
              e -> internalError "SolidVM Diff executing in EVM" $ show e
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    actionData . at owner . mapped . actionDataStorageDiffs %= ins

addEvent :: Mod.Modifiable (Q.Seq Event) m => Event -> m ()
addEvent newEvent = Mod.modify_ (Mod.Proxy @(Q.Seq Event)) $ pure . (Q.|> newEvent)
