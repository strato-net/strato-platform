{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.VM.VMM (
  VMM,
  pop,
  localState,
  getStackItem,
  push,
  addDebugCallCreate,
  addSuicideList,
  getEnvVar,
  addLog,
  setPC,
  incrementPC,
  addToRefund,
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
  Word256Storable
  ) where

import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.Trans
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.State
import qualified Data.ByteString                    as B
import           Data.Maybe                         (fromMaybe)
import qualified Data.Set                           as S

import           Blockchain.Data.Address
import           Blockchain.Data.Log
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.BlockSummaryDB
import           Blockchain.DB.ChainDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.ModifyStateDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.VM.Environment
import           Blockchain.VM.VMState
import           Blockchain.VMContext
import           Blockchain.VM.VMException

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

instance HasHashDB VMM where
    getHashDB = lift $ fmap (contextHashDB . dbs) get

instance HasStateDB VMM where
    getStateDB = lift $ fmap (contextStateDB . dbs) get
    setStateDBStateRoot x = do
      vmState <- lift get
      lift $ put vmState{dbs=(dbs vmState){contextStateDB=(contextStateDB $ dbs vmState){MP.stateRoot=x}}}

instance HasChainDB VMM where
  getBlockHashRoot = lift $ fmap (contextBlockHashRoot . dbs) get
  putBlockHashRoot sr = do
    vmState <- lift get
    lift $ put vmState{dbs=(dbs vmState){contextBlockHashRoot = sr}}
  getGenesisRoot = lift $ fmap (contextGenesisRoot . dbs) get
  putGenesisRoot sr = do
    vmState <- lift get
    lift $ put vmState{dbs=(dbs vmState){contextGenesisRoot = sr}}

instance HasStorageDB VMM where
    getStorageTxDB = do
      cxt <- lift get
      return (MP.ldb $ contextStateDB $ dbs cxt, --storage uses the state db also
              contextStorageTxMap $ dbs cxt)
    putStorageTxMap theMap = do
      cxt <- lift get
      lift $ put cxt{dbs=(dbs cxt){contextStorageTxMap=theMap}}
    getStorageBlockDB = do
      cxt <- lift get
      return (MP.ldb $ contextStateDB $ dbs cxt, --storage uses the state db also
              contextStorageBlockMap $ dbs cxt)
    putStorageBlockMap theMap = do
      cxt <- lift get
      lift $ put cxt{dbs=(dbs cxt){contextStorageBlockMap=theMap}}


instance HasCodeDB VMM where
    getCodeDB = lift $ fmap (contextCodeDB . dbs) get

instance HasBlockSummaryDB VMM where
    getBlockSummaryDB = lift $ fmap (contextBlockSummaryDB . dbs) get

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
pop = do
  state' <- lift get
  case state' of
    VMState{stack=val:rest} -> do
                lift $ put state'{stack=rest}
                return $ fromWord256 val
    _ -> throwE StackTooSmallException

localState :: (VMState -> VMState) -> VMM a -> VMM a
localState f mv = do
  state' <- lift get
  lift . put . f $ state'
  x <- mv
  lift . put $ state'
  return x

getStackItem::Word256Storable a=>Int->VMM a
getStackItem i = do
  state' <- lift get
  if length (stack state') > fromIntegral i
    then return $ fromWord256 (stack state' !! i)
    else throwE StackTooSmallException

push::Word256Storable a=>a->VMM ()
push val = do
  state' <- lift get
  when (length (stack state') > 1023) $ throwE StackTooLarge
  lift $ put state'{stack = toWord256 val:stack state'}

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
setPC p = do
  state' <- lift get
  lift $ put state'{pc=p}

incrementPC::Int->VMM ()
incrementPC p = do
  state' <- lift get
  lift $ put state'{pc=pc state' + p}

addToRefund::Integer->VMM ()
addToRefund val = do
  state' <- lift get
  lift $ put state'{refund=refund state' + val}

getCallDepth::VMM Int
getCallDepth = lift $ fmap callDepth $ get

getGasRemaining::VMM Integer
getGasRemaining = lift $ fmap vmGasRemaining $ get

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

setGasRemaining::Integer->VMM ()
setGasRemaining gasRemaining' = do
  state' <- lift get
  lift $ put state'{vmGasRemaining=gasRemaining'}

useGas::Integer->VMM ()
useGas gas = do
  state' <- lift get
  case vmGasRemaining state' - gas of
    x | x < 0 -> do
      lift $ put state'{vmGasRemaining=0}
      throwE OutOfGasException
    x -> lift $ put state'{vmGasRemaining=x}

addGas::Integer->VMM ()
addGas gas = do
  state' <- lift get
  case vmGasRemaining state' + gas of
    x | x < 0 -> throwE OutOfGasException
    x -> lift $ put state'{vmGasRemaining=x}

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

