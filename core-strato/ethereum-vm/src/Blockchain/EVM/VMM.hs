{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Blockchain.EVM.VMM (
  VMM,
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

import           Control.Monad
import qualified Control.Monad.Change.Alter         as A
import qualified Control.Monad.Change.Modify        as Mod
import           Control.Monad.Trans
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import qualified Data.ByteString                    as B
import           Data.IORef.Unboxed
import           Data.Maybe                         (fromMaybe)
import qualified Data.NibbleString                  as N
import qualified Data.Set                           as S
import           MonadUtils

import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockSummary
import           Blockchain.Data.Log
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.StorageDB
import           Blockchain.EVM.Environment
import qualified Blockchain.EVM.MutableStack as MS
import           Blockchain.EVM.VMState
import           Blockchain.ExtWord
import           Blockchain.Output
import           Blockchain.SHA
import           Blockchain.VM.VMException
import           Blockchain.VMContext

type VMM = ExceptT VMException (StateT VMState (ResourceT (LoggingT IO)))

instance HasMemAddressStateDB VMM where
  getAddressStateTxDBMap = do
      cxt <- lift get
      return $ contextAddressStateTxDBMap $ dbs cxt
  putAddressStateTxDBMap theMap = do
      cxt <- lift get
      lift $ put cxt{dbs=(dbs cxt){contextAddressStateTxDBMap=theMap}}
  getAddressStateBlockDBMap = do
      cxt <- lift get
      return $ contextAddressStateBlockDBMap $ dbs cxt
  putAddressStateBlockDBMap theMap = do
      cxt <- lift get
      lift $ put cxt{dbs=(dbs cxt){contextAddressStateBlockDBMap=theMap}}

instance (Address `A.Alters` AddressState) VMM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (MP.StateRoot `A.Alters` MP.NodeData) VMM where
  lookup _ = MP.genericLookupDB $ lift $ gets (MP.ldb . contextStateDB . dbs)
  insert _ = MP.genericInsertDB $ lift $ gets (MP.ldb . contextStateDB . dbs)
  delete _ = MP.genericDeleteDB $ lift $ gets (MP.ldb . contextStateDB . dbs)

instance (N.NibbleString `A.Alters` N.NibbleString) VMM where
  lookup _ = genericLookupHashDB $ lift $ gets $ contextHashDB . dbs
  insert _ = genericInsertHashDB $ lift $ gets $ contextHashDB . dbs
  delete _ = genericDeleteHashDB $ lift $ gets $ contextHashDB . dbs

instance Mod.Modifiable MP.StateRoot VMM where
  get _    = lift $ gets (MP.stateRoot . contextStateDB . dbs)
  put _ sr = lift $ get >>= \c -> put c{dbs=(dbs c){contextStateDB=(contextStateDB $ dbs c){MP.stateRoot=sr}}}

instance HasMemRawStorageDB VMM where
    getMemRawStorageTxDB = do
      cxt <- lift get
      return (MP.ldb $ contextStateDB $ dbs cxt, --storage uses the state db also
              contextStorageTxMap $ dbs cxt)
    putMemRawStorageTxMap theMap = do
      cxt <- lift get
      lift $ put cxt{dbs=(dbs cxt){contextStorageTxMap=theMap}}
    getMemRawStorageBlockDB = do
      cxt <- lift get
      return (MP.ldb $ contextStateDB $ dbs cxt, --storage uses the state db also
              contextStorageBlockMap $ dbs cxt)
    putMemRawStorageBlockMap theMap = do
      cxt <- lift get
      lift $ put cxt{dbs=(dbs cxt){contextStorageBlockMap=theMap}}

instance (RawStorageKey `A.Alters` RawStorageValue) VMM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB

instance (SHA `A.Alters` DBCode) VMM where
  lookup _ = genericLookupCodeDB $ lift $ gets $ contextCodeDB . dbs
  insert _ = genericInsertCodeDB $ lift $ gets $ contextCodeDB . dbs
  delete _ = genericDeleteCodeDB $ lift $ gets $ contextCodeDB . dbs

instance (SHA `A.Alters` BlockSummary) VMM where
  lookup _ = genericLookupBlockSummaryDB $ lift $ gets (contextBlockSummaryDB . dbs)
  insert _ = genericInsertBlockSummaryDB $ lift $ gets (contextBlockSummaryDB . dbs)
  delete _ = genericDeleteBlockSummaryDB $ lift $ gets (contextBlockSummaryDB . dbs)

class Word256Storable a where
  fromWord256::Word256->a
  toWord256::a->Word256

instance Word256Storable Word256 where
  fromWord256 = id
  toWord256 = id

instance Word256Storable Address where
  fromWord256 h = Address $ fromIntegral (h `mod` (2^(160::Integer))::Word256)
  toWord256 (Address h) = fromIntegral h

instance Word256Storable SHA where
  fromWord256 h = SHA h
  toWord256 (SHA h) = h

instance Word256Storable Int where
  fromWord256 = fromIntegral
  toWord256 = fromIntegral

instance Word256Storable Integer where
  fromWord256 = fromIntegral
  toWord256 = fromIntegral

pop::Word256Storable a=>VMM a
pop = fromWord256 <$> do
  stack' <- lift $ gets stack
  v <- liftIO $ MS.pop stack'
  case v of
    Nothing -> throwE StackTooSmallException
    Just v' -> return v'

localState :: (VMState -> VMState) -> VMM a -> VMM a
localState f mv = do
  state' <- lift get
  lift . put . f $ state'
  x <- mv
  lift . put $ state'
  return x

getStackItem::Word256Storable a=>Int->VMM a
getStackItem i = fromWord256 <$> do
  stack' <- lift $ gets stack
  mVal <- liftIO $ MS.get stack' i
  case mVal of
    Nothing -> throwE StackTooSmallException
    Just val -> return val

push::Word256Storable a=>a->VMM ()
push val = do
  stack' <- lift $ gets stack
  unlessM (liftIO . MS.push stack' . toWord256 $ val) $
    throwE StackTooLarge

swapn::Int->VMM ()
swapn n = do
  stack' <- lift $ gets stack
  unlessM (liftIO $ MS.swap stack' $ n-1) $
    throwE StackTooSmallException

dupn::Int->VMM ()
dupn n = do
  stack' <- lift $ fmap stack get
  unlessM (liftIO $ MS.dup stack' $ n-1) $
    throwE StackTooSmallException

addDebugCallCreate::DebugCallCreate->VMM ()
addDebugCallCreate callCreate = do
  state' <- lift $ get
  case debugCallCreates state' of
    Just x  -> lift $ put state'{debugCallCreates = Just (callCreate:x)}
    Nothing -> error "You are trying to add a call create during a non-debug run"

addSuicideList::Address->VMM ()
addSuicideList address' = do
  state' <- lift get
  lift $ put state'{suicideList = address' `S.insert` suicideList state'}

getEnvVar::(Environment->a)->VMM a
getEnvVar f = do
  state' <- lift get
  return $ f $ environment state'

addLog::Log->VMM ()
addLog newLog = do
  state' <- lift get
  lift $ put state'{logs=newLog:logs state'}

setPC::Int->VMM ()
setPC !p = do
  pcref <- lift $ gets pc
  liftIO $ writeIORefU pcref p

incrementPC::Int->VMM ()
incrementPC p = do
  pcref <- lift $ gets pc
  void . liftIO $ atomicAddCounter pcref p

addToRefund::Int->VMM ()
addToRefund val = do
  refundref <- lift $ gets refund
  void . liftIO . atomicAddCounter refundref $ val

clearRefund :: VMM ()
clearRefund = do
  refundref <- lift $ gets refund
  liftIO $ writeIORefU refundref 0

getCallDepth::VMM Int
getCallDepth = lift $ fmap callDepth $ get

getGasRemaining::VMM Gas
getGasRemaining = readGasRemaining =<< lift get

getReturnVal :: VMM B.ByteString
getReturnVal = (fromMaybe B.empty . returnVal) <$> lift get

setDone::Bool->VMM ()
setDone done' = do
  state' <- lift get
  lift $ put state'{done=done'}

setReturnVal::Maybe B.ByteString->VMM ()
setReturnVal returnVal' = do
  state' <- lift get
  lift $ put state'{returnVal=returnVal'}

setGasRemaining::Gas->VMM ()
setGasRemaining gasRemaining' = do
  gasref <- lift $ gets vmGasRemaining
  liftIO $ writeIORefU gasref gasRemaining'

useGas::Gas->VMM ()
useGas gas = do
  gasref <- lift $ gets vmGasRemaining
  g <- liftIO $ atomicSubCounter gasref gas
  when (g < 0) $ do
    liftIO $ writeIORefU gasref 0
    throwE OutOfGasException

addGas::Gas->VMM ()
addGas gas = do
  gasref <- lift $ gets vmGasRemaining
  currentGas <- liftIO $ readIORefU gasref
  if currentGas + gas < 0
    then throwE OutOfGasException
    else void . liftIO $ atomicAddCounter gasref gas

pay'::String->Address->Address->Integer->VMM ()
pay' reason from to val = do
  success <- pay reason from to val
  unless success $ throwE InsufficientFunds

getStorageKeyVal::Word256->VMM Word256
getStorageKeyVal key = do
  owner <- getEnvVar envOwner
  getStorageKeyVal' owner key

getAllStorageKeyVals::VMM [(MP.Key, Word256)]
getAllStorageKeyVals = do
  owner <- getEnvVar envOwner
  getAllStorageKeyVals' owner

putStorageKeyVal::Word256->Word256->VMM ()
putStorageKeyVal key val = do
  owner <- getEnvVar envOwner
  putStorageKeyVal' owner key val

vmTrace::String->VMM ()
vmTrace msg = do
  cxt <- lift $ get
  lift $ put cxt{theTrace=msg:theTrace cxt}


downcastGas :: Word256 -> VMM Gas
downcastGas g = if g > fromIntegral (maxBound :: Int)
                  then throwE OutOfGasException
                  else return $! fromIntegral g

{-# SPECIALIZE INLINE readGasRemaining :: VMState -> VMM Gas #-}
readGasRemaining :: MonadIO m => VMState -> m Gas
readGasRemaining = liftIO . readIORefU . vmGasRemaining

{-# SPECIALIZE INLINE readRefund :: VMState -> VMM Gas #-}
readRefund :: MonadIO m => VMState -> m Gas
readRefund = liftIO . readIORefU . refund

{-# SPECIALIZE INLINE readPC :: VMState -> VMM Int #-}
readPC :: MonadIO m => VMState -> m Int
readPC = liftIO . readIORefU . pc
