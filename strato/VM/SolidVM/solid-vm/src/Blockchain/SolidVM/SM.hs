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
    markDiffForAction,
    getBlockHashWithNumber,
    getBSum,
    addEvent,
    renderValueShallow,
    addDelegatecall,
    getUsername,
    addNewCodeCollection,
    getContractNameAndHash,
    getCodeAndCollection,
    getContractsForParents,
    getAbstractParentsFromContract,
    getMapNamesFromContract,
    getArrayNamesFromContract
  )
where

--import           Data.IORef

import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockSummary
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as Conf
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.SolidVM.Exception
import Blockchain.Data.VmTrace
import Blockchain.SolidVM.GasInfo
import Blockchain.Strato.Model.Gas (Gas (..))
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
import Control.Arrow ((&&&))
import Control.Lens hiding (Context)
import Control.Monad
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Trans.Class
import Control.Monad.Trans.Reader
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
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import Debugger
import SolidVM.Model.CodeCollection (CodeCollection)
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
    storageMap :: !(M.Map (Address, MS.StoragePath) MS.BasicValue),
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
    Mod.Modifiable (OMap.OMap (Text, Keccak256) CodeCollection) m,
    Mod.Modifiable (Maybe DebugSettings) m,
    Mod.Modifiable (Maybe VmTracer) m,
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

instance
  (Mod.Modifiable (Maybe VmTracer) m) =>
  Mod.Modifiable (Maybe VmTracer) (SM m)
  where
  get _ = lift $ Mod.get (Mod.Proxy @(Maybe VmTracer))
  put _ = lift . Mod.put (Mod.Proxy @(Maybe VmTracer))

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

instance MonadUnliftIO m => Mod.Modifiable (OMap.OMap (Text, Keccak256) CodeCollection) (SM m) where
  get _ = gets (Action._newCodeCollections . _action)
  put _ q = modify $ action . Action.newCodeCollections .~ q

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
  $logDebugS "runSM/GasCap/status" . T.pack $ "Current gas cap: " ++ CL.green (show gasCap)
  let !startingState =
        SState
          { env = envBefore,
            callStack = [],
            _ssMemDBs = csMemDBs,
            _action = startingAction envBefore,
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
    Left (e :: SomeException) -> do
      let se = case fromException e of
            Just solidEx -> solidEx
            Nothing -> InternalError "Uncaught internal exception" (show e)
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

startingAction :: Env.Environment -> Action
startingAction env' =
  Action.Action
    { _blockHash = blockHeaderHash $ Env.blockHeader env',
      _blockTimestamp = blockHeaderTimestamp $ Env.blockHeader env',
      _blockNumber = blockHeaderBlockNumber $ Env.blockHeader env',
      _transactionSender = Env.sender env',
      _actionData = OMap.empty,
      _newCodeCollections = OMap.empty,
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
                          CC._usings = [],
                          CC._contractType = currentContract x ^. CC.contractType,
                          CC._importedFrom = Nothing,
                          CC._contractContext = currentContract x ^. CC.contractContext
                        }
                  }
              else x
      vars = NE.head $ localVariables currentCallInfo
      t s v = ('x' : s, v) `seq` v
      curContract = currentContract currentCallInfo

  -- when (name == "theSixthSense") (internalError "M. Night Shyamalan presents" currentCallInfo)

  let maybeLocalValue = M.lookup name vars

  let maybeContractFunction :: Maybe Variable
      maybeContractFunction =
        (t "constant function" . Constant . SFunction name $ Just curContract)
        <$ (M.lookup name $ curContract ^. CC.functions)

      maybeFreeFunction :: Maybe Variable
      maybeFreeFunction =
        (\f -> t "free function" . Constant . SFunction name . Just $
          curContract & CC.functions %~ M.insert name f)
        <$> (M.lookup name $ codeCollection currentCallInfo ^. CC.flFuncs)

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
                       "variadic",
                       "log",
                       "keccak256",
                       "ripemd160",
                       "modExp",
                       "ecAdd",
                       "ecMul",
                       "ecPairing",
                       "bls12381G1Add",
                       "bls12381G1Msm",
                       "bls12381G2Add",
                       "bls12381G2Msm",
                       "bls12381Pairing",
                       "bls12381MapFpToG1",
                       "bls12381MapFp2ToG2",
                       "bls12381HashToCurveG1",
                       "bls12381HashToCurveG2",
                       "bls12381DecompressG1",
                       "bls12381DecompressG2",
                       "poseidon",
                       "poseidon2",
                       "poseidon2Compress",
                       "poseidon2Permute",
                       "poseidon2Hash",
                       "poseidon2HashBytes",
                       "poseidon2gl",
                       "poseidon2glBytes",
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
                       "verifyP256",
                       "base64encode",
                       "base64urlencode",
                       "blockhash",
                       "addmod",
                       "mulmod",
                       "selfdestruct",
                       "suicide",
                       "bytes32ToString",
                       "create",
                       "create2",
                       "fastForward"
                     ]
          )
          $ t "builtin function" $ Constant $ SFunction name Nothing

      maybeBuiltinVariable :: Maybe Variable
      maybeBuiltinVariable =
        toMaybe (name `elem` ["msg", "block", "tx", "super", "now", "abi"]) $
          t "builtin variable" $ Constant $ SBuiltinVariable name

      maybeEnum :: Maybe Variable
      maybeEnum =
        toMaybe (name `elem` M.keys (currentContract currentCallInfo ^. CC.enums) || name `elem` M.keys (codeCollection currentCallInfo ^. CC.flEnums)) $
          t "enum" $ Constant $ SEnum name

      maybeConstant :: Maybe Variable
      maybeConstant = fmap (t "constant constant" . Constant) $ do
        let ctract = currentContract currentCallInfo
        let cc = codeCollection currentCallInfo
        let constMap = cc ^. CC.flConstants
        CC.ConstantDecl {..} <- M.lookup name $ (ctract ^. CC.constants) `M.union` constMap
        return $
          coerceType ctract cc _constType $ case _constInitialVal of
            CC.NumberLiteral _ x _ -> SInteger x
            CC.AddressLiteral _ a -> SAddress a False
            _ -> SDeferredConstant name  -- Complex expression, evaluate on access

      maybeStructDef :: Maybe Variable
      maybeStructDef =
        toMaybe (name `elem` M.keys (currentContract currentCallInfo ^. CC.structs) || name `elem` M.keys (codeCollection currentCallInfo ^. CC.flStructs)) $
          t "struct def" $ Constant $ SStructDef name

      maybeContract :: Maybe Variable
      maybeContract =
        toMaybe (name `elem` M.keys (codeCollection currentCallInfo ^. CC.contracts)) $
          t "contract" $ Constant $ SContractDef name

      maybeStorageItem :: Maybe Variable
      maybeStorageItem = Constant (SReference . MS.singleton . BC.pack $ labelToString name)
                      <$ M.lookup name (currentContract currentCallInfo ^. CC.storageDefs)

      maybeThis :: Maybe Variable
      maybeThis = toMaybe (name == "this") . t "this" . Constant $ SAddress (currentAddress currentCallInfo) False

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
      unknownVariable "not found" name
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
  mTracer <- Mod.get (Mod.Proxy @(Maybe VmTracer))
  for_ mTracer $ \_ -> do
    stack <- Mod.get (Mod.Proxy @[CallInfo])
    fromAddr <- case stack of
      (parent : _) -> pure $ currentAddress parent
      [] -> (\(Env.Sender sndr) -> sndr) <$> Mod.get (Mod.Proxy @Env.Sender)
    GasInfo {_gasLeft = Gas gasBefore} <- Mod.get (Mod.Proxy @GasInfo)
    args <- traverse renderArgShallow (M.toList initialLocalVariables)
    let callType
          | labelToText fn == "constructor" = CTCreate
          | codeAddr /= a = CTDelegateCall
          | ro = CTStaticCall
          | otherwise = CTCall
    traceEnterFrame mTracer callType fromAddr a (labelToText $ c ^. CC.contractName) (labelToText fn) args gasBefore
  addCallInfo a codeAddr c fn hsh cc initialLocalVariables ro ff
  eRes <- try f
  for_ mTracer $ \_ -> do
    GasInfo {_gasLeft = Gas gasAfter} <- Mod.get (Mod.Proxy @GasInfo)
    traceExitFrame mTracer gasAfter $ case eRes of
      Left (e :: SomeException) -> Just . T.pack $ show e
      Right _ -> Nothing
  popCallInfo $ isLeft eRes
  case eRes of
    Left (e :: SomeException) -> throwIO e
    Right res -> pure res

-- | Render one named argument for a trace frame. Only the in-memory value is
-- read (readIORef); storage is never touched, which would mutate the MP trie.
renderArgShallow :: MonadIO m => (SolidString, Variable) -> m Text
renderArgShallow (name, var) = do
  val <- case var of
    Constant v -> pure v
    Variable ref -> readIORef ref
  pure $ labelToText name <> "=" <> renderValueShallow val

-- | Shallow, pure rendering of a value: scalars verbatim, compounds
-- summarized without dereferencing nested variables or storage.
renderValueShallow :: Value -> Text
renderValueShallow = \case
  SInteger i -> T.pack (show i)
  SDecimal d -> T.pack (show d)
  SString str -> T.pack (show str)
  SBool b -> if b then "true" else "false"
  SAddress addr _ -> T.pack (show addr)
  SEnumVal enumName valName _ -> labelToText enumName <> "." <> labelToText valName
  SStruct sname _ -> "<struct " <> labelToText sname <> ">"
  STuple _ -> "<tuple>"
  SArray _ -> "<array>"
  SMap _ -> "<mapping>"
  v -> T.take 100 . T.pack $ show v

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

initializeAction :: MonadSM m =>
                    Address -> m ()
initializeAction acct = do
  let newData = Action.ActionData (Action.SolidVMDiff M.empty)
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData %= Action.omapInsertWith Action.mergeActionData acct newData

markDiffForAction :: Mod.Modifiable Action m => Address -> MS.StoragePath -> MS.BasicValue -> m ()
markDiffForAction owner key' val' = do
  let ins (Action.SolidVMDiff m) = Action.SolidVMDiff $ M.insert key' val' m
  Mod.modifyStatefully_ (Mod.Proxy @Action) $
    Action.actionData . Action.omapLens owner . mapped . Action.actionDataStorageDiffs %= ins

addEvent :: (MonadIO m, Mod.Modifiable (Q.Seq Event) m, Mod.Modifiable (Maybe VmTracer) m) => Event -> m ()
addEvent newEvent = do
  Mod.modify_ (Mod.Proxy @(Q.Seq Event)) $ pure . (Q.|> newEvent)
  mTracer <- Mod.get (Mod.Proxy @(Maybe VmTracer))
  traceAddLog mTracer $
    TraceLog
      (evContractAddress newEvent)
      (T.pack $ evName newEvent)
      [(T.pack n, T.pack v) | (n, v, _) <- evArgs newEvent]

addDelegatecall :: Mod.Modifiable (Q.Seq Action.Delegatecall) m => Address -> Keccak256 -> T.Text -> m ()
addDelegatecall s c n = Mod.modify_ (Mod.Proxy @(Q.Seq Action.Delegatecall)) $ pure . (Q.|> Action.Delegatecall s c n)

-- Cirrus table namespace enforcement
--
-- Cirrus tables are namespaced by the deployer's username, which is stored in
-- the User contract created by the UserRegistry. Only contracts deployed through
-- a User contract should produce Cirrus tables, since the username determines
-- which namespace the table belongs to.
--
-- Previously, any contract deployed without a User in the call stack would
-- default to the "BlockApps" namespace, allowing arbitrary accounts to write
-- into the system namespace. getUsername now returns Nothing when no User
-- contract is found, and addNewCodeCollection skips the announcement — so no
-- Cirrus table is created for contracts deployed outside the User contract flow.
--
-- The addresses below are the legacy BlockApps operational accounts that
-- deployed system contracts before the UserRegistry was in place. They are
-- grandfathered in so that existing system contract tables continue to be
-- created under the "BlockApps" namespace.
blockappsAddresses :: S.Set Address
blockappsAddresses = S.fromList
  [ Address 0x7630b673862a2807583834908f10192e00c58b00
  , Address 0x101a31a25295a5dd95187ea2b0725c91443db7b7
  , Address 0x3287f1ad89b0ac875b58a65ceaf40bc7a6cc8041
  , Address 0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce
  , Address 0xac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7
  , Address 0x304f41812ce9a1db4fa9c58aff7904ea3e77d51a
  , Address 0x292dd9591f506845ef05a9f3b8116e641cbcb4bb
  , Address 0xf1ba16a6cfb2a17fb34ad477eaaf0c76eac64f14
  ]

-- | Resolve the deployer's username for Cirrus table namespacing.
-- Walks the call stack looking for a User contract (which has a "username"
-- storage field). Returns Nothing if no User contract is found and the TX
-- origin is not a grandfathered BlockApps account.
getUsername :: MonadSM m => m (Maybe Text)
getUsername = do
  let go []     = do
        (origin, currentBlockNum) <- (Env.origin &&& (blockHeaderBlockNumber . Env.blockHeader)) <$> getEnv
        let netID = Conf.networkID (Conf.networkConfig ethConf)
            isPreUsernameFork = currentBlockNum < 100000 && (netID `elem` [33056204878082667, 114784819836269])
        if isPreUsernameFork && origin `S.member` blockappsAddresses
          then pure $ Just "BlockApps"
          else pure Nothing
      go (x:xs) = do
        userNameValue <- getSolidStorageKeyVal' x $ MS.StoragePath [MS.Field "username"]
        case userNameValue of
          MS.BString userNameString -> do
            let usernameText = DT.decodeUtf8 userNameString
                u = T.unpack usernameText
                userRegistry = Address 0x720
            ch <- A.selectWithDefault (A.Proxy @AddressState) userRegistry >>= \s ->
              pure . keccak256ToByteString $ case addressStateCodeHash s of
                ExternallyOwned h -> h
                SolidVMCode _ h   -> h
            let addr = getNewAddressWithSalt_unsafe userRegistry u ch [SString "User", SString u]
            if addr == x
              then pure $ Just usernameText
              else go xs
          _ -> go xs

  cs <- Mod.get (Mod.Proxy @[CallInfo])
  go $ currentAddress <$> cs

addNewCodeCollection :: MonadSM m => Keccak256 -> CodeCollection -> m ()
addNewCodeCollection ch cc = do
  mUsername <- getUsername
  case mUsername of
    Just username ->
      Mod.modify_ (Mod.Proxy @(OMap.OMap (Text, Keccak256) CodeCollection)) $ pure . (OMap.|> ((username, ch), cc))
    Nothing -> pure ()

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
    _ -> missingCodeCollection ("contract call to address 0x" ++ formatAddressWithoutColor address' ++ " failed") ("no contract deployed at this address" :: String)

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
      listOfMappings = filter (\(_, vd) -> case (CC._varType vd) of SVMType.Mapping _ _ _ _ _ -> True; _ -> False) storageDefsList
   in T.pack . fst <$> listOfMappings

--also needs to be changed for testnet3 to be only record
getArrayNamesFromContract :: CC.Contract -> [T.Text]
getArrayNamesFromContract c =
  let storageDefs' = c ^. CC.storageDefs
      storageDefsList = M.toList storageDefs'
      listOfArrays = filter (\(_, vd) -> case (CC._varType vd) of SVMType.Array _ _ -> True; _ -> False) storageDefsList
   in T.pack . fst <$> listOfArrays
