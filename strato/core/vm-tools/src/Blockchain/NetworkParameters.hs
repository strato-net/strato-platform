{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.NetworkParameters
  ( getTxSizeLimit,
    getTxSizeLimitFromStorage,
    getTxSizeLimitCached,
    updateCachedTxSizeLimit,
    initializeTxSizeLimitCache,
    transactionParametersAddress,
    defaultTxSizeLimit
  )
where

import BlockApps.Logging
import Blockchain.DB.SolidStorageDB
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Options (flags_txSizeLimit)
import Blockchain.VMContext (ContextState, cachedTxSizeLimit)
import Control.Lens
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.IO.Class
import qualified Data.Text as T
import SolidVM.Model.Storable
import UnliftIO (catch, SomeException, MonadUnliftIO)

-- Address of the TransactionParameters contract (from genesis)
transactionParametersAddress :: Address
transactionParametersAddress = 0x1020

-- Default transaction size limit (2 MiB) from the flag
defaultTxSizeLimit :: Int
defaultTxSizeLimit = flags_txSizeLimit

-- Read the txSizeLimit from the TransactionParameters contract storage
-- The txSizeLimit is stored at storage path ".txSizeLimit" 
getTxSizeLimitFromStorage :: (HasSolidStorageDB m, MonadLogger m, MonadUnliftIO m) => m Int
getTxSizeLimitFromStorage = do
  case parsePath ".txSizeLimit" of
    Left err -> do
      $logWarnS "getTxSizeLimitFromStorage" . T.pack
        $ "Failed to parse storage path: " ++ err ++ ", using default: " ++ show defaultTxSizeLimit
      return defaultTxSizeLimit
    Right storagePath -> do
      value <- catch
        (getSolidStorageKeyVal' transactionParametersAddress storagePath)
        (\(_ :: SomeException) -> do
          $logWarnS "getTxSizeLimitFromStorage" . T.pack
            $ "Failed to read transaction size limit from storage, using default: " ++ show defaultTxSizeLimit
          return BDefault
        )
      case value of
        BInteger limit -> do
          let limitInt = fromInteger limit
          $logDebugS "getTxSizeLimitFromStorage" . T.pack
            $ "Read transaction size limit from storage: " ++ show limitInt
          return limitInt
        _ -> do
          $logWarnS "getTxSizeLimitFromStorage" . T.pack
            $ "Transaction size limit not found in storage, using default: " ++ show defaultTxSizeLimit
          return defaultTxSizeLimit

-- Get the transaction size limit using in-memory cache
-- Reads from cache if available, otherwise reads from storage and updates cache
getTxSizeLimitCached :: 
  ( HasSolidStorageDB m
  , MonadLogger m
  , MonadUnliftIO m
  , Mod.Modifiable ContextState m
  ) => m Int
getTxSizeLimitCached = do
  cached <- Mod.get (Mod.Proxy @ContextState)
  let maybeLimit = view cachedTxSizeLimit cached
  case maybeLimit of
    Just limit -> do
      $logDebugS "getTxSizeLimitCached" . T.pack
        $ "Using cached transaction size limit: " ++ show limit
      return limit
    Nothing -> do
      $logDebugS "getTxSizeLimitCached" "Cache miss, reading from storage"
      limit <- getTxSizeLimitFromStorage
      Mod.modify_ (Mod.Proxy @ContextState) $ pure . (cachedTxSizeLimit .~ Just limit)
      $logInfoS "getTxSizeLimitCached" . T.pack
        $ "Cached transaction size limit: " ++ show limit
      return limit

-- Main function to get transaction size limit (uses cache)
getTxSizeLimit :: 
  ( HasSolidStorageDB m
  , MonadLogger m
  , MonadUnliftIO m
  , Mod.Modifiable ContextState m
  ) => m Int
getTxSizeLimit = getTxSizeLimitCached

-- Update the cached transaction size limit (called when event is received)
updateCachedTxSizeLimit :: 
  ( MonadIO m
  , MonadLogger m
  , Mod.Modifiable ContextState m
  ) => Int -> m ()
updateCachedTxSizeLimit newLimit = do
  $logInfoS "updateCachedTxSizeLimit" . T.pack
    $ "Updating cached transaction size limit to: " ++ show newLimit
  Mod.modify_ (Mod.Proxy @ContextState) $ pure . (cachedTxSizeLimit .~ Just newLimit)

-- Initialize the cache on startup by reading from storage
initializeTxSizeLimitCache :: 
  ( HasSolidStorageDB m
  , MonadLogger m
  , MonadUnliftIO m
  , Mod.Modifiable ContextState m
  ) => m ()
initializeTxSizeLimitCache = do
  $logInfoS "initializeTxSizeLimitCache" "Initializing transaction size limit cache from storage"
  limit <- getTxSizeLimitFromStorage
  Mod.modify_ (Mod.Proxy @ContextState) $ pure . (cachedTxSizeLimit .~ Just limit)
  $logInfoS "initializeTxSizeLimitCache" . T.pack
    $ "Initialized cache with limit: " ++ show limit

