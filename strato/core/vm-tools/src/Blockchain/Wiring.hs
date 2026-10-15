{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}

{-# OPTIONS -fno-warn-orphans      #-}

module Blockchain.Wiring
  ( HasContext,
    contextGet,
    contextGets,
    contextModify',
    contextPut,
    compactContextM,
    withFetchMissingNodes,
    gets
  )
where

import BlockApps.Init ()
import BlockApps.Logging
import Blockchain.Bagger.BaggerState (BaggerState)
import Blockchain.DB.BlockSummaryDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.RawStorageDB
import Blockchain.DB.SQLDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockSummary
import Blockchain.Data.DataDefs
import Blockchain.Stream.VMEvent (VMEvent(..), produceVMEvents)
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import qualified Control.Monad.Composable.StateDB as MP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr ()
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import qualified Blockchain.TxRunResultCache as TRC
import Blockchain.VMContext
import Control.DeepSeq
import Control.Lens hiding (Context (..))
import Control.Monad (void)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Base
import Control.Monad.Composable.StateDB (withMissingNodeFetcher)
import Control.Monad.Composable.Streaming
import Control.Applicative ((<|>))
import Control.Monad.IO.Class
import qualified Data.NibbleString as N
import qualified Data.Text as T
import Blockchain.Data.VmTrace (VmTracer)
import Debugger
import Text.Format (format)
import UnliftIO

type HasContext m = (Monad m, MonadIO m, AccessibleEnv Context m)

get :: HasContext m => m ContextState
get = readIORef =<< fmap _state accessEnv
{-# INLINE get #-}

gets :: HasContext m => (ContextState -> a) -> m a
gets f = f <$> get
{-# INLINE gets #-}

put :: HasContext m => ContextState -> m ()
put c = fmap _state accessEnv >>= \i -> atomicModifyIORef' i (const (c, ()))
{-# INLINE put #-}

modify :: HasContext m => (ContextState -> ContextState) -> m ()
modify f = fmap _state accessEnv >>= \i -> atomicModifyIORef' i (\a -> (f a, ()))
{-# INLINE modify #-}

modify' :: HasContext m => (ContextState -> ContextState) -> m ()
modify' f = fmap _state accessEnv >>= \i -> atomicModifyIORef' i (\a -> (f a, ()))
{-# INLINE modify' #-}

contextGet :: HasContext m => m ContextState
contextGet = get
{-# INLINE contextGet #-}

contextGets :: HasContext m => (ContextState -> a) -> m a
contextGets = gets
{-# INLINE contextGets #-}

contextPut :: HasContext m => ContextState -> m ()
contextPut = put
{-# INLINE contextPut #-}

contextModify :: HasContext m => (ContextState -> ContextState) -> m ()
contextModify = modify
{-# INLINE contextModify #-}

contextModify' :: HasContext m => (ContextState -> ContextState) -> m ()
contextModify' = modify'
{-# INLINE contextModify' #-}

compactContextM :: HasContext m => m ()
compactContextM = modify' force


instance Mod.Modifiable ContextState ContextM where
  get _ = get
  put _ = put

instance Mod.Modifiable (Maybe DebugSettings) ContextM where
  get _ = gets $ view debugSettings
  put _ ds = modify $ debugSettings .~ ds

instance Mod.Modifiable (Maybe VmTracer) ContextM where
  get _ = gets $ view vmTracer
  put _ t = modify $ vmTracer .~ t

instance Mod.Accessible ContextState ContextM where
  access _ = get

instance Mod.Modifiable BaggerState ContextM where
  get _ = contextGets _baggerState
  put _ s = contextModify $ baggerState .~ s

instance Mod.Accessible TRC.Cache ContextM where
  access _ = contextGets _txRunResultsCache

instance {-# OVERLAPPING #-} HasStreaming m => m `Mod.Yields` TransactionResult where
  yield tr = void $ produceVMEvents [NewTransactionResult tr]

-- | Fetch Merkle-Patricia nodes missing locally from peers for the body's duration.
withFetchMissingNodes :: ContextM a -> ContextM a
withFetchMissingNodes f = ContextM $ withMissingNodeFetcher (unContextM . fetchMPNode) (unContextM f)

-- | Ask peers for a node missing locally and wait (up to 10s) for the reply
-- on the VM's own task topic; used only while diagnosing a state-root mismatch,
-- so when no peer replies there is nothing left to do but say so and stop.
fetchMPNode :: MP.StateRoot -> ContextM (Maybe MP.TrieNode)
fetchMPNode k = do
  void $ writeUnseqEvents [IEGetMPNodes [k]]
  mnd <- timeout 10000000 $
    runConsume "ethereum-vm" seqVmTasksTopicName $ \evs -> do
      let findND (VmMPNodesReceived [nd]) | k == MP.sha2StateRoot (rlpHash nd) = Just nd
          findND _ = Nothing
      pure $ foldr (<|>) Nothing (findND <$> evs)
  case mnd of
    Just nd -> pure (Just nd)
    Nothing -> error $ "While diagnosing the stateRoot mismatch above, asked peers for MP node " ++ format k
      ++ " to compare the block's state with ours; no reply reached the VM within 10s. Stopping here with what is known."

instance A.Selectable Address AddressState ContextM where
  select _ = getAddressStateMaybe

instance (Address `A.Alters` AddressState) ContextM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (Keccak256 `A.Alters` DBCode) ContextM where
  lookup _ k = readStore memCodeDB (\d -> genericLookupCodeDB (pure $ _codeDB d) k) k
  insert _ k v = writeStore memCodeDB (\d -> genericInsertCodeDB (pure $ _codeDB d) k v) k (Just v)
  delete _ k = writeStore memCodeDB (\d -> genericDeleteCodeDB (pure $ _codeDB d) k) k Nothing

instance A.Selectable FilePath (Either String String) ContextM where
  select _ path = accessEnv >>= \ctx -> liftIO (_resolveFile ctx path)

instance (N.NibbleString `A.Alters` N.NibbleString) ContextM where
  lookup _ k = readStore memHashDB (\d -> genericLookupHashDB (pure $ _hashDB d) k) k
  insert _ k v = writeStore memHashDB (\d -> genericInsertHashDB (pure $ _hashDB d) k v) k (Just v)
  delete _ k = writeStore memHashDB (\d -> genericDeleteHashDB (pure $ _hashDB d) k) k Nothing

instance (RawStorageKey `A.Alters` RawStorageValue) ContextM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB
  lookupWithDefault _ = genericLookupWithDefaultRawStorageDB

instance (Keccak256 `A.Alters` BlockSummary) ContextM where
  lookup _ k = readStore memBlockSummaryDB (\d -> genericLookupBlockSummaryDB (pure $ _blockSummaryDB d) k) k
  insert _ k v = writeStore memBlockSummaryDB (\d -> genericInsertBlockSummaryDB (pure $ _blockSummaryDB d) k v) k (Just v)
  delete _ k = writeStore memBlockSummaryDB (\d -> genericDeleteBlockSummaryDB (pure $ _blockSummaryDB d) k) k Nothing

instance Mod.Accessible SQLDB ContextM where
  access _ = _sqldb <$> getDBs

instance Mod.Accessible RBDB.RedisConnection ContextM where
  access _ = _redisPool <$> getDBs

instance Mod.Modifiable GasCap ContextM where
  get _ = contextGets (GasCap . _vmGasCap)

  put _ (GasCap g) = do
    contextModify (vmGasCap .~ g)
    $logDebugS "#### Mod.put @vmGasCap" . T.pack $ "VM Gas Cap updated to: " ++ show g
