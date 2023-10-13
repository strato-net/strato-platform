{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS_GHC -fno-warn-name-shadowing #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.GlobalsColdStorage
  ( initStorage,
    readStorage,
    asyncWriteToStorage,
    syncStorage,
    Handle,
    fakeHandle,
  )
where

import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import ClassyPrelude hiding (Handle)
import Control.Lens ((^.))
import Data.Binary hiding (get)
import Database.Persist
import Database.Persist.Sql
import Database.Persist.TH
import Slipstream.Data.GlobalsColdStorage
import Slipstream.Metrics
import UnliftIO.Concurrent
import UnliftIO.Resource
import qualified Prelude as P ()

-- Data definitions --

share
  [mkPersist sqlSettings {mpsEntityJSON = Nothing}, mkMigrate "migrateStore"]
  [persistLowerCase|
ColdStorage
  address Address
  chainId MChainId
  binaryValues ByteString
  Primary address chainId
  deriving Eq Show
|]

-- SQL writer daemon --

storageWorker :: MonadUnliftIO m => TQueue QueueElem -> ReaderT SqlBackend m ()
storageWorker q = forever $ do
  datum <- atomically $ readTQueue q
  traverse (uncurry repsert) . serialize $ datum

-- Data translation --

serialize :: QueueElem -> Maybe (Key ColdStorage, ColdStorage)
serialize SyncFlush = Nothing
serialize (PreStorageEntry (Account a mc) vs) =
  let mci = MChainId $ ChainId <$> mc
   in Just (ColdStorageKey a mci, ColdStorage a mci . toStrict . encode $ vs)

deserialize :: Maybe ColdStorage -> Either Text [(Text, Value)]
deserialize Nothing = Left "storage not found"
deserialize (Just (ColdStorage _ _ bvs)) =
  case decodeOrFail (fromStrict bvs) of
    Left (_, _, err) -> Left $ "corrupted binary: " <> pack err
    Right (_, _, vs) -> Right vs

-- API --

-- | Migrates tables, and starts a background thread for writing cache entries to the database
initStorage ::
  (MonadUnliftIO m, MonadResource m) =>
  ReaderT SqlBackend m Handle
initStorage = do
  void $ runMigrationSilent migrateStore
  queue <- atomically newTQueue
  tid <- forkIO $ storageWorker queue
  void . register . liftIO . killThread $ tid
  sql <- ask
  return $! Handle queue sql

-- | Check postgres for an entry about this account's values
readStorage ::
  MonadUnliftIO m =>
  Handle ->
  Account ->
  m (Either Text [(Text, Value)])
readStorage FakeHandle _ = recordStorageResult $! Left "fake handle"
readStorage (Handle _ sql) acct =
  recordStorageResult =<< do
    flip runReaderT sql
      . fmap deserialize
      . get
      . ColdStorageKey (acct ^. accountAddress)
      $ MChainId (fmap ChainId $ acct ^. accountChainId)

recordStorageResult :: (MonadIO m) => Either Text a -> m (Either Text a)
recordStorageResult v = do
  case v of
    Right _ -> recordStorageHit
    Left err -> recordStorageMiss err
  return $! v

-- | Schedule the write of an accounts values. syncStorage can be used to check for completion
--   of writes.
asyncWriteToStorage :: MonadIO m => Handle -> Account -> [(Text, Value)] -> m ()
asyncWriteToStorage FakeHandle _ _ = return ()
asyncWriteToStorage (Handle q _) a vs = atomically . writeTQueue q $ PreStorageEntry a vs

-- | Block until all pending writes have been sent.
syncStorage :: MonadIO m => Handle -> m ()
syncStorage FakeHandle = return ()
syncStorage (Handle q _) = do
  atomically . writeTQueue q $ SyncFlush
  void . atomically $ checkSTM =<< isEmptyTQueue q
