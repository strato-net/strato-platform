{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# LANGUAGE UndecidableInstances  #-}


module Blockchain.SolidVM.SM (
  CallInfo(..),
  SState(..),
  SM,
  MonadSM,
  action,
  runSM,
  getCurrentAccount,
  addCallInfo,
  dupCallInfo,
  popCallInfo,
  withTempCallInfo,
  getLocal,
  setLocal,
  getCurrentCallInfo,
  getCurrentCallInfoIfExists,
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
import           Control.Monad.Catch (MonadCatch)
import           Control.Monad.FT
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Class
import qualified Control.Monad.Trans.State as StateT
import           Data.Bifunctor (first)
import           Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.UTF8  as UTF8
--import           Data.IORef
import           Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import           Data.Maybe
import qualified Data.NibbleString as N
import qualified Data.Sequence as Q
import qualified Data.Text as T
import           Data.Text.Encoding(encodeUtf8,decodeUtf8)
import           Debugger

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.X509CertDB
import           Blockchain.ExtWord
import           Blockchain.Output
import           Blockchain.Strato.Model.Action
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Event
import           Blockchain.Strato.Model.Keccak256
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
  { currentFunctionName :: String
  , currentAccount      :: Account
  , currentContract     :: Contract
  , codeCollection      :: CodeCollection
  , collectionHash      :: Keccak256
  , localVariables      :: Map String (Xabi.Type, Variable)
  , readOnly            :: Bool
  , currentSourcePos    :: Maybe Xabi.SourcePos
  } deriving (Show)

{-
BlockData
    parentHash Keccak256
    unclesHash Keccak256
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
    mixHash Keccak256
    deriving Eq Read Show Generic
-}

data SState = SState
  { env             :: Env.Environment
  , callStack       :: [CallInfo]
  , ssEvents        :: Q.Seq Event
  , _ssMemDBs       :: MemDBs
  , _action         :: Action
  }
makeLenses ''SState

type SM m = StateT.StateT SState m

type MonadSM m = ( (Account `Alters` AddressState) m
                 , (Keccak256 `Alters` DBCode) m
                 , HasX509CertDB m
                 , (Maybe Word256 `Selects` ParentChainId) m
                 , HasRawStorageDB m
                 , HasMemAddressStateDB m
                 , HasMemRawStorageDB m
                 , Gettable Env.Environment m
                 , Modifiable MemDBs m
                 , Modifiable Env.Sender m
                 , Modifiable [CallInfo] m
                 , Modifiable Action m
                 , Modifiable (Q.Seq Event) m
                 , Modifiable (Maybe DebugSettings) m
                 , MonadIO m --todo: remove
                 , MonadCatch m
                 , MonadLogger m
                 )

instance Monad m => HasMemAddressStateDB (SM m) where
  getAddressStateTxDBMap      = StateT.gets $ _stateTxMap . _ssMemDBs
  putAddressStateTxDBMap    m = StateT.modify $ ssMemDBs . stateTxMap .~ m
  getAddressStateBlockDBMap   = StateT.gets $ _stateBlockMap . _ssMemDBs
  putAddressStateBlockDBMap m = StateT.modify $ ssMemDBs . stateBlockMap .~ m

instance Monad m => HasMemRawStorageDB (SM m) where
  getMemRawStorageTxDB       = StateT.gets $ _storageTxMap . _ssMemDBs
  putMemRawStorageTxMap    m = StateT.modify $ ssMemDBs . storageTxMap .~ m
  getMemRawStorageBlockDB    = StateT.gets $ _storageBlockMap . _ssMemDBs
  putMemRawStorageBlockMap m = StateT.modify $ ssMemDBs . storageBlockMap .~ m

instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Selectable RawStorageValue RawStorageKey (SM m) where
  select = genericLookupRawStorageDB
  selectWithFallback = genericLookupWithFallbackRawStorageDB
instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Insertable RawStorageValue RawStorageKey (SM m) where
  insert = genericInsertRawStorageDB
instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Deletable RawStorageValue RawStorageKey (SM m) where
  delete = genericDeleteRawStorageDB
instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Alterable RawStorageValue RawStorageKey (SM m) where

instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Selectable AddressState Account (SM m) where
  select = getAddressStateMaybe
instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Insertable AddressState Account (SM m) where
  insert = putAddressState
instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Deletable AddressState Account (SM m) where
  delete = deleteAddressState
instance ( Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Alterable AddressState Account (SM m) where

instance Selectable MP.StateRoot (Maybe Word256) m
         => Selectable MP.StateRoot (Maybe Word256) (SM m) where
  select chainId = do
    (CurrentBlockHash bh) <- get @CurrentBlockHash
    mSR <- view (stateRoots . at (bh, chainId)) <$> get @MemDBs
    case mSR of
      Just sr -> pure $ Just sr
      Nothing -> lift $ select chainId
instance Insertable MP.StateRoot (Maybe Word256) m
         => Insertable MP.StateRoot (Maybe Word256) (SM m) where
  insert chainId sr = do
    (CurrentBlockHash bh) <- get @CurrentBlockHash
    modifyStatefully_ @MemDBs $ stateRoots %= M.insert (bh, chainId) sr
    lift $ insert chainId sr
instance Deletable MP.StateRoot (Maybe Word256) m
         => Deletable MP.StateRoot (Maybe Word256) (SM m) where
  delete chainId = do
    (CurrentBlockHash bh) <- get @CurrentBlockHash
    modifyStatefully_ @MemDBs $ stateRoots %= M.delete (bh, chainId)
    lift $ delete @MP.StateRoot chainId
instance Alterable MP.StateRoot (Maybe Word256) m
         => Alterable MP.StateRoot (Maybe Word256) (SM m) where

instance Monad m => Gettable CurrentBlockHash (SM m) where
  get    = fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0) . _currentBlock <$> get @MemDBs
instance Monad m => Puttable CurrentBlockHash (SM m) where
  put md = modifyStatefully_ @MemDBs $ currentBlock ?= md
instance Monad m => Modifiable CurrentBlockHash (SM m) where

instance Selectable ParentChainId (Maybe Word256) m => Selectable ParentChainId (Maybe Word256) (SM m) where
  select = lift . select

instance Selectable MP.NodeData MP.StateRoot m => Selectable MP.NodeData MP.StateRoot (SM m) where
  select   = lift . select
instance Insertable MP.NodeData MP.StateRoot m => Insertable MP.NodeData MP.StateRoot (SM m) where
  insert k = lift . insert k
instance Deletable  MP.NodeData MP.StateRoot m => Deletable  MP.NodeData MP.StateRoot (SM m) where
  delete   = lift . delete @MP.NodeData
instance Alterable  MP.NodeData MP.StateRoot m => Alterable  MP.NodeData MP.StateRoot (SM m) where

instance Selectable DBCode Keccak256 m => Selectable DBCode Keccak256 (SM m) where
  select   = lift . select
instance Insertable DBCode Keccak256 m => Insertable DBCode Keccak256 (SM m) where
  insert k = lift . insert k
instance Deletable  DBCode Keccak256 m => Deletable  DBCode Keccak256 (SM m) where
  delete   = lift . delete @DBCode
instance Alterable  DBCode Keccak256 m => Alterable  DBCode Keccak256 (SM m) where

instance Selectable X509Certificate Account m => Selectable X509Certificate Account (SM m) where
  select   = lift . select
instance Insertable X509Certificate Account m => Insertable X509Certificate Account (SM m) where
  insert k = lift . insert k
instance Deletable  X509Certificate Account m => Deletable  X509Certificate Account (SM m) where
  delete   = lift . delete @X509Certificate
instance Alterable  X509Certificate Account m => Alterable  X509Certificate Account (SM m) where

instance Selectable N.NibbleString N.NibbleString m => Selectable N.NibbleString N.NibbleString (SM m) where
  select   = lift . select
instance Insertable N.NibbleString N.NibbleString m => Insertable N.NibbleString N.NibbleString (SM m) where
  insert k = lift . insert k
instance Deletable  N.NibbleString N.NibbleString m => Deletable  N.NibbleString N.NibbleString (SM m) where
  delete   = lift . delete @N.NibbleString
instance Alterable  N.NibbleString N.NibbleString m => Alterable  N.NibbleString N.NibbleString (SM m) where

instance Monad m => Gettable Env.Environment (SM m) where
  get = StateT.gets env

instance (Monad m, Gettable (Maybe DebugSettings) m)
  => Gettable (Maybe DebugSettings) (SM m) where
  get = lift $ get @(Maybe DebugSettings)
instance (Monad m, Puttable (Maybe DebugSettings) m)
  => Puttable (Maybe DebugSettings) (SM m) where
  put = lift . put @(Maybe DebugSettings)
instance (Monad m, Modifiable (Maybe DebugSettings) m)
  => Modifiable (Maybe DebugSettings) (SM m) where

instance Monad m => Gettable Env.Sender (SM m) where
  get = Env.Sender . Env.sender <$> StateT.gets env
instance Monad m => Puttable Env.Sender (SM m) where
  put (Env.Sender s) = StateT.modify $ \ss@SState{env=e} -> ss{env = e{Env.sender = s}}
instance Monad m => Modifiable Env.Sender (SM m) where

instance Monad m => Gettable [CallInfo] (SM m) where
  get    = StateT.gets callStack
instance Monad m => Puttable [CallInfo] (SM m) where
  put cs = StateT.modify $ \ss -> ss{callStack = cs}
instance Monad m => Modifiable [CallInfo] (SM m) where

instance Monad m => Gettable MemDBs (SM m) where
  get    = StateT.gets $ _ssMemDBs
instance Monad m => Puttable MemDBs (SM m) where
  put md = StateT.modify $ ssMemDBs .~ md
instance Monad m => Modifiable MemDBs (SM m) where

instance Monad m => Gettable Action (SM m) where
  get = use action
instance Monad m => Puttable Action (SM m) where
  put = assign action
instance Monad m => Modifiable Action (SM m) where

  -- adding events to the action so that slipstream gets them,
  --   and also to the events field of the sstate, so that they get sent to
  --    TxrIndexer for governance updates
instance Monad m => Gettable (Q.Seq Event) (SM m) where
  get   = StateT.gets ssEvents
instance Monad m => Puttable (Q.Seq Event) (SM m) where
  put q = do
    action . actionEvents .= q
    StateT.modify $ \sstate -> sstate { ssEvents = q }
instance Monad m => Modifiable (Q.Seq Event) (SM m) where

runSM :: ( MonadIO m
         , MonadUnliftIO m
         , MonadLogger m
         , Modifiable ContextState m
         )
      => (Maybe ByteString)
      -> Env.Environment
      -> SM m a
      -> m (Either SolidException a)
runSM maybeCode env f = do
  csMemDBs <- _memDBs <$> get @ContextState

  let startingState =
        SState {
        env = env,
        callStack = [],
        ssEvents = Q.empty,
        _ssMemDBs = csMemDBs,
        _action = startingAction maybeCode env
        }

  eValState <- try $ StateT.runStateT f startingState
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
      modifyStatefully_ @ContextState $ memDBs .= _ssMemDBs sstateAfter
      return $ Right value


-- When calling a remote contract, the new `msg.sender` is the contract
-- that the call is initiated from.
pushSender :: MonadSM m => Account -> m a -> m a
pushSender newSender mv = do
  oldSender <- modifyReturningPure @Env.Sender (,Env.Sender newSender)
  ret <- mv
  put @Env.Sender oldSender
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
          Just $ M.insert "src" (T.pack $ UTF8.toString theCode) $ fromMaybe M.empty $ Env.metadata env'
        Nothing -> Env.metadata env'
  , _actionEvents             = Q.empty
  }




getEnv :: MonadSM m => m Env.Environment
getEnv = get @Env.Environment

toMaybe :: Bool -> a -> Maybe a
toMaybe True x = Just x
toMaybe False _ = Nothing


getVariableOfName :: MonadSM m => String -> m Variable
getVariableOfName name = do
  cStack <- get @[CallInfo]
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
      maybeBuiltinFunction = toMaybe (name `elem` ["address", "account", "uint", "int", "bool", "byte", "bytes"
                                                  , "string", "keccak256"
                                                  , "require", "revert", "assert", "sha3"
                                                  , "sha256", "ecrecover", "addmod", "mulmod"
                                                  , "selfdestruct", "suicide", "bytes32ToString"
                                                  , "registerCert", "getUserCert", "parseCert"]) $
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
        then Just . Constant . SReference $ AccountPath
                (currentAccount currentCallInfo)
                (MS.singleton $ BC.pack name)
        else Nothing

      maybeThis :: Maybe Variable
      maybeThis = toMaybe (name == "this") . t "this" . Constant . SAccount . accountOnUnspecifiedChain $ currentAccount currentCallInfo



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
            => Account
            -> Contract
            -> String
            -> Keccak256
            -> CodeCollection
            -> Map String (Xabi.Type, Variable)
            -> Bool
            -> m ()
addCallInfo a c fn hsh cc initialLocalVariables ro = do
  let newCallInfo =
        CallInfo {
          currentFunctionName=fn,
          currentAccount=a,
          currentContract=c,
          codeCollection=cc,
          collectionHash=hsh,
          localVariables=initialLocalVariables,
          readOnly=ro,
          currentSourcePos=Nothing
        }

  modifyPure_ @[CallInfo] (newCallInfo:)

dupCallInfo :: MonadSM m => Bool -> m ()
dupCallInfo ro = modifyPure_ @[CallInfo] $ \case
  [] -> internalError "dupCallInfo was called on an already empty stack" ()
  (ci:rest) -> ci{readOnly=ro}:ci:rest

popCallInfo :: MonadSM m => m ()
popCallInfo = modifyPure_ @[CallInfo] $ \case
  [] -> internalError "popCallInfo was called on an already empty stack" ()
  (_:rest) -> rest

withTempCallInfo :: MonadSM m => Bool -> m a -> m a
withTempCallInfo ro f = do
  dupCallInfo ro
  result <- f
  popCallInfo
  pure result

getCurrentCallInfo :: MonadSM m => m CallInfo
getCurrentCallInfo = do
  cs <- get @[CallInfo]
  case cs of
    [] -> internalError "getCurrentCallInfo called with an empty stack" ()
    (currentCallInfo:_) -> return currentCallInfo

getCurrentCallInfoIfExists :: MonadSM m => m (Maybe CallInfo)
getCurrentCallInfoIfExists = listToMaybe <$> get @[CallInfo]

getCurrentContract :: MonadSM m => m Contract
getCurrentContract = do
  cs <- get @[CallInfo]
  case cs of
    (currentCallInfo:_) -> return $ currentContract currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()

getCurrentAccount :: MonadSM m => m Account
getCurrentAccount = do
  cs <- get @[CallInfo]
  case cs of
    (currentCallInfo:_) -> return $ currentAccount currentCallInfo
    _ -> internalError "getCurrentAccount called with an empty stack" ()


getCurrentFunctionName :: MonadSM m => m String
getCurrentFunctionName = do
  cs <- get @[CallInfo]
  case cs of
    (currentCallInfo:_) -> return $ currentFunctionName currentCallInfo
    _ -> internalError "getCurrentFunctionName called with an empty stack" ()


getLocal :: MonadSM m => String -> m (Maybe Variable)
getLocal name = do
  currentCallInfo <- getCurrentCallInfo
  return $ fmap snd $ M.lookup name $ localVariables currentCallInfo

setLocal :: MonadSM m => String -> Variable -> m ()
setLocal name val = do
  stack <- get @[CallInfo]
  let (info, rest) = case stack of
                (ci:r) -> (ci,r)
                [] -> internalError "setLocal stack underflow" ()
      locals = localVariables info
      (theType, _) = fromMaybe (unknownVariable "setLocal called for variable that doesn't exist" name)
                     $ M.lookup name locals
      newVariables = M.insert name (theType, val) locals
  put @[CallInfo] $ info{localVariables=newVariables} : rest


getCurrentCodeCollection :: MonadSM m => m (Keccak256, CodeCollection)
getCurrentCodeCollection = do
  cs <- get @[CallInfo]
  case cs of
    (currentCallInfo:_) -> return (collectionHash currentCallInfo, codeCollection currentCallInfo)
    _ -> internalError "getCurrentContract called with an empty stack" ()

hintFromType :: MonadSM m => Xabi.Type -> m BasicType
hintFromType = \case
 Xabi.Address{} -> return TAccount
 Xabi.Account{} -> return TAccount
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

getCallInfoForAccount :: Gettable [CallInfo] m => Account -> m CallInfo
getCallInfoForAccount acct = do
  -- This field might have been defined in e.g. a caller contract.
  -- We search from the top down for the home of this data
  stack <- get @[CallInfo]
  case filter ((== acct) . currentAccount) stack of
    [] -> internalError "account not found in call stack" (acct, stack)
    (callInfo:_) -> return callInfo

getXabiType :: Gettable [CallInfo] m => Account -> B.ByteString -> m (Maybe Xabi.Type)
getXabiType acct field = getXabiType' field <$> getCallInfoForAccount acct

getXabiValueType :: MonadSM m => AccountPath -> m Xabi.Type
getXabiValueType (AccountPath loc path) = do
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

getValueType :: MonadSM m => AccountPath -> m BasicType
getValueType p = hintFromType =<< getXabiValueType p

initializeAction :: Modifiable Action m => Account -> String -> Keccak256 -> m ()
initializeAction acct name hsh = do
  let newData = ActionData (SolidVMCode name hsh) SolidVM (ActionSolidVMDiff M.empty) []
  modifyStatefully_ $
    actionData %= M.insertWith mergeActionData acct newData

markDiffForAction :: Modifiable Action m => Account -> MS.StoragePath -> MS.BasicValue -> m ()
markDiffForAction owner key' val' = do
  let key = MS.unparsePath key'
      val = rlpSerialize $ rlpEncode val'
      ins = \case
              ActionSolidVMDiff m -> ActionSolidVMDiff $ M.insert key val m
              e -> internalError "SolidVM Diff executing in EVM" $ show e
  modifyStatefully_ $
    actionData . at owner . mapped . actionDataStorageDiffs %= ins

addEvent :: Modifiable (Q.Seq Event) m => Event -> m ()
addEvent newEvent = modifyPure_ @(Q.Seq Event) (Q.|> newEvent)
