{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
module Slipstream.GlobalsColdStorage
  ( initStorage
  , readStorage
  , asyncWriteToStorage
  , syncStorage
  , Handle
  , fakeHandle
  ) where

import BlockApps.Ethereum
import BlockApps.Solidity.Value
import ClassyPrelude hiding (Handle)
import Control.Monad.IO.Unlift
import Data.Binary hiding (get)
import Data.LargeWord
import Database.Persist
import Database.Persist.Sql
import Database.Persist.TH
import qualified Prelude as P ()
import System.IO.Unsafe
import UnliftIO.Resource

import qualified Slipstream.DelayedBloomFilter as DBF
import Slipstream.Metrics
import Slipstream.MChainId

-- Data definitions --

data QueueElem = PreStorageEntry Address (Maybe ChainId) [(Text, Value)]
               | SyncFlush

deriving instance Read Word160
deriving instance Read Address

share [mkPersist sqlSettings{mpsEntityJSON=Nothing}, mkMigrate "migrateStore"] [persistLowerCase|
ColdStorage
  address Address
  chainId MChainId
  binaryValues ByteString
  Primary address chainId
  deriving Eq Show
|]

-- Filter Management --
-- The importance of a shared filter between all worker threads is
-- to prevent a scenario where different cold storage handles have
-- different opinions about the contents of the database.
type AddrFilter = DBF.DelayedBloomFilter (Address, Maybe ChainId)

{-# NOINLINE globalBloomFilter #-}
globalBloomFilter :: TMVar AddrFilter
globalBloomFilter = unsafePerformIO newEmptyTMVarIO

readFilter :: STM AddrFilter
readFilter = readTMVar globalBloomFilter

setFilter :: AddrFilter -> STM ()
setFilter = void . swapTMVar globalBloomFilter

initFilter :: MonadIO m => Int -> m Bool
initFilter = atomically . tryPutTMVar globalBloomFilter . DBF.newFilter

-- SQL writer daemon --

storageWorker :: (MonadUnliftIO m, MonadIO m) => TQueue QueueElem -> ReaderT SqlBackend m ()
storageWorker q = forever $ do
  datum <- atomically $ readTQueue q
  recordKeys datum
  traverse (uncurry repsert) . serialize $ datum

recordKeys :: MonadIO m => QueueElem -> m ()
recordKeys SyncFlush = return ()
recordKeys (PreStorageEntry a mc _) = do
  depth <- atomically $ do
    f <- readFilter
    setFilter $ DBF.insert (a, mc) f
    return $! DBF.stackDepth f
  incNumBloomWrites
  recordStackDepth depth

-- Data translation --

serialize :: QueueElem -> Maybe (Key ColdStorage, ColdStorage)
serialize SyncFlush = Nothing
serialize (PreStorageEntry a mc vs) =
  let mci = MChainId mc
  in Just (ColdStorageKey a mci, ColdStorage a mci . toStrict . encode $ vs)

deserialize :: Maybe ColdStorage -> Either String [(Text, Value)]
deserialize Nothing = Left "storage not found"
deserialize (Just (ColdStorage _ _ bvs)) =
  case decodeOrFail (fromStrict bvs) of
    Left (_, _, err) -> Left $ "corrupted binary: " ++ err
    Right (_, _, vs) -> Right vs

-- API --

data Handle = Handle (TQueue QueueElem) SqlBackend
            | FakeHandle

instance NFData Handle where
  rnf = const () -- It doesn't really make sense to force a handle

fakeHandle :: Handle
fakeHandle = FakeHandle

-- | Migrates tables, and starts a background thread for writing cache entries to the database
initStorage :: (MonadUnliftIO m, MonadIO m, MonadBaseControl IO m, MonadResource m)
            => Int -> ReaderT SqlBackend m (Bool, Handle)
initStorage cacheSize = do
  void $ runMigrationSilent migrateStore
  queue <- atomically newTQueue
  ourBloom <- initFilter $ cacheSize `div` 2
  tid <- fork $ storageWorker queue
  void . register . liftIO . killThread $ tid
  sql <- ask
  return $! (ourBloom, Handle queue sql)

-- | Check postgres for an entry about this account's values
readStorage :: (MonadUnliftIO m, MonadIO m)
            => Handle -> Address -> Maybe ChainId -> m (Either String [(Text, Value)])
readStorage FakeHandle _ _ = return $! Left "fake handle"
readStorage (Handle _ sql) addr mci = do
  seen <- DBF.elem (addr, mci) <$> atomically readFilter
  if not seen
    then return . Left $ "unseen by bloom filter"
    else flip runReaderT sql
       . fmap deserialize
       . get
       . ColdStorageKey addr
       $ MChainId mci

-- | Schedule the write of an accounts values. syncStorage can be used to check for completion
--   of writes.
asyncWriteToStorage :: MonadIO m => Handle -> Address -> Maybe ChainId -> [(Text, Value)] -> m ()
asyncWriteToStorage FakeHandle _ _ _ = return ()
asyncWriteToStorage (Handle q _) a mc vs = atomically . writeTQueue q $ PreStorageEntry a mc vs

-- | Block until all pending writes have been sent.
syncStorage :: MonadIO m => Handle -> m ()
syncStorage FakeHandle = return ()
syncStorage (Handle q _) = do
  atomically . writeTQueue q $ SyncFlush
  void . atomically $ checkSTM =<< isEmptyTQueue q
