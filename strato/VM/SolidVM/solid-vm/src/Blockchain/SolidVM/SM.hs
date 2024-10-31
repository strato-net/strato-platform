{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.SolidVM.SM
  ( CallInfo (..),
    SState (..),
    SM,
    MonadSM,
    action,
    runSM,
    getCurrentAccount,
    withCallInfo,
    withTempCallInfo,
    withUncheckedCallInfo,
    withLocalVars,
    getLocal,
    setLocal,
    getCurrentCallInfo,
    getCurrentCallInfoIfExists,
    getCurrentContract,
    getCurrentChainId,
    getCurrentFunctionName,
    getCurrentCodeCollection,
    addFunctionToCurrentContractInCurrentCallInfo,
    removeFunctionFromCurrentContractInCurrentCallInfo,
    getEnv,
    getGasInfo,
    getVariableOfName,
    getTypeOfName,
    getXabiType,
    getXabiValueType,
    getValueType,
    pushSender,
    initializeAction,
    -- lookupX509AddrFromCBHash,
    markDiffForAction,
    getBlockHashWithNumber,
    getBSum,
    addEvent,
    addDelegatecall,
    getCodeAndCollection,
    getContractsForParents,
    getAbstractParentsFromContract,
    getMapNamesFromContract,
    getArrayNamesFromContract,
    resolveNameParts
  )
where

--import           Data.IORef

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockSummary
import Blockchain.Data.ChainInfo
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.GasInfo
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action
import Blockchain.VMContext
import Blockchain.VMOptions
import Control.Applicative ((<|>))
import Control.DeepSeq (force, ($!!))
import Control.Lens hiding (Context)
import Control.Monad
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Trans.Class
import Control.Monad.Trans.Reader
import Data.Bifunctor (first)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.UTF8 as UTF8
import Data.Map (Map)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map as M
import Data.Maybe
import qualified Data.NibbleString as N
import qualified Data.Sequence as Q
import Data.Source
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import Debugger
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
import qualified Text.Colors as CL
import Text.Format
import UnliftIO
import Prelude hiding (EQ, GT, LT)
import qualified Prelude as Ordering (Ordering (..))

data CallInfo = CallInfo
  { currentFunctionName :: SolidString,
    currentAccount :: Account,
    currentContract :: CC.Contract,
    codeCollection :: CC.CodeCollection,
    collectionHash :: Keccak256,
    localVariables :: Map SolidString (SVMType.Type, Variable),
    readOnly :: Bool,
    isUncheckedSection :: Bool, -- TODO: Perform overflow/underflow checks for all arithmetic operations and revert if so, use this flag to disable checks
    currentSourcePos :: Maybe SourcePosition,
    isFreeFunction :: Bool
  }
  deriving (Show)

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
  { env :: Env.Environment,
    callStack :: [CallInfo],
    _ssMemDBs :: MemDBs,
    _action :: !Action,
    _gasInfo :: GasInfo
  }

makeLenses ''SState

type SM m = ReaderT (IORef SState) m

type MonadSM m =
  ( (Account `A.Alters` AddressState) m,
    A.Selectable Account AddressState m,
    HasStateDB m,
    (Keccak256 `A.Alters` DBCode) m,
    (Keccak256 `A.Alters` BlockSummary) m,
    HasSelectX509CertDB m,
    HasSelectX509FieldDB m,
    A.Selectable Word256 ParentChainIds m,
    A.Selectable (Address, T.Text) X509CertificateField m,
    HasRawStorageDB m,
    HasMemAddressStateDB m,
    HasMemRawStorageDB m,
    Mod.Accessible Env.Environment m,
    Mod.Modifiable GasInfo m,
    Mod.Modifiable MemDBs m,
    Mod.Modifiable Env.Sender m,
    Mod.Modifiable [CallInfo] m,
    Mod.Modifiable Action m,
    Mod.Modifiable (Q.Seq Event) m,
    Mod.Modifiable (Q.Seq Action.Delegatecall) m,
    Mod.Modifiable (Maybe DebugSettings) m,
    MonadUnliftIO m, --todo: remove
    MonadCatch m,
    MonadLogger m
  )

get :: MonadUnliftIO m => SM m SState
get = readIORef =<< ask
{-# INLINE get #-}

gets :: MonadUnliftIO m => (SState -> a) -> SM m a
gets f = f <$> get
{-# INLINE gets #-}

modify :: MonadUnliftIO m => (SState -> SState) -> SM m ()
modify f = ask >>= \i -> atomicModifyIORef' i (\a -> (f a, ()))
{-# INLINE modify #-}

instance MonadUnliftIO m => HasMemAddressStateDB (SM m) where
  getAddressStateTxDBMap = gets $ _stateTxMap . _ssMemDBs
  putAddressStateTxDBMap m = modify $ ssMemDBs . stateTxMap .~ m
  getAddressStateBlockDBMap = gets $ _stateBlockMap . _ssMemDBs
  putAddressStateBlockDBMap m = modify $ ssMemDBs . stateBlockMap .~ m

instance MonadUnliftIO m => HasMemRawStorageDB (SM m) where
  getMemRawStorageTxDB = gets $ _storageTxMap . _ssMemDBs
  putMemRawStorageTxMap m = modify $ ssMemDBs . storageTxMap .~ m
  getMemRawStorageBlockDB = gets $ _storageBlockMap . _ssMemDBs
  putMemRawStorageBlockMap m = modify $ ssMemDBs . storageBlockMap .~ m

instance
  ( MonadUnliftIO m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    MonadLogger m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (N.NibbleString `A.Alters` N.NibbleString) m
  ) =>
  (RawStorageKey `A.Alters` RawStorageValue) (SM m)
  where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance
  ( MonadUnliftIO m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    MonadLogger m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (N.NibbleString `A.Alters` N.NibbleString) m
  ) =>
  (Account `A.Alters` AddressState) (SM m)
  where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance
  ( MonadUnliftIO m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    MonadLogger m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (N.NibbleString `A.Alters` N.NibbleString) m
  ) =>
  A.Selectable Account AddressState (SM m)
  where
  select _ = getAddressStateMaybe

instance
  (MonadUnliftIO m, (Maybe Word256 `A.Alters` MP.StateRoot) m) =>
  (Maybe Word256 `A.Alters` MP.StateRoot) (SM m)
  where
  lookup p chainId = do
    (CurrentBlockHash bh) <- Mod.get (Mod.Proxy @CurrentBlockHash)
    mSR <- view (stateRoots . at (bh, chainId)) <$> Mod.get (Mod.Proxy @MemDBs)
    case mSR of
      Just sr -> pure $ Just sr
      Nothing -> lift $ A.lookup p chainId
  insert p chainId sr = do
    (CurrentBlockHash bh) <- Mod.get (Mod.Proxy @CurrentBlockHash)
    Mod.modifyStatefully_ (Mod.Proxy @MemDBs) $ stateRoots %= M.insert (bh, chainId) sr
    lift $ A.insert p chainId sr
  delete p chainId = do
    (CurrentBlockHash bh) <- Mod.get (Mod.Proxy @CurrentBlockHash)
    Mod.modifyStatefully_ (Mod.Proxy @MemDBs) $ stateRoots %= M.delete (bh, chainId)
    lift $ A.delete p chainId

instance MonadUnliftIO m => Mod.Modifiable CurrentBlockHash (SM m) where
  get _ = fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0) . _currentBlock <$> Mod.get (Mod.Proxy @MemDBs)
  put _ md = Mod.modifyStatefully_ (Mod.Proxy @MemDBs) $ currentBlock ?= md

instance A.Selectable Word256 ParentChainIds m => A.Selectable Word256 ParentChainIds (SM m) where
  select p = lift . A.select p

instance (Keccak256 `A.Alters` BlockSummary) m => (Keccak256 `A.Alters` BlockSummary) (SM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance (MP.StateRoot `A.Alters` MP.NodeData) m => (MP.StateRoot `A.Alters` MP.NodeData) (SM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance (Keccak256 `A.Alters` DBCode) m => (Keccak256 `A.Alters` DBCode) (SM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance (Address `A.Selectable` X509Certificate) m => (Address `A.Selectable` X509Certificate) (SM m) where
  select p k = lift $ A.select p k

instance ((Address, T.Text) `A.Selectable` X509CertificateField) m => ((Address, T.Text) `A.Selectable` X509CertificateField) (SM m) where
  select p k = lift $ A.select p k

instance (N.NibbleString `A.Alters` N.NibbleString) m => (N.NibbleString `A.Alters` N.NibbleString) (SM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance MonadUnliftIO m => Mod.Accessible Env.Environment (SM m) where
  access _ = gets env

instance
  (Mod.Modifiable (Maybe DebugSettings) m) =>
  Mod.Modifiable (Maybe DebugSettings) (SM m)
  where
  get _ = lift $ Mod.get (Mod.Proxy @(Maybe DebugSettings))
  put _ = lift . Mod.put (Mod.Proxy @(Maybe DebugSettings))

instance MonadUnliftIO m => Mod.Modifiable Env.Sender (SM m) where
  get _ = Env.Sender . Env.sender <$> gets env
  put _ (Env.Sender s) = modify $ \ss@SState {env = e} -> ss {env = e {Env.sender = s}}

instance MonadUnliftIO m => Mod.Modifiable [CallInfo] (SM m) where
  get _ = gets callStack
  put _ cs = modify $ \ss -> ss {callStack = cs}

instance MonadUnliftIO m => Mod.Modifiable MemDBs (SM m) where
  get _ = gets _ssMemDBs
  put _ md = modify $ ssMemDBs .~ md

instance MonadUnliftIO m => Mod.Modifiable GasInfo (SM m) where
  get _ = gets _gasInfo
  put _ g = modify $ gasInfo .~ g

instance MonadUnliftIO m => Mod.Modifiable Action (SM m) where
  get _ = gets _action
  put _ a = modify $ action .~ a

instance MonadUnliftIO m => Mod.Modifiable (Q.Seq Event) (SM m) where
  get _ = gets (Action._events . _action)
  put _ q = modify $ action . Action.events .~ q

instance MonadUnliftIO m => Mod.Modifiable (Q.Seq Action.Delegatecall) (SM m) where
  get _ = gets (Action._delegatecalls . _action)
  put _ q = modify $ action . Action.delegatecalls .~ q

runSM ::
  ( MonadUnliftIO m,
    MonadLogger m,
    Mod.Modifiable ContextState m,
    Mod.Modifiable GasCap m
  ) =>
  (Maybe Code) ->
  Env.Environment ->
  GasInfo ->
  Maybe Word256 ->
  SM m a ->
  m (Either SolidException a)
runSM maybeCode env gi chainId' f = do
  csMemDBs <- _memDBs <$> Mod.get (Mod.Proxy @ContextState)
  GasCap gasCap <- Mod.get (Mod.Proxy @GasCap)
  $logInfoS "runSM/GasCap/status" . T.pack $ "Current gas cap: " ++ CL.green (show gasCap)
  let !startingState =
        SState
          { env = env,
            callStack = [],
            _ssMemDBs = csMemDBs,
            _action = startingAction maybeCode env chainId',
            _gasInfo = gi {_gasLeft = min (_gasLeft gi) gasCap} -- capping the transaction gas limit
          }
  startingStateRef <- newIORef startingState
  eVal <- try $ runReaderT f startingStateRef
  sstateAfter <- readIORef startingStateRef
  case eVal of
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
    Right value -> do
      Mod.modifyStatefully_ (Mod.Proxy @ContextState) $ memDBs .= _ssMemDBs sstateAfter
      return $ Right value

-- When calling a remote contract, the new `msg.sender` is the contract
-- that the call is initiated from.
pushSender :: MonadSM m => Account -> m a -> m a
pushSender newSender mv = do
  oldSender <- Mod.get (Mod.Proxy @Env.Sender)
  Mod.put (Mod.Proxy @Env.Sender) (Env.Sender newSender)
  ret <- mv
  Mod.put (Mod.Proxy @Env.Sender) oldSender
  return $ ret

startingAction :: Maybe Code -> Env.Environment -> Maybe Word256 -> Action
startingAction maybeCode env' chainId' =
  Action.Action
    { _blockHash = blockHeaderHash $ Env.blockHeader env',
      _blockTimestamp = blockHeaderTimestamp $ Env.blockHeader env',
      _blockNumber = blockHeaderBlockNumber $ Env.blockHeader env',
      _transactionHash = Env.txHash env',
      _transactionChainId = chainId',
      _transactionSender = Env.sender env',
      _actionData = OMap.empty,
      _metadata =
        case maybeCode of
          Just (Code theCode) ->
            Just $ M.insert "src" (T.pack $ UTF8.toString theCode) $ fromMaybe M.empty $ Env.metadata env'
          Just (PtrToCode _) -> Env.metadata env'
          Nothing -> Env.metadata env',
      _events = Q.empty,
      _delegatecalls = Q.empty
    }

getGasInfo :: MonadSM m => m GasInfo
getGasInfo = Mod.get (Mod.Proxy @GasInfo)

getEnv :: MonadSM m => m Env.Environment
getEnv = Mod.access (Mod.Proxy @Env.Environment)

toMaybe :: Bool -> a -> Maybe a
toMaybe True x = Just x
toMaybe False _ = Nothing

getVariableOfName :: MonadSM m => SolidString -> m Variable
getVariableOfName name = do
  cStack <- Mod.get (Mod.Proxy @[CallInfo])
  let currentCallInfo =
        case cStack of
          [] -> internalError "getVariableValue called with an empty stack" name
          (x : _) ->
            if (isFreeFunction x)
              then
                x
                  { currentContract =
                      CC.Contract
                        { CC._contractName = currentContract x ^. CC.contractName,
                          CC._parents = currentContract x ^. CC.parents,
                          CC._constants = M.empty,
                          CC._userDefined = M.empty,
                          CC._storageDefs = M.empty,
                          CC._enums = M.empty,
                          CC._structs = M.empty,
                          CC._errors = M.empty,
                          CC._events = M.empty,
                          CC._functions = M.empty,
                          CC._constructor = currentContract x ^. CC.constructor,
                          CC._modifiers = M.empty,
                          CC._usings = M.empty,
                          CC._contractType = currentContract x ^. CC.contractType,
                          CC._importedFrom = Nothing,
                          CC._contractContext = currentContract x ^. CC.contractContext
                        }
                  }
              else x
      vars = localVariables currentCallInfo
      t s v = ('x' : s, v) `seq` v

  -- when (name == "theSixthSense") (internalError "M. Night Shyamalan presents" currentCallInfo)

  let maybeLocalValue = fmap snd $ M.lookup name vars

  let maybeContractFunction :: Maybe Variable
      maybeContractFunction = fmap (t "constant function" . Constant . SFunction name) $ M.lookup name $ currentContract currentCallInfo ^. CC.functions

      maybeFreeFunction :: Maybe Variable
      maybeFreeFunction = fmap (t "free function" . Constant . SFunction name) $ M.lookup name $ codeCollection currentCallInfo ^. CC.flFuncs

      maybeBuiltinFunction :: Maybe Variable
      maybeBuiltinFunction =
        toMaybe
          ( name
              `elem` [ "address",
                       "account",
                       "uint",
                       "int",
                       "decimal",
                       "bool",
                       "byte",
                       "bytes",
                       "string",
                       "keccak256",
                       "ripemd160",
                       "payable",
                       "require",
                       "revert",
                       "assert",
                       "sha3",
                       "delegatecall",
                       "call",
                       "derive",
                       "sha256",
                       "ecrecover",
                       "blockhash",
                       "addmod",
                       "mulmod",
                       "selfdestruct",
                       "suicide",
                       "bytes32ToString",
                       "create",
                       "create2",
                       "getUserCert",
                       "parseCert",
                       "verifyCert",
                       "verifyCertSignedBy",
                       "verifySignature"
                     ]
          )
          $ t "builtin function" $ Constant $ SBuiltinFunction name Nothing

      maybeBuiltinVariable :: Maybe Variable
      maybeBuiltinVariable =
        toMaybe (name `elem` ["msg", "block", "tx", "super", "now"]) $
          t "builtin variable" $ Constant $ SBuiltinVariable name

      maybeEnum :: Maybe Variable
      maybeEnum =
        toMaybe (name `elem` M.keys (currentContract currentCallInfo ^. CC.enums) || name `elem` M.keys (codeCollection currentCallInfo ^. CC.flEnums)) $
          t "enum" $ Constant $ SEnum name

      maybeConstant :: Maybe Variable
      maybeConstant = fmap (t "constant constant" . Constant) $ do
        let ctract = currentContract currentCallInfo
        let constMap = (codeCollection currentCallInfo) ^. CC.flConstants
        CC.ConstantDecl {..} <- M.lookup name $ (ctract ^. CC.constants) `M.union` constMap
        return $
          coerceType ctract _constType $ case _constInitialVal of
            CC.NumberLiteral _ x _ -> SInteger x
            x -> todo "constant initial val" x

      maybeStructDef :: Maybe Variable
      maybeStructDef =
        toMaybe (name `elem` M.keys (currentContract currentCallInfo ^. CC.structs) || name `elem` M.keys (codeCollection currentCallInfo ^. CC.flStructs)) $
          t "struct def" $ Constant $ SStructDef name

      maybeContract :: Maybe Variable
      maybeContract =
        toMaybe (name `elem` M.keys (codeCollection currentCallInfo ^. CC.contracts)) $
          t "contract" $ Constant $ SContractDef name

      maybeStorageItem :: Maybe Variable
      maybeStorageItem =
        -- TODO(tim): This might just be restricted to a field name
        if name `elem` M.keys (currentContract currentCallInfo ^. CC.storageDefs)
          then
            Just . Constant . SReference $
              AccountPath
                (currentAccount currentCallInfo)
                (MS.singleton $ BC.pack $ labelToString name)
          else Nothing

      maybeThis :: Maybe Variable
      maybeThis = toMaybe (name == "this") . t "this" . Constant . (flip (SAccount . accountOnUnspecifiedChain) False) $ currentAccount currentCallInfo

  --        M.lookup (currentAddress currentCallInfo) (accounts sstate) >>= M.lookup name . storage

  --TODO- Add the constant lookup properly
  {-
    maybeConstantValue <- do
  --    M.lookup (currentAddress currentCallInfo) (accounts sstate) >>= M.lookup name . constants
      liftIO $ putStrLn $ " @@@@@@@@@@@@@@@@@@@ available constants: " ++ show (M.keys $ currentContract currentCallInfo^.constants)
      case M.lookup name $ currentContract currentCallInfo^.constants of
        Nothing -> return Nothing
        Just (CC.ConstantDecl _ _ e) -> do
          let val = constExpToVar e
          return $ Just $ Constant $ val
  -}

  return . fromMaybe (unknownVariable "getVariableOfName" name) . foldr1 (<|>) $
    [ maybeLocalValue,
      maybeStorageItem,
      maybeContractFunction,
      maybeFreeFunction,
      maybeBuiltinFunction,
      maybeBuiltinVariable,
      maybeEnum,
      maybeStructDef,
      maybeContract,
      maybeThis,
      maybeConstant,
      --, maybeUserDefined
      unknownVariable ("getVariableOfName " ++ (show (currentContract currentCallInfo ^. CC.storageDefs))) name
    ]

getTypeOfName' :: SolidString -> CC.CodeCollection -> Typo
getTypeOfName' s (CC.CodeCollection ccs _ _ enms strcts _ _ _) =
  let lookInContract :: CC.Contract -> [Typo]
      lookInContract (CC.Contract {..}) =
        catMaybes
          [ fmap StructTypo (fmap (\(a, b, _) -> (a, b)) <$> M.lookup s _structs),
            fmap EnumTypo (fst <$> M.lookup s _enums),
            fmap StructTypo (fmap (\(a, b, _) -> (a, b)) <$> M.lookup s strcts),
            fmap EnumTypo (fst <$> M.lookup s enms)
          ]
      ctrs = map ContractTypo $ M.keys ccs
   in case concatMap lookInContract ccs ++ ctrs of
        [] -> internalError "getTypeOfName' " s
        (typo : _) -> typo

getTypeOfName :: MonadSM m => SolidString -> m Typo
getTypeOfName s = getTypeOfName' s . codeCollection <$> getCurrentCallInfo

withCallInfo ::
  MonadSM m =>
  Account ->
  CC.Contract ->
  SolidString ->
  Keccak256 ->
  CC.CodeCollection ->
  Map SolidString (SVMType.Type, Variable) ->
  Bool ->
  Bool ->
  m a ->
  m a
withCallInfo a c fn hsh cc initialLocalVariables ro ff f = do
  addCallInfo a c fn hsh cc initialLocalVariables ro ff
  eRes <- try f
  popCallInfo
  case eRes of
    Left (e :: SomeException) -> throwIO e
    Right res -> pure res

addCallInfo ::
  MonadSM m =>
  Account ->
  CC.Contract ->
  SolidString ->
  Keccak256 ->
  CC.CodeCollection ->
  Map SolidString (SVMType.Type, Variable) ->
  Bool ->
  Bool ->
  m ()
addCallInfo a c fn hsh cc initialLocalVariables ro ff = do
  let newCallInfo =
        CallInfo
          { currentFunctionName = fn,
            currentAccount = a,
            currentContract = c,
            codeCollection = cc,
            collectionHash = hsh,
            localVariables = initialLocalVariables,
            readOnly = ro,
            isUncheckedSection = False, -- The rationale here is that unchecked sections only apply to the current stack frame
            currentSourcePos = Nothing,
            isFreeFunction = ff
          }

  Mod.modify_ (Mod.Proxy @[CallInfo]) $ pure . (newCallInfo :)

dupCallInfo :: MonadSM m => Bool -> m ()
dupCallInfo ro = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "dupCallInfo was called on an already empty stack" ()
  (ci : rest) -> pure $ ci {readOnly = ro} : ci : rest

uncheckedCallInfo :: MonadSM m => m ()
uncheckedCallInfo = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "uncheckedCallInfo was called on an already empty stack" ()
  (ci : rest) -> pure $ ci {isUncheckedSection = True} : ci : rest

popCallInfo :: MonadSM m => m ()
popCallInfo = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "popCallInfo was called on an already empty stack" ()
  (_ : rest) -> pure rest

withLocalVars :: MonadSM m => m a -> m a
withLocalVars = bracket_ pushLocalVars popLocalVars

pushLocalVars :: MonadSM m => m ()
pushLocalVars = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "pushLocalVars was called with an empty stack" ()
  (curFrame : rest) -> pure $ curFrame : curFrame : rest

-- The inverse operation as above, called when exiting a statement block and those declared variables need to be destroyed
popLocalVars :: MonadSM m => m ()
popLocalVars = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "popLocalVars was called with an empty stack" ()
  (_ : rest) -> pure rest

withTempCallInfo :: MonadSM m => Bool -> m a -> m a
withTempCallInfo ro f = do
  dupCallInfo ro
  eResult <- try f
  popCallInfo
  case eResult of
    Left (e :: SomeException) -> throwIO e
    Right result -> pure result

withUncheckedCallInfo :: MonadSM m => m a -> m a
withUncheckedCallInfo f = do
  uncheckedCallInfo
  eResult <- try f
  popCallInfo
  case eResult of
    Left (e :: SomeException) -> throwIO e
    Right result -> pure result

getCurrentCallInfo :: MonadSM m => m CallInfo
getCurrentCallInfo = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    [] -> internalError "getCurrentCallInfo called with an empty stack" ()
    (currentCallInfo : _) -> return currentCallInfo

getCurrentCallInfoIfExists :: MonadSM m => m (Maybe CallInfo)
getCurrentCallInfoIfExists = listToMaybe <$> Mod.get (Mod.Proxy @[CallInfo])

getCurrentContract :: MonadSM m => m CC.Contract
getCurrentContract = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ currentContract currentCallInfo
    _ -> internalError "getCurrentContract called with an empty stack" ()

getCurrentAccount :: MonadSM m => m Account
getCurrentAccount = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ currentAccount currentCallInfo
    _ -> internalError "getCurrentAccount called with an empty stack" ()

getCurrentChainId :: MonadSM m => m (Maybe Word256)
getCurrentChainId = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ _accountChainId $ currentAccount currentCallInfo
    _ -> internalError "getCurrentChainId called with an empty stack" ()

getCurrentFunctionName :: MonadSM m => m SolidString
getCurrentFunctionName = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ currentFunctionName currentCallInfo
    _ -> internalError "getCurrentFunctionName called with an empty stack" ()

getLocal :: MonadSM m => SolidString -> m (Maybe Variable)
getLocal name = do
  currentCallInfo <- getCurrentCallInfo
  return $ fmap snd $ M.lookup name $ localVariables currentCallInfo

setLocal :: MonadSM m => SolidString -> Variable -> m ()
setLocal name val = do
  stack <- Mod.get (Mod.Proxy @[CallInfo])
  let (info, rest) = case stack of
        (ci : r) -> (ci, r)
        [] -> internalError "setLocal stack underflow" ()
      locals = localVariables info
      (theType, _) =
        fromMaybe (unknownVariable "setLocal called for variable that doesn't exist" name) $
          M.lookup name locals
      newVariables = M.insert name (theType, val) locals
  Mod.put (Mod.Proxy @[CallInfo]) $ info {localVariables = newVariables} : rest

addFunctionToCurrentContractInCurrentCallInfo :: MonadSM m => SolidString -> CC.Func -> m ()
addFunctionToCurrentContractInCurrentCallInfo funcName funcObject = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> do
      let contract = currentContract currentCallInfo
          -- _functions :: Map SolidString (FuncF a),
          newContract = contract {CC._functions = M.insert funcName funcObject $ CC._functions contract}
      Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
        [] -> internalError "addFunctionToCurrentContractInCurrentCallInfo called with an empty stack" ()
        (ci : rest) -> pure $ ci {currentContract = newContract} : rest
    _ -> internalError "addFunctionToCurrentContractInCurrentCallInfo called with an empty stack" ()

removeFunctionFromCurrentContractInCurrentCallInfo :: MonadSM m => SolidString -> m ()
removeFunctionFromCurrentContractInCurrentCallInfo funcName = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> do
      let contract = currentContract currentCallInfo
          -- _functions :: Map SolidString (FuncF a),
          newContract = contract {CC._functions = M.delete funcName $ CC._functions contract}
      Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
        [] -> internalError "removeFunctionFromCurrentContractInCurrentCallInfo called with an empty stack" ()
        (ci : rest) -> pure $ ci {currentContract = newContract} : rest
    _ -> internalError "removeFunctionFromCurrentContractInCurrentCallInfo called with an empty stack" ()

getCurrentCodeCollection :: MonadSM m => m (Keccak256, CC.CodeCollection)
getCurrentCodeCollection = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return (collectionHash currentCallInfo, codeCollection currentCallInfo)
    _ -> internalError "getCurrentCodeCollection called with an empty stack" ()

hintFromType :: MonadSM m => SVMType.Type -> m BasicType
hintFromType = \case
  SVMType.Address _ -> return TAccount
  SVMType.Account _ -> return TAccount
  SVMType.Bool {} -> return TBool
  SVMType.Bytes {} -> return TString
  SVMType.Int {} -> return TInteger
  SVMType.String {} -> return TString
  SVMType.Decimal {} -> return TDecimal
  (SVMType.UserDefined _ SVMType.Bool {}) -> return TBool
  (SVMType.UserDefined _ SVMType.Int {}) -> return TString
  SVMType.UnknownLabel s _ -> do
    t' <- getTypeOfName s
    case t' of
      ContractTypo {} -> return $ TContract s
      EnumTypo {} -> return $ TEnumVal s
      StructTypo fs -> do
        let upgrade :: MonadSM m => (SolidString, CC.FieldType) -> m (B.ByteString, BasicType)
            upgrade = mapM (hintFromType . CC.fieldTypeType) . first (encodeUtf8 . labelToText)
        TStruct s <$> mapM upgrade fs
  SVMType.Array {} -> return TComplex
  SVMType.Mapping {} -> return TComplex
  tt'' -> todo "hintFromType" tt''

getXabiTypeFromContract :: B.ByteString -> CC.Contract -> Maybe SVMType.Type
getXabiTypeFromContract field ctract =
  M.lookup (stringToLabel $ BC.unpack field)
    . fmap CC._varType
    . CC._storageDefs
    $ ctract

getXabiType :: MonadSM m => Account -> B.ByteString -> m (Maybe SVMType.Type)
getXabiType acct field = do
  (ctract, _, _) <- getCodeAndCollection acct
  pure $ getXabiTypeFromContract field ctract

getXabiValueType :: MonadSM m => AccountPath -> m SVMType.Type
getXabiValueType (AccountPath loc path) = do
  ccs' <- codeCollection <$> getCurrentCallInfo
  let field = MS.getField path
  mType <- getXabiType loc field
  case mType of
    Nothing -> todo "getXabiValueType/unknown storage reference" field
    Just v -> return $!! loop ccs' (tail $ MS.toList path) v
  where
    loop :: CC.CodeCollection -> [MS.StoragePathPiece] -> SVMType.Type -> SVMType.Type
    loop _ [] = id
    loop ccs [x] = \case
      SVMType.Mapping {SVMType.value = v} -> case x of
        MS.MapIndex {} -> v
        _ -> typeError "non map index attribute of mapping" x
      SVMType.Array {SVMType.entry = v} -> case x of
        MS.Field "length" -> SVMType.Int {signed = Just True, bytes = Nothing}
        MS.ArrayIndex {} -> v
        _ -> typeError "non-length or array index attribute of array" x
      SVMType.String {} -> case x of
        MS.Field "length" -> SVMType.Int {signed = Just True, bytes = Nothing}
        _ -> force (typeError "non-length attribute of string" x)
      SVMType.UnknownLabel s _ ->
        let t' = getTypeOfName' s ccs
         in case (x, t') of
              (MS.Field n, StructTypo fs) ->
                let mt'' = lookup (textToLabel $ decodeUtf8 n) fs
                 in case mt'' of
                      Just t'' -> CC.fieldTypeType t''
                      Nothing -> missingField "field not present in struct definition" $ show (n, fs)
              (_, StructTypo {}) -> typeError "non field access to struct" x
              (_, ContractTypo {}) -> todo "getValueType/contract access" t'
              (_, EnumTypo {}) -> todo "getValueType/enum acess" t'
      t'' -> t''
    loop ccs (x : rs) = \case
      SVMType.Mapping {SVMType.value = t'} -> loop ccs rs t'
      SVMType.Array {SVMType.entry = t'} -> loop ccs rs t'
      SVMType.UnknownLabel s _ ->
        let t' = getTypeOfName' s ccs
         in case (x, t') of
              (MS.Field n, StructTypo fs) ->
                let mt'' = lookup (textToLabel $ decodeUtf8 n) fs
                 in case mt'' of
                      Just t'' -> loop ccs rs $ CC.fieldTypeType t''
                      Nothing -> missingField "field not present in struct definition" $ show (n, fs)
              (_, StructTypo {}) -> typeError "non field access to struct" x
              (_, ContractTypo {}) -> todo "getValueType/contract access" t'
              (_, EnumTypo {}) -> todo "getValueType/enum acess" t'
      t -> todo "getXabiValueType/loopnext unsupported type" t

getValueType :: MonadSM m => AccountPath -> m BasicType
getValueType p = hintFromType =<< getXabiValueType p

initializeAction :: MonadSM m
                 => Account
                 -> String
                 -> String
                 -> Maybe String
                 -> String
                 -> String
                 -> Keccak256
                 -> CC.CodeCollection
                 -> Map (Account, T.Text) (T.Text, T.Text, [T.Text])
                 -> [T.Text]
                 -> [T.Text]
                 -> m ()
initializeAction acct name crtr cc_crtr root appName hsh cc ab maps arrs = do
  let newData = Action.ActionData (SolidVMCode name hsh) cc (T.pack crtr) (fmap T.pack cc_crtr) (T.pack root) (T.pack appName) SolidVM (Action.SolidVMDiff M.empty) ab maps arrs []
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData %= Action.omapInsertWith Action.mergeActionData acct newData

markDiffForAction :: Mod.Modifiable Action m => Account -> MS.StoragePath -> MS.BasicValue -> m ()
markDiffForAction owner key' val' = do
  let key = MS.unparsePath key'
      val = rlpSerialize $ rlpEncode val'
      ins = \case
        Action.SolidVMDiff m -> Action.SolidVMDiff $ M.insert key val m
        e -> internalError "SolidVM Diff executing in EVM" $ show e
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData . Action.omapLens owner . mapped . Action.actionDataStorageDiffs %= ins

addEvent :: Mod.Modifiable (Q.Seq Event) m => Event -> m ()
addEvent newEvent = Mod.modify_ (Mod.Proxy @(Q.Seq Event)) $ pure . (Q.|> newEvent)

addDelegatecall :: Mod.Modifiable (Q.Seq Action.Delegatecall) m => Account -> Account -> T.Text -> T.Text -> m ()
addDelegatecall s c o a = Mod.modify_ (Mod.Proxy @(Q.Seq Action.Delegatecall)) $ pure . (Q.|> Action.Delegatecall s c o a)

getBlockHashWithNumber :: MonadSM m => Integer -> Keccak256 -> m (Maybe Keccak256)
getBlockHashWithNumber num h = do
  $logInfoS "getBlockHashWithNumber" . T.pack $ "calling getBSum with " ++ format h
  bSum <- getBSum h
  case num `compare` bSumNumber bSum of
    Ordering.LT -> getBlockHashWithNumber num $ bSumParentHash bSum
    Ordering.EQ -> return $ Just h
    Ordering.GT -> return Nothing

getBSum :: (Keccak256 `A.Alters` BlockSummary) m => Keccak256 -> m BlockSummary
getBSum bh =
  fromMaybe (error $ "missing value in block summary DB: " ++ format bh)
    <$> A.lookup (A.Proxy @BlockSummary) bh

getCodeAndCollection :: MonadSM m => Account -> m (CC.Contract, Keccak256, CC.CodeCollection)
getCodeAndCollection address' = do
  callStack' <- Mod.get (Mod.Proxy @[CallInfo])
  let maybeAddress =
        case callStack' of
          (current' : _) -> Just $ currentAccount current'
          _ -> Nothing

  -- $logDebugS "getCodeAndCollection" . T.pack $ "----------------- caller address: " ++ fromMaybe "Nothing" (fmap format maybeAddress)
  -- $logDebugS "getCodeAndCollection" . T.pack $ "----------------- callee address: " ++ format address'
  if Just address' == maybeAddress
    then do
      c' <- getCurrentContract
      (hsh, cc') <- getCurrentCodeCollection
      return (c', hsh, cc')
    else do
      codeHash <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) address'

      resolvedCodeHash <- resolveCodePtr (address' ^. accountChainId) codeHash
      (contractName', ch, cc) <-
        case resolvedCodeHash of
          Just (SolidVMCode cn ch') -> do
            cc' <- codeCollectionFromHash True ch'
            return (stringToLabel cn, ch', cc')
          Just ch -> internalError "SolidVM for non-solidvm code" (format ch)
          Nothing -> missingCodeCollection "SolidVM for non-existent code" (format codeHash)

      let !contract' = fromMaybe (missingType "getCodeAndCollection" contractName') $ M.lookup contractName' $ cc ^. CC.contracts

      return (contract', ch, cc)

getContractsForParents :: [SolidString] -> M.Map SolidString (CC.ContractF a) -> [CC.ContractF a]
getContractsForParents parents' cc =
  let getContractForParent parent = M.lookup parent cc
   in mapMaybe getContractForParent parents'

-- Only get top-level abstract contracts (e.g. Asset, Sale), to reduce Cirrus table bloat
getAbstractParentsFromContract :: CC.Contract -> CC.CodeCollection -> [CC.Contract]
getAbstractParentsFromContract c cc = M.elems $ CC.getTopLevelAbstractsForContract cc c

getMapNamesFromContract :: CC.Contract -> [T.Text]
getMapNamesFromContract c =
  let storageDefs' = c ^. CC.storageDefs
      storageDefsList = M.toList storageDefs'
      listOfMappings = filter (\(_, vd) -> case (CC._varType vd) of SVMType.Mapping _ _ _ -> True; _ -> False) storageDefsList
      listOfMappingsWithRecords = filter (\(_, vd) -> CC._isRecord vd) listOfMappings
   in T.pack . fst <$> listOfMappingsWithRecords

--also needs to be changed for testnet3 to be only record
getArrayNamesFromContract :: CC.Contract -> [T.Text]
getArrayNamesFromContract c =
  let storageDefs' = c ^. CC.storageDefs
      storageDefsList = M.toList storageDefs'
      listOfArrays = filter (\(_, vd) -> case (CC._varType vd) of SVMType.Array _ _ -> True; _ -> False) storageDefsList
   in T.pack . fst <$> listOfArrays -- we need to change this to filter on _isRecord on testnet3

resolveNameParts ::
  MonadSM m =>
  Account ->
  T.Text ->
  T.Text ->
  CC.Contract ->
  m ((Account, T.Text), (T.Text, T.Text, [T.Text]))
resolveNameParts to' crtr app c = do
  let tName = T.pack . CC._contractName
  case c ^. CC.importedFrom of
    Nothing -> pure ((to', tName c), (crtr, app, (map T.pack (M.keys $ CC._storageDefs c))))
    Just acct ->
      A.select (A.Proxy @AddressState) acct >>= \case
        Nothing -> do
          $logWarnS "processTheMessages/resolveNameParts" . T.pack $
            "Could not find address state for account " ++ show acct
          pure ((acct, tName c), (crtr, app, (map T.pack (M.keys $ CC._storageDefs c))))
        Just s ->
          resolveCodePtr (acct ^. accountChainId) (addressStateCodeHash s) >>= \case
            Just (SolidVMCode appName _) -> do
              appCreator <- getSolidStorageKeyVal' acct $ MS.StoragePath [MS.Field ":creator"]
              case appCreator of
                MS.BString cn' -> pure ((acct, tName c), (T.pack $ BC.unpack cn', T.pack appName, (map T.pack (M.keys $ CC._storageDefs c))))
                _ -> pure ((acct, tName c), (crtr, T.pack appName, (map T.pack (M.keys $ CC._storageDefs c))))
            _ -> do
              $logWarnS "resolveNameParts" . T.pack $
                "Could not resolve code for account " ++ show acct
              pure ((acct, tName c), (crtr, app, (map T.pack (M.keys $ CC._storageDefs c))))
