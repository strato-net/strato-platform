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
    getCurrentAddress,
    getCurrentCodeAddress,
    withCallInfo,
    withStaticCallInfo,
    withUncheckedCallInfo,
    withLocalVars,
    getCurrentCallInfo,
    getCurrentCallInfoIfExists,
    getCurrentContract,
    getCurrentFunctionName,
    getCurrentCodeCollection,
    addFunctionToCurrentContractInCurrentCallInfo,
    removeFunctionFromCurrentContractInCurrentCallInfo,
    getEnv,
    getGasInfo,
    getVariableOfName,
    pushSender,
    initializeAction,
    -- lookupX509AddrFromCBHash,
    markDiffForAction,
    getBlockHashWithNumber,
    getBSum,
    addEvent,
    addDelegatecall,
    getContractNameAndHash,
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
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.SolidVM.Exception
import Blockchain.SolidVM.GasInfo
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
import Control.Lens hiding (Context)
import Control.Monad
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Trans.Class
import Control.Monad.Trans.Reader
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Either (isLeft)
import Data.Foldable (for_)
import qualified Data.List.NonEmpty as NE
import Data.Map (Map)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map as M
import Data.Maybe
import qualified Data.NibbleString as N
import qualified Data.Sequence as Q
import qualified Data.Set as S
import Data.Source
import qualified Data.Text as T
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
    currentAddress :: Address,
    currentCodeAddress :: Address,
    currentContract :: CC.Contract,
    codeCollection :: CC.CodeCollection,
    collectionHash :: Keccak256,
    localVariables :: NE.NonEmpty (Map SolidString Variable),
    stateMap :: !(M.Map Address AddressStateModification),
    storageMap :: !(M.Map (Address, B.ByteString) MS.BasicValue),
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
  ( (Address `A.Alters` AddressState) m,
    A.Selectable Address AddressState m,
    HasStateDB m,
    HasCodeDB m,
    (Keccak256 `A.Alters` BlockSummary) m,
    HasSelectX509CertDB m,
    HasRawStorageDB m,
    HasMemAddressStateDB m,
    HasMemRawStorageDB m,
    Mod.Accessible Env.Environment m,
    Mod.Accessible [SourcePosition] m,
    Mod.Accessible VariableSet m,
    Mod.Modifiable GasInfo m,
    Mod.Modifiable MemDBs m,
    Mod.Modifiable Env.Environment m,
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
  lookup _ k   = do
    cs <- gets callStack
    case foldr (<|>) Nothing $ M.lookup k . storageMap <$> cs of
      Just v -> pure $ Just v
      Nothing -> genericLookupRawStorageDB k
  lookupWithDefault _ k   = do
    cs <- gets callStack
    case foldr (<|>) Nothing $ M.lookup k . storageMap <$> cs of
      Just v -> pure v
      Nothing -> genericLookupWithDefaultRawStorageDB k
  insert _ k v = do
    cs <- gets callStack
    case cs of
      [] -> genericInsertRawStorageDB k v
      (c:cs') -> do
        let c' = c {
              storageMap = M.insert k v $ storageMap c
            }
        modify $ \ss -> ss{
          callStack = c':cs'
        }
  insertMany _ kvs = do
    cs <- gets callStack
    case cs of
      [] -> genericInsertManyRawStorageDB kvs
      (c:cs') -> do
        let c' = c {
              storageMap = kvs `M.union` storageMap c
            }
        modify $ \ss -> ss{
          callStack = c':cs'
        }
  delete _ k   = do
    cs <- gets callStack
    case cs of
      [] -> genericDeleteRawStorageDB k
      (c:cs') -> do
        let c' = c {
              storageMap = M.delete k $ storageMap c
            }
        modify $ \ss -> ss{
          callStack = c':cs'
        }

instance
  ( MonadUnliftIO m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    MonadLogger m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (N.NibbleString `A.Alters` N.NibbleString) m
  ) =>
  (Address `A.Alters` AddressState) (SM m)
  where
  lookup _ a = do
    cs <- gets callStack
    case foldr (<|>) Nothing $ M.lookup a . stateMap <$> cs of
      Just (ASModification s) -> pure $ Just s
      Just ASDeleted -> pure $ Just blankAddressState
      Nothing -> getAddressStateMaybe a
  insert _ a s = do
    cs <- gets callStack
    case cs of
      [] -> putAddressState a s
      (c:cs') -> do
        let c' = c {
              stateMap = M.insert a (ASModification s) $ stateMap c
            }
        modify $ \ss -> ss{
          callStack = c':cs'
        }
  insertMany _ as = do
    let asMods = M.map ASModification as
    cs <- gets callStack
    case cs of
      [] -> putAddressStates asMods
      (c:cs') -> do
        let c' = c {
              stateMap = asMods `M.union` stateMap c
            }
        modify $ \ss -> ss{
          callStack = c':cs'
        }
  delete _ a = do
    cs <- gets callStack
    case cs of
      [] -> deleteAddressState a
      (c:cs') -> do
        let c' = c {
              stateMap = M.insert a ASDeleted $ stateMap c
            }
        modify $ \ss -> ss{
          callStack = c':cs'
        }
  deleteMany _ as = do
    cs <- gets callStack
    case cs of
      [] -> deleteAddressStates as
      (c:cs') -> do
        let c' = c {
              stateMap = M.difference (stateMap c) . M.fromList $ (,ASDeleted) <$> as
            }
        modify $ \ss -> ss{
          callStack = c':cs'
        }

instance
  ( MonadUnliftIO m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    MonadLogger m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (N.NibbleString `A.Alters` N.NibbleString) m
  ) =>
  A.Selectable Address AddressState (SM m)
  where
  select = A.lookup

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

instance (N.NibbleString `A.Alters` N.NibbleString) m => (N.NibbleString `A.Alters` N.NibbleString) (SM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance MonadUnliftIO m => Mod.Accessible Env.Environment (SM m) where
  access _ = gets env

instance MonadUnliftIO m => Mod.Modifiable Env.Environment (SM m) where
  get _   = gets env
  put _ m = modify $ \ss -> ss{ env = m }

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

variableSet :: VMBase m => SM m VariableSet
variableSet = do
  cis <- Mod.get (Mod.Proxy @[CallInfo])
  let textSet = S.fromList . M.keys
      varNames = case cis of
        [] -> S.empty
        (ci : _) -> textSet . NE.head $ localVariables ci
      locals = M.singleton "Local Variables" varNames
  acct <- getCurrentAddress
  ~(contract, _, _) <- getCodeAndCollection acct
  let stateVars = S.fromList $ M.keys $ contract ^. CC.storageDefs
      globals = M.singleton "State Variables" stateVars
  pure . VariableSet $ fmap (S.map labelToText) $ locals <> globals

instance {-# OVERLAPPING #-} VMBase m => Mod.Accessible VariableSet (SM m) where
  access _ = variableSet

instance {-# OVERLAPPING #-} VMBase m => Mod.Accessible [SourcePosition] (SM m) where
  access _ = do
    cis <- Mod.get (Mod.Proxy @[CallInfo])
    pure $ fromMaybe (initialPosition "") . currentSourcePos <$> cis

runSM ::
  ( MonadUnliftIO m,
    MonadLogger m,
    Mod.Modifiable ContextState m,
    Mod.Modifiable GasCap m
  ) =>
  (Maybe Code) ->
  Env.Environment ->
  GasInfo ->
  SM m a ->
  m (Env.Environment, Either SolidException a)
runSM maybeCode envBefore gi f = do
  csMemDBs <- _memDBs <$> Mod.get (Mod.Proxy @ContextState)
  GasCap gasCap <- Mod.get (Mod.Proxy @GasCap)
  $logInfoS "runSM/GasCap/status" . T.pack $ "Current gas cap: " ++ CL.green (show gasCap)
  let !startingState =
        SState
          { env = envBefore,
            callStack = [],
            _ssMemDBs = csMemDBs,
            _action = startingAction maybeCode envBefore,
            _gasInfo = gi {_gasLeft = min (_gasLeft gi) gasCap} -- capping the transaction gas limit
          }
  startingStateRef <- newIORef startingState
  eVal <- try $ runReaderT f startingStateRef
  sstateAfter <- readIORef startingStateRef
  let envAfter = env sstateAfter
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
        else return (envAfter, Left se)
    Right value -> do
      Mod.modifyStatefully_ (Mod.Proxy @ContextState) $ memDBs .= _ssMemDBs sstateAfter
      return (envAfter, Right value)

-- When calling a remote contract, the new `msg.sender` is the contract
-- that the call is initiated from.
pushSender :: MonadSM m => Address -> m a -> m a
pushSender newSender mv = do
  oldSender <- Mod.get (Mod.Proxy @Env.Sender)
  Mod.put (Mod.Proxy @Env.Sender) (Env.Sender newSender)
  ret <- mv
  Mod.put (Mod.Proxy @Env.Sender) oldSender
  return $ ret

startingAction :: Maybe Code -> Env.Environment -> Action
startingAction maybeCode env' =
  Action.Action
    { _blockHash = blockHeaderHash $ Env.blockHeader env',
      _blockTimestamp = blockHeaderTimestamp $ Env.blockHeader env',
      _blockNumber = blockHeaderBlockNumber $ Env.blockHeader env',
      _transactionHash = Env.txHash env',
      _transactionSender = Env.sender env',
      _actionData = OMap.empty,
      _src =
        case maybeCode of
          Just theCode ->
            Just theCode
          Nothing -> Env.src env',
      _name = Env.name env',
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
                          CC._isContractRecord = currentContract x ^. CC.isContractRecord,
                          CC._contractContext = currentContract x ^. CC.contractContext
                        }
                  }
              else x
      vars = NE.head $ localVariables currentCallInfo
      t s v = ('x' : s, v) `seq` v

  -- when (name == "theSixthSense") (internalError "M. Night Shyamalan presents" currentCallInfo)

  let maybeLocalValue = M.lookup name vars

  let maybeContractFunction :: Maybe Variable
      maybeContractFunction = fmap (t "constant function" . Constant . SFunction name . Just) $ M.lookup name $ currentContract currentCallInfo ^. CC.functions

      maybeFreeFunction :: Maybe Variable
      maybeFreeFunction = fmap (t "free function" . Constant . SFunction name . Just) $ M.lookup name $ codeCollection currentCallInfo ^. CC.flFuncs

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
                       "log",
                       "keccak256",
                       "ripemd160",
                       "modExp",
                       "ecAdd",
                       "ecMul",
                       "ecPairing",
                       "payable",
                       "require",
                       "revert",
                       "assert",
                       "sha3",
                       "delegatecall",
                       "call",
                       "staticcall",
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
                       "verifySignature",
                       "fastForward"
                     ]
          )
          $ t "builtin function" $ Constant $ SFunction name Nothing

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
                (currentAddress currentCallInfo)
                (MS.singleton $ BC.pack $ labelToString name)
          else Nothing

      maybeThis :: Maybe Variable
      maybeThis = toMaybe (name == "this") . t "this" . Constant $ SAccount (currentAddress currentCallInfo) False

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

withCallInfo ::
  MonadSM m =>
  Address ->
  Address ->
  CC.Contract ->
  SolidString ->
  Keccak256 ->
  CC.CodeCollection ->
  Map SolidString Variable ->
  Bool ->
  Bool ->
  m a ->
  m a
withCallInfo a codeAddr c fn hsh cc initialLocalVariables ro ff f = do
  addCallInfo a codeAddr c fn hsh cc initialLocalVariables ro ff
  eRes <- try f
  popCallInfo $ isLeft eRes
  case eRes of
    Left (e :: SomeException) -> throwIO e
    Right res -> pure res

addCallInfo ::
  MonadSM m =>
  Address ->
  Address ->
  CC.Contract ->
  SolidString ->
  Keccak256 ->
  CC.CodeCollection ->
  Map SolidString Variable ->
  Bool ->
  Bool ->
  m ()
addCallInfo a codeAddr c fn hsh cc initialLocalVariables ro ff = do
  let newCallInfo =
        CallInfo
          { currentFunctionName = fn,
            currentAddress = a,
            currentCodeAddress = codeAddr,
            currentContract = c,
            codeCollection = cc,
            collectionHash = hsh,
            localVariables = NE.singleton initialLocalVariables,
            stateMap = M.empty,
            storageMap = M.empty,
            readOnly = ro,
            isUncheckedSection = False, -- The rationale here is that unchecked sections only apply to the current stack frame
            currentSourcePos = Nothing,
            isFreeFunction = ff
          }

  Mod.modify_ (Mod.Proxy @[CallInfo]) $ pure . (newCallInfo :)

uncheckedCallInfo :: MonadSM m => m ()
uncheckedCallInfo = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "uncheckedCallInfo was called on an already empty stack" ()
  (ci : rest) -> pure $ ci {isUncheckedSection = True} : ci : rest

popCallInfo :: MonadSM m => Bool -> m ()
popCallInfo reverted = do
  cci <- getCurrentCallInfoIfExists
  Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
    [] -> internalError "popCallInfo was called on an already empty stack" ()
    (_ : rest) -> pure rest

  unless reverted . for_ cci $ \ci -> do
    A.insertMany (A.Proxy @RawStorageValue) $ storageMap ci
    let fromASM ASDeleted = Left ()
        fromASM (ASModification as) = Right as
        (deletes, inserts) = M.mapEither fromASM $ stateMap ci
    A.insertMany (A.Proxy @AddressState) $ inserts
    A.deleteMany (A.Proxy @AddressState) $ M.keys deletes

withLocalVars :: MonadSM m => m a -> m a
withLocalVars = bracket_ pushLocalVars popLocalVars

pushLocalVars :: MonadSM m => m ()
pushLocalVars = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "pushLocalVars was called with an empty stack" ()
  (curFrame : rest) -> do
    let lvs = case localVariables curFrame of
                v NE.:| vs -> v NE.:| v:vs
    pure $ curFrame{localVariables = lvs} : rest

-- The inverse operation as above, called when exiting a statement block and those declared variables need to be destroyed
popLocalVars :: MonadSM m => m ()
popLocalVars = Mod.modify_ (Mod.Proxy @[CallInfo]) $ \case
  [] -> internalError "popLocalVars was called with an empty stack" ()
  (curFrame : rest) -> case localVariables curFrame of
    _ NE.:| v:vs -> pure $ curFrame{localVariables = v NE.:| vs} : rest
    _ -> internalError "popLocalVars was called with an empty stack" ()

withStaticCallInfo :: MonadSM m => m a -> m a
withStaticCallInfo f = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    [] -> internalError "withStaticCallInfo was called with an empty stack" ()
    (curFrame : rest) -> do
      Mod.put (Mod.Proxy @[CallInfo]) $ curFrame{readOnly = True} : rest
      eResult <- try f
      Mod.put (Mod.Proxy @[CallInfo]) $ curFrame : rest
      case eResult of
        Left (e :: SomeException) -> throwIO e
        Right result -> pure result

withUncheckedCallInfo :: MonadSM m => m a -> m a
withUncheckedCallInfo f = do
  uncheckedCallInfo
  eResult <- try f
  popCallInfo $ isLeft eResult
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
{-
getCurrentAccount :: MonadSM m => m Account
getCurrentAccount = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ currentAddress currentCallInfo
    _ -> internalError "getCurrentAccount called with an empty stack" ()
-}
getCurrentAddress :: MonadSM m => m Address
getCurrentAddress = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ currentAddress currentCallInfo
    _ -> internalError "getCurrentAccount called with an empty stack" ()

getCurrentCodeAddress :: MonadSM m => m Address
getCurrentCodeAddress = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ currentCodeAddress currentCallInfo
    _ -> internalError "getCurrentCodeAddress called with an empty stack" ()
{-
getCurrentChainId :: MonadSM m => m (Maybe Word256)
getCurrentChainId = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ _accountChainId $ currentAddress currentCallInfo
    _ -> internalError "getCurrentChainId called with an empty stack" ()
-}
getCurrentFunctionName :: MonadSM m => m SolidString
getCurrentFunctionName = do
  cs <- Mod.get (Mod.Proxy @[CallInfo])
  case cs of
    (currentCallInfo : _) -> return $ currentFunctionName currentCallInfo
    _ -> internalError "getCurrentFunctionName called with an empty stack" ()

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

initializeAction :: MonadSM m
                 => Address
                 -> String
                 -> String
                 -> Maybe String
                 -> String
                 -> String
                 -> Keccak256
                 -> CC.CodeCollection
                 -> m ()
initializeAction acct name crtr cc_crtr root appName hsh cc = do
  let newData = Action.ActionData (SolidVMCode name hsh) cc (T.pack crtr) (fmap T.pack cc_crtr) (T.pack root) (T.pack appName) (Action.SolidVMDiff M.empty)
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData %= Action.omapInsertWith Action.mergeActionData acct newData

markDiffForAction :: Mod.Modifiable Action m => Address -> MS.StoragePath -> MS.BasicValue -> m ()
markDiffForAction owner key' val' = do
  let ins (Action.SolidVMDiff m) = Action.SolidVMDiff $ M.insert key' val' m
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData . Action.omapLens owner . mapped . Action.actionDataStorageDiffs %= ins

addEvent :: Mod.Modifiable (Q.Seq Event) m => Event -> m ()
addEvent newEvent = Mod.modify_ (Mod.Proxy @(Q.Seq Event)) $ pure . (Q.|> newEvent)

addDelegatecall :: Mod.Modifiable (Q.Seq Action.Delegatecall) m => Address -> Address -> T.Text -> T.Text -> T.Text -> m ()
addDelegatecall s c o a n = Mod.modify_ (Mod.Proxy @(Q.Seq Action.Delegatecall)) $ pure . (Q.|> Action.Delegatecall s c o a n)

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

getContractNameAndHash :: MonadSM m => Address -> m (SolidString, Keccak256)
getContractNameAndHash address' = do
  codeHash <- addressStateCodeHash <$> A.lookupWithDefault (A.Proxy @AddressState) address'

  case codeHash of
    SolidVMCode cn ch' -> return (stringToLabel cn, ch')
    ch -> internalError ("SolidVM for non-solidvm code at address " ++ formatAddressWithoutColor address') (format ch)

getCodeAndCollection :: MonadSM m => Address -> m (CC.Contract, Keccak256, CC.CodeCollection)
getCodeAndCollection address' = do
  (contractName', ch) <- getContractNameAndHash address'
  isRunningTests <- Env.runningTests <$> getEnv
  cc <- codeCollectionFromHash isRunningTests True ch
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
  ( MonadLogger m
  , A.Selectable Address AddressState m
  , HasSolidStorageDB m
  ) =>
  Address ->
  T.Text ->
  T.Text ->
  CC.Contract ->
  m ((Address, T.Text), (T.Text, T.Text, [T.Text]))
resolveNameParts to' crtr app c = do
  let tName = T.pack . CC._contractName
  case c ^. CC.importedFrom of
    Nothing -> pure ((to', tName c), (crtr, app, (map T.pack (M.keys $ CC._storageDefs c))))
    Just address -> do
      A.select (A.Proxy @AddressState) address >>= \case
        Nothing -> do
          $logWarnS "processTheMessages/resolveNameParts" . T.pack $
            "Could not find address state for address " ++ show address
          pure ((address, tName c), (crtr, app, (map T.pack (M.keys $ CC._storageDefs c))))
        Just s ->
          case addressStateCodeHash s of
            SolidVMCode appName _ -> do
              appCreator <- getSolidStorageKeyVal' address $ MS.StoragePath [MS.Field ":creator"]
              case appCreator of
                MS.BString cn' -> pure ((address, tName c), (T.pack $ BC.unpack cn', T.pack appName, (map T.pack (M.keys $ CC._storageDefs c))))
                _ -> pure ((address, tName c), (crtr, T.pack appName, (map T.pack (M.keys $ CC._storageDefs c))))
            _ -> do
              $logWarnS "resolveNameParts" . T.pack $
                "Could not resolve code for address " ++ show address
              pure ((address, tName c), (crtr, app, (map T.pack (M.keys $ CC._storageDefs c))))
