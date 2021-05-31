{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE PolyKinds             #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.EVM.VMM (
  VMM,
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
  readRefund
  ) where

import           Control.Lens                       hiding (from, to)
import           Control.Monad
import           Control.Monad.FT
import           Control.Monad.Reader
import qualified Data.ByteString                    as B
import           Data.IORef.Unboxed
import qualified Data.Map.Strict                    as M
import           Data.Maybe                         (fromMaybe)
import qualified Data.NibbleString                  as N
import qualified Data.Set                           as S
import           MonadUtils

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.Log
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StorageDB
import           Blockchain.EVM.Environment
import qualified Blockchain.EVM.MutableStack as MS
import           Blockchain.EVM.VMState
import           Blockchain.ExtWord
import           Blockchain.Output
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Gas
import           Blockchain.VM.VMException
import           Blockchain.VMContext

import           UnliftIO

type VMM m = ReaderT (IORef VMState) m

type MonadEVM m = ( MonadIO m
                  , MonadLogger m
                  , Modifiable VMState m
                  )

vmstateGet :: MonadIO m => VMM m VMState
vmstateGet = readIORef =<< ask
{-# INLINE vmstateGet #-}

vmstateGets :: MonadIO m => (VMState -> a) -> VMM m a
vmstateGets f = f <$> vmstateGet
{-# INLINE vmstateGets #-}

vmstatePut :: MonadIO m => VMState -> VMM m ()
vmstatePut c = ask >>= \i -> atomicWriteIORef i c
{-# INLINE vmstatePut #-}

vmstateModify :: MonadIO m => (VMState -> VMState) -> VMM m ()
vmstateModify f = ask >>= \i -> atomicModifyIORef i (\a -> (f a, ()))
{-# INLINE vmstateModify #-}

instance MonadIO m => Gettable VMState (VMM m) where
  get = vmstateGet
instance MonadIO m => Puttable VMState (VMM m) where
  put = vmstatePut
instance MonadIO m => Modifiable VMState (VMM m) where
  modifyPure_ = vmstateModify

instance MonadIO m => HasMemAddressStateDB (VMM m) where
  getAddressStateTxDBMap = _stateTxMap . vmMemDBs <$> get @VMState
  putAddressStateTxDBMap theMap = modifyPure_ @VMState $ \s ->
      s{vmMemDBs=(vmMemDBs s){_stateTxMap=theMap}}
  getAddressStateBlockDBMap = _stateBlockMap . vmMemDBs <$> get @VMState
  putAddressStateBlockDBMap theMap = modifyPure_ @VMState $ \s ->
      s{vmMemDBs=(vmMemDBs s){_stateBlockMap=theMap}}

instance Selectable MP.NodeData MP.StateRoot m => Selectable MP.NodeData MP.StateRoot (VMM m) where
  select   = lift . select
instance Insertable MP.NodeData MP.StateRoot m => Insertable MP.NodeData MP.StateRoot (VMM m) where
  insert k = lift . insert k
instance Deletable  MP.NodeData MP.StateRoot m => Deletable  MP.NodeData MP.StateRoot (VMM m) where
  delete   = lift . delete @MP.NodeData
instance Alterable  MP.NodeData MP.StateRoot m => Alterable  MP.NodeData MP.StateRoot (VMM m) where

instance Selectable N.NibbleString N.NibbleString m => Selectable N.NibbleString N.NibbleString (VMM m) where
  select   = lift . select
instance Insertable N.NibbleString N.NibbleString m => Insertable N.NibbleString N.NibbleString (VMM m) where
  insert k = lift . insert k
instance Deletable  N.NibbleString N.NibbleString m => Deletable  N.NibbleString N.NibbleString (VMM m) where
  delete   = lift . delete @N.NibbleString
instance Alterable  N.NibbleString N.NibbleString m => Alterable  N.NibbleString N.NibbleString (VMM m) where

instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Selectable AddressState Account (VMM m) where
  select = getAddressStateMaybe
instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Insertable AddressState Account (VMM m) where
  insert = putAddressState
instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Deletable AddressState Account (VMM m) where
  delete = deleteAddressState
instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Alterable AddressState Account (VMM m) where

instance ( MonadIO m
         , Selectable MP.StateRoot (Maybe Word256) m
         ) => Selectable MP.StateRoot (Maybe Word256) (VMM m) where
  select chainId = do
    (CurrentBlockHash bh) <- get @CurrentBlockHash
    mSR <- view (stateRoots . at (bh, chainId)) <$> get @MemDBs
    case mSR of
      Just sr -> pure $ Just sr
      Nothing -> lift $ select chainId
instance ( MonadIO m
         , Insertable MP.StateRoot (Maybe Word256) m
         ) => Insertable MP.StateRoot (Maybe Word256) (VMM m) where
  insert chainId sr = do
    (CurrentBlockHash bh) <- get @CurrentBlockHash
    modifyStatefully_ @MemDBs $ stateRoots %= M.insert (bh, chainId) sr
    lift $ insert chainId sr
instance ( MonadIO m
         , Deletable MP.StateRoot (Maybe Word256) m
         ) => Deletable MP.StateRoot (Maybe Word256) (VMM m) where
  delete chainId = do
    (CurrentBlockHash bh) <- get @CurrentBlockHash
    modifyStatefully_ @MemDBs $ stateRoots %= M.delete (bh, chainId)
    lift $ delete @MP.StateRoot chainId
instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         ) => Alterable MP.StateRoot (Maybe Word256) (VMM m) where

instance MonadIO m => Gettable MemDBs (VMM m) where
  get    = vmMemDBs <$> get @VMState
instance MonadIO m => Puttable MemDBs (VMM m) where
  put md = modifyPure_ @VMState $ \s -> s{vmMemDBs=md}
instance MonadIO m => Modifiable MemDBs (VMM m) where

instance MonadIO m => Gettable CurrentBlockHash (VMM m) where
  get    = fromMaybe (CurrentBlockHash $ unsafeCreateKeccak256FromWord256 0) . _currentBlock <$> get @MemDBs
instance MonadIO m => Puttable CurrentBlockHash (VMM m) where
  put md = modifyStatefully_ @MemDBs $ currentBlock ?= md
instance MonadIO m => Modifiable CurrentBlockHash (VMM m) where

instance MonadIO m => HasMemRawStorageDB (VMM m) where
  getMemRawStorageTxDB = _storageTxMap . vmMemDBs <$> get @VMState
  putMemRawStorageTxMap theMap = modifyPure_ @VMState $ \s ->
      s{vmMemDBs=(vmMemDBs s){_storageTxMap=theMap}}
  getMemRawStorageBlockDB = _storageBlockMap . vmMemDBs <$> get @VMState
  putMemRawStorageBlockMap theMap = modifyPure_ @VMState $ \s ->
      s{vmMemDBs=(vmMemDBs s){_storageBlockMap=theMap}}

instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Selectable RawStorageValue RawStorageKey (VMM m) where
  select             = genericLookupRawStorageDB
  selectWithFallback = genericLookupWithFallbackRawStorageDB
instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Insertable RawStorageValue RawStorageKey (VMM m) where
  insert = genericInsertRawStorageDB
instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Deletable RawStorageValue RawStorageKey (VMM m) where
  delete = genericDeleteRawStorageDB
instance ( MonadIO m
         , Alterable MP.StateRoot (Maybe Word256) m
         , Alterable MP.NodeData MP.StateRoot m
         , Alterable N.NibbleString N.NibbleString m
         ) => Alterable RawStorageValue RawStorageKey (VMM m) where

instance Selectable DBCode Keccak256 m => Selectable DBCode Keccak256 (VMM m) where
  select   = lift . select
instance Insertable DBCode Keccak256 m => Insertable DBCode Keccak256 (VMM m) where
  insert k = lift . insert k
instance Deletable  DBCode Keccak256 m => Deletable  DBCode Keccak256 (VMM m) where
  delete   = lift . delete @DBCode
instance Alterable  DBCode Keccak256 m => Alterable  DBCode Keccak256 (VMM m) where

instance Selectable BlockSummary Keccak256 m => Selectable BlockSummary Keccak256 (VMM m) where
  select   = lift . select
instance Insertable BlockSummary Keccak256 m => Insertable BlockSummary Keccak256 (VMM m) where
  insert k = lift . insert k
instance Deletable  BlockSummary Keccak256 m => Deletable  BlockSummary Keccak256 (VMM m) where
  delete   = lift . delete @BlockSummary
instance Alterable  BlockSummary Keccak256 m => Alterable  BlockSummary Keccak256 (VMM m) where

class Word256Storable a where
  fromWord256::Word256->a
  toWord256::a->Word256

instance Word256Storable Word256 where
  fromWord256 = id
  toWord256 = id

instance Word256Storable Address where
  fromWord256 h = Address $ fromIntegral (h `mod` (2^(160::Integer))::Word256)
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
pop = fromWord256 <$> do
  stack' <- vmstateGets stack
  v <- liftIO $ MS.pop stack'
  case v of
    Nothing -> throwIO StackTooSmallException
    Just v' -> return v'

localState :: MonadIO m => (VMState -> VMState) -> VMM m a -> VMM m a
localState f mv = do
  state' <- vmstateGet
  vmstatePut . f $ state'
  x <- mv
  vmstatePut state'
  return x

getStackItem :: (MonadIO m, Word256Storable a) => Int -> VMM m a
getStackItem i = fromWord256 <$> do
  stack' <- vmstateGets stack
  mVal <- liftIO $ MS.get stack' i
  case mVal of
    Nothing -> throwIO StackTooSmallException
    Just val -> return val

push :: (MonadIO m, Word256Storable a) => a -> VMM m ()
push val = do
  stack' <- vmstateGets stack
  unlessM (liftIO . MS.push stack' . toWord256 $ val) $
    throwIO StackTooLarge

swapn :: MonadIO m => Int -> VMM m ()
swapn n = do
  stack' <- vmstateGets stack
  unlessM (liftIO $ MS.swap stack' $ n-1) $
    throwIO StackTooSmallException

dupn :: MonadIO m => Int -> VMM m ()
dupn n = do
  stack' <- vmstateGets stack
  unlessM (liftIO $ MS.dup stack' $ n-1) $
    throwIO StackTooSmallException

addDebugCallCreate :: MonadIO m => DebugCallCreate -> VMM m ()
addDebugCallCreate callCreate = do
  state' <- vmstateGet
  case debugCallCreates state' of
    Just x  -> vmstatePut state'{debugCallCreates = Just (callCreate:x)}
    Nothing -> throwIO NonDebugCallCreate -- "You are trying to add a call create during a non-debug run"

addSuicideList :: MonadIO m => Account -> VMM m ()
addSuicideList acct = vmstateModify $ \st -> st{suicideList = acct `S.insert` suicideList st}

getEnvVar :: MonadIO m => (Environment -> a) -> VMM m a
getEnvVar f = f <$> vmstateGets environment

addLog :: MonadIO m => Log -> VMM m ()
addLog newLog = vmstateModify $ \st -> st{logs=newLog:logs st}

setPC :: MonadIO m => Int -> VMM m ()
setPC !p = do
  pcref <- vmstateGets pc
  liftIO $ writeIORefU pcref p

incrementPC :: MonadIO m => Int -> VMM m ()
incrementPC p = do
  pcref <- vmstateGets pc
  void . liftIO $ atomicAddCounter pcref p

addToRefund :: MonadIO m => Gas -> VMM m ()
addToRefund (Gas val) = do
  refundref <- vmstateGets refund
  void . liftIO . atomicAddCounter refundref $ fromInteger val

clearRefund :: MonadIO m => VMM m ()
clearRefund = do
  refundref <- vmstateGets refund
  liftIO $ writeIORefU refundref 0

getCallDepth :: MonadIO m => VMM m Int
getCallDepth = vmstateGets callDepth

getGasRemaining :: MonadIO m => VMM m Gas
getGasRemaining = readGasRemaining =<< vmstateGet

getReturnVal :: MonadIO m => VMM m B.ByteString
getReturnVal = vmstateGets $ fromMaybe B.empty . returnVal

setDone :: MonadIO m => Bool -> VMM m ()
setDone done' = vmstateModify $ \st -> st{done=done'}

setReturnVal :: MonadIO m => Maybe B.ByteString -> VMM m ()
setReturnVal returnVal' = vmstateModify $ \st -> st{returnVal=returnVal'}

setGasRemaining :: MonadIO m => Gas -> VMM m ()
setGasRemaining (Gas gasRemaining') = do
  gasref <- vmstateGets vmGasRemaining
  liftIO . writeIORefU gasref $ fromInteger gasRemaining'

useGas :: MonadIO m => Gas -> VMM m ()
useGas (Gas gas) = do
  gasref <- vmstateGets vmGasRemaining
  g <- liftIO . atomicSubCounter gasref $ fromInteger gas
  when (g < 0) $ do
    liftIO $ writeIORefU gasref 0
    throwIO OutOfGasException

addGas :: MonadIO m => Gas -> VMM m ()
addGas (Gas gas) = do
  gasref <- vmstateGets vmGasRemaining
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
vmTrace msg = vmstateModify $ \st -> st{theTrace=msg:theTrace st}

downcastGas :: MonadIO m => Word256 -> VMM m Gas
downcastGas g = if g > fromIntegral (maxBound :: Int)
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
