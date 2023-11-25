{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PolyKinds #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.EVM.VMM
  ( VMM,
    MonadEVM,
    vmstateGet,
    vmstateGets,
    vmstatePut,
    vmstateModify,
    pop,
    localState,
    getStackItem,
    push,
    swapn,
    dupn,
    addDebugCallCreate,
    addSuicideList,
    getEnvVar,
    addLog,
    setPC,
    incrementPC,
    addToRefund,
    clearRefund,
    getCallDepth,
    getGasRemaining,
    getReturnVal,
    setDone,
    setReturnVal,
    setGasRemaining,
    useGas,
    addGas,
    pay',
    getStorageKeyVal,
    putStorageKeyVal,
    vmTrace,
    getAllStorageKeyVals,
    Word256Storable,
    downcastGas,
    readGasRemaining,
    readPC,
    readRefund,
  )
where

import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.ModifyStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockSummary
import Blockchain.Data.Log
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EVM.Environment
import qualified Blockchain.EVM.MutableStack as MS
import Blockchain.EVM.VMState
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.VM.VMException
import Blockchain.VMContext
import Control.Lens hiding (from, to)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import qualified Data.ByteString as B
import Data.IORef.Unboxed
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import qualified Data.Set as S
import GHC.Utils.Monad
import UnliftIO

type VMM m = ReaderT (IORef VMState) m

type MonadEVM m =
  ( MonadIO m,
    MonadLogger m,
    Mod.Modifiable VMState m
  )

get :: MonadIO m => VMM m VMState
get = readIORef =<< ask
{-# INLINE get #-}

gets :: MonadIO m => (VMState -> a) -> VMM m a
gets f = f <$> get
{-# INLINE gets #-}

put :: MonadIO m => VMState -> VMM m ()
put c = ask >>= \i -> atomicWriteIORef i c
{-# INLINE put #-}

modify :: MonadIO m => (VMState -> VMState) -> VMM m ()
modify f = ask >>= \i -> atomicModifyIORef i (\a -> (f a, ()))
{-# INLINE modify #-}

vmstateGet :: MonadIO m => VMM m VMState
vmstateGet = readIORef =<< ask
{-# INLINE vmstateGet #-}

vmstateGets :: MonadIO m => (VMState -> a) -> VMM m a
vmstateGets f = f <$> get
{-# INLINE vmstateGets #-}

vmstatePut :: MonadIO m => VMState -> VMM m ()
vmstatePut c = ask >>= \i -> atomicWriteIORef i c
{-# INLINE vmstatePut #-}

vmstateModify :: MonadIO m => (VMState -> VMState) -> VMM m ()
vmstateModify f = ask >>= \i -> atomicModifyIORef i (\a -> (f a, ()))
{-# INLINE vmstateModify #-}

instance MonadIO m => Mod.Modifiable VMState (VMM m) where
  get _ = readIORef =<< ask
  put _ v = flip writeIORef v =<< ask

instance MonadIO m => HasMemAddressStateDB (VMM m) where
  getAddressStateTxDBMap = _stateTxMap . vmMemDBs <$> Mod.get (Mod.Proxy @VMState)
  putAddressStateTxDBMap theMap = Mod.modify_ (Mod.Proxy @VMState) $ \s ->
    pure $ s {vmMemDBs = (vmMemDBs s) {_stateTxMap = theMap}}
  getAddressStateBlockDBMap = _stateBlockMap . vmMemDBs <$> Mod.get (Mod.Proxy @VMState)
  putAddressStateBlockDBMap theMap = Mod.modify_ (Mod.Proxy @VMState) $ \s ->
    pure $ s {vmMemDBs = (vmMemDBs s) {_stateBlockMap = theMap}}

instance (MP.StateRoot `A.Alters` MP.NodeData) m => (MP.StateRoot `A.Alters` MP.NodeData) (VMM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance (N.NibbleString `A.Alters` N.NibbleString) m => (N.NibbleString `A.Alters` N.NibbleString) (VMM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance
  ( MonadIO m,
    MonadLogger m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (N.NibbleString `A.Alters` N.NibbleString) m
  ) =>
  (Account `A.Alters` AddressState) (VMM m)
  where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance
  ( MonadIO m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m
  ) =>
  (Maybe Word256 `A.Alters` MP.StateRoot) (VMM m)
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

instance MonadIO m => Mod.Modifiable MemDBs (VMM m) where
  get _ = vmMemDBs <$> Mod.get (Mod.Proxy @VMState)
  put _ md = Mod.modify_ (Mod.Proxy @VMState) $ \s ->
    pure $ s {vmMemDBs = md}

instance MonadIO m => Mod.Modifiable CurrentBlockHash (VMM m) where
  get _ = fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0) . _currentBlock <$> Mod.get (Mod.Proxy @MemDBs)
  put _ md = Mod.modifyStatefully_ (Mod.Proxy @MemDBs) $ currentBlock ?= md

instance MonadIO m => HasMemRawStorageDB (VMM m) where
  getMemRawStorageTxDB = _storageTxMap . vmMemDBs <$> Mod.get (Mod.Proxy @VMState)
  putMemRawStorageTxMap theMap = Mod.modify_ (Mod.Proxy @VMState) $ \s ->
    pure $ s {vmMemDBs = (vmMemDBs s) {_storageTxMap = theMap}}
  getMemRawStorageBlockDB = _storageBlockMap . vmMemDBs <$> Mod.get (Mod.Proxy @VMState)
  putMemRawStorageBlockMap theMap = Mod.modify_ (Mod.Proxy @VMState) $ \s ->
    pure $ s {vmMemDBs = (vmMemDBs s) {_storageBlockMap = theMap}}

instance
  ( MonadIO m,
    MonadLogger m,
    (Maybe Word256 `A.Alters` MP.StateRoot) m,
    (MP.StateRoot `A.Alters` MP.NodeData) m,
    (N.NibbleString `A.Alters` N.NibbleString) m
  ) =>
  (RawStorageKey `A.Alters` RawStorageValue) (VMM m)
  where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance (Keccak256 `A.Alters` DBCode) m => (Keccak256 `A.Alters` DBCode) (VMM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

instance (Keccak256 `A.Alters` BlockSummary) m => (Keccak256 `A.Alters` BlockSummary) (VMM m) where
  lookup p = lift . A.lookup p
  insert p k = lift . A.insert p k
  delete p = lift . A.delete p

class Word256Storable a where
  fromWord256 :: Word256 -> a
  toWord256 :: a -> Word256

instance Word256Storable Word256 where
  fromWord256 = id
  toWord256 = id

instance Word256Storable Address where
  fromWord256 h = Address $ fromIntegral (h `mod` (2 ^ (160 :: Integer)) :: Word256)
  toWord256 (Address h) = fromIntegral h

instance Word256Storable Keccak256 where
  fromWord256 h = unsafeCreateKeccak256FromWord256 h
  toWord256 = keccak256ToWord256

instance Word256Storable Int where
  fromWord256 = fromIntegral
  toWord256 = fromIntegral

instance Word256Storable Integer where
  fromWord256 = fromIntegral
  toWord256 = fromIntegral

instance Word256Storable Gas where
  fromWord256 = fromIntegral
  toWord256 = fromIntegral

pop :: (MonadIO m, Word256Storable a) => VMM m a
pop =
  fromWord256 <$> do
    stack' <- gets stack
    v <- liftIO $ MS.pop stack'
    case v of
      Nothing -> throwIO StackTooSmallException
      Just v' -> return v'

localState :: MonadIO m => (VMState -> VMState) -> VMM m a -> VMM m a
localState f mv = do
  state' <- get
  put . f $ state'
  x <- mv
  put state'
  return x

getStackItem :: (MonadIO m, Word256Storable a) => Int -> VMM m a
getStackItem i =
  fromWord256 <$> do
    stack' <- gets stack
    mVal <- liftIO $ MS.get stack' i
    case mVal of
      Nothing -> throwIO StackTooSmallException
      Just val -> return val

push :: (MonadIO m, Word256Storable a) => a -> VMM m ()
push val = do
  stack' <- gets stack
  unlessM (liftIO . MS.push stack' . toWord256 $ val) $
    throwIO StackTooLarge

swapn :: MonadIO m => Int -> VMM m ()
swapn n = do
  stack' <- gets stack
  unlessM (liftIO $ MS.swap stack' $ n - 1) $
    throwIO StackTooSmallException

dupn :: MonadIO m => Int -> VMM m ()
dupn n = do
  stack' <- gets stack
  unlessM (liftIO $ MS.dup stack' $ n - 1) $
    throwIO StackTooSmallException

addDebugCallCreate :: MonadIO m => DebugCallCreate -> VMM m ()
addDebugCallCreate callCreate = do
  state' <- get
  case debugCallCreates state' of
    Just x -> put state' {debugCallCreates = Just (callCreate : x)}
    Nothing -> throwIO NonDebugCallCreate -- "You are trying to add a call create during a non-debug run"

addSuicideList :: MonadIO m => Account -> VMM m ()
addSuicideList acct = modify $ \st -> st {suicideList = acct `S.insert` suicideList st}

getEnvVar :: MonadIO m => (Environment -> a) -> VMM m a
getEnvVar f = f <$> gets environment

addLog :: MonadIO m => Log -> VMM m ()
addLog newLog = modify $ \st -> st {logs = newLog : logs st}

setPC :: MonadIO m => Int -> VMM m ()
setPC !p = do
  pcref <- gets pc
  liftIO $ writeIORefU pcref p

incrementPC :: MonadIO m => Int -> VMM m ()
incrementPC p = do
  pcref <- gets pc
  void . liftIO $ atomicAddCounter pcref p

addToRefund :: MonadIO m => Gas -> VMM m ()
addToRefund (Gas val) = do
  refundref <- gets refund
  void . liftIO . atomicAddCounter refundref $ fromInteger val

clearRefund :: MonadIO m => VMM m ()
clearRefund = do
  refundref <- gets refund
  liftIO $ writeIORefU refundref 0

getCallDepth :: MonadIO m => VMM m Int
getCallDepth = gets callDepth

getGasRemaining :: MonadIO m => VMM m Gas
getGasRemaining = readGasRemaining =<< get

getReturnVal :: MonadIO m => VMM m B.ByteString
getReturnVal = gets $ fromMaybe B.empty . returnVal

setDone :: MonadIO m => Bool -> VMM m ()
setDone done' = modify $ \st -> st {done = done'}

setReturnVal :: MonadIO m => Maybe B.ByteString -> VMM m ()
setReturnVal returnVal' = modify $ \st -> st {returnVal = returnVal'}

setGasRemaining :: MonadIO m => Gas -> VMM m ()
setGasRemaining (Gas gasRemaining') = do
  gasref <- gets vmGasRemaining
  liftIO . writeIORefU gasref $ fromInteger gasRemaining'

useGas :: MonadIO m => Gas -> VMM m ()
useGas (Gas gas) = do
  gasref <- gets vmGasRemaining
  g <- liftIO . atomicSubCounter gasref $ fromInteger gas
  when (g < 0) $ do
    liftIO $ writeIORefU gasref 0
    throwIO OutOfGasException

addGas :: MonadIO m => Gas -> VMM m ()
addGas (Gas gas) = do
  gasref <- gets vmGasRemaining
  currentGas <- fmap toInteger . liftIO $ readIORefU gasref
  if currentGas + fromInteger gas < 0
    then throwIO OutOfGasException
    else void . liftIO . atomicAddCounter gasref $ fromInteger gas

pay' :: VMBase m => String -> Account -> Account -> Integer -> VMM m ()
pay' reason from to val = do
  success <- pay reason from to val
  unless success $ throwIO InsufficientFunds

getStorageKeyVal :: VMBase m => Word256 -> VMM m Word256
getStorageKeyVal key = do
  owner <- getEnvVar envOwner
  getStorageKeyVal' owner key

getAllStorageKeyVals :: VMBase m => VMM m [(MP.Key, Word256)]
getAllStorageKeyVals = do
  owner <- getEnvVar envOwner
  getAllStorageKeyVals' owner

putStorageKeyVal :: VMBase m => Word256 -> Word256 -> VMM m ()
putStorageKeyVal key val = do
  owner <- getEnvVar envOwner
  putStorageKeyVal' owner key val

vmTrace :: MonadIO m => String -> VMM m ()
vmTrace msg = modify $ \st -> st {theTrace = msg : theTrace st}

downcastGas :: MonadIO m => Word256 -> VMM m Gas
downcastGas g =
  if g > fromIntegral (maxBound :: Int)
    then throwIO OutOfGasException
    else return $! fromIntegral g

{-# SPECIALIZE INLINE readGasRemaining :: VMState -> VMM ContextM Gas #-}
readGasRemaining :: MonadIO m => VMState -> m Gas
readGasRemaining = fmap (Gas . toInteger) . liftIO . readIORefU . vmGasRemaining

{-# SPECIALIZE INLINE readRefund :: VMState -> VMM ContextM Gas #-}
readRefund :: MonadIO m => VMState -> m Gas
readRefund = fmap (Gas . toInteger) . liftIO . readIORefU . refund

{-# SPECIALIZE INLINE readPC :: VMState -> VMM ContextM Int #-}
readPC :: MonadIO m => VMState -> m Int
readPC = liftIO . readIORefU . pc
