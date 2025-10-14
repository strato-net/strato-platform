{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}


module Core.ApiContext
  ( ApiContext(..)
  , TxSizeLimitCache(..)
  , initializeApiContext
  , getTxSizeLimitCached
  , transactionParametersAddress
  ) where

import BlockApps.Logging
import Blockchain.Data.DataDefs (EntityField(NetworkParameterParameterName, NetworkParameterBlockNumber, NetworkParameterParameterValue))
import Blockchain.DB.SQLDB
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Options (flags_txSizeLimit)
import Control.Exception (SomeException)
import Control.Monad.Catch (catch, MonadCatch)
import Control.Monad.IO.Class
import Data.Time.Clock (UTCTime, getCurrentTime, addUTCTime, NominalDiffTime)
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import UnliftIO (IORef, newIORef, readIORef, atomicWriteIORef)

-- | Cache entry with TTL expiration
-- Equivalent to: { limit: number, ttl: timestamp }
data TxSizeLimitCache = TxSizeLimitCache
  { cacheLimit :: !Int
  , cacheTTL :: !UTCTime  -- Expiration timestamp
  } deriving (Show)

-- | API Context holding cached network parameters with TTL
data ApiContext = ApiContext
  { _txSizeLimitCache :: !(IORef TxSizeLimitCache)
  }

-- Address of the TransactionParameters contract (from genesis)
transactionParametersAddress :: Address
transactionParametersAddress = 0x1020

-- | TTL duration for the cache (1 hour = 3600 seconds)
-- Equivalent to JavaScript: 1000 * 60 * 60
txSizeLimitTTL :: NominalDiffTime
txSizeLimitTTL = 3600  -- 1 hour in seconds

-- | Initialize API context by reading from Postgres and setting initial TTL
-- Equivalent to first call of getTxSizeLimit() in JavaScript
initializeApiContext :: (HasSQLDB m, MonadLogger m, MonadCatch m) => m ApiContext
initializeApiContext = do
  initialLimit <- getTxSizeLimitFromPostgres
  now <- liftIO getCurrentTime
  let expirationTime = addUTCTime txSizeLimitTTL now
  limitRef <- liftIO $ newIORef $ TxSizeLimitCache initialLimit expirationTime
  $logInfoS "initializeApiContext" $ T.pack $
    "Initialized API context with tx size limit: " ++ show initialLimit ++ " (TTL: 1 hour)"
  return $ ApiContext limitRef

-- | Get transaction size limit from Postgres (used for initialization and fallback)
getTxSizeLimitFromPostgres :: (HasSQLDB m, MonadLogger m, MonadCatch m) => m Int
getTxSizeLimitFromPostgres = do
  result <- catch
    (sqlQuery $ do
      rows <- E.select $
        E.from $ \networkParam -> do
          E.where_ (networkParam E.^. NetworkParameterParameterName E.==. E.val "txSizeLimit")
          E.orderBy [E.desc (networkParam E.^. NetworkParameterBlockNumber)]
          E.limit 1
          return (networkParam E.^. NetworkParameterParameterValue)
      return $ case rows of
        (E.Value val : _) -> Just val
        _ -> Nothing
    )
    (\(e :: SomeException) -> do
      $logWarnS "getTxSizeLimitFromPostgres" $ T.pack $
        "Failed to query Postgres: " ++ show e
      return Nothing
    )
  
  case result of
    Just valueStr -> do
      case reads (T.unpack valueStr) :: [(Int, String)] of
        [(val, _)] -> do
          $logDebugS "getTxSizeLimitFromPostgres" $ T.pack $
            "Read transaction size limit from Postgres: " ++ show val
          return val
        _ -> do
          $logWarnS "getTxSizeLimitFromPostgres" $ T.pack $
            "Failed to parse transaction size limit, using default: " ++ show flags_txSizeLimit
          return flags_txSizeLimit
    Nothing -> do
      $logDebugS "getTxSizeLimitFromPostgres" $ T.pack $
        "Transaction size limit not found in Postgres, using default: " ++ show flags_txSizeLimit
      return flags_txSizeLimit

-- | Get transaction size limit with TTL-based cache refresh
-- Direct Haskell equivalent of the JavaScript getTxSizeLimit() function
--
-- JavaScript version:
--   async function getTxSizeLimit(cachedLimit) {
--     if (cachedLimit && cachedLimit.ttl > Date.now()) {
--         return cachedLimit.limit;
--     } else {
--       newTxSizeLimit = await getTxSizeLimitFromPostgres();
--       cachedLimit = { limit: newTxSizeLimit, ttl: Date.now() + 1000 * 60 * 60 };
--       return newTxSizeLimit;
--     }
--   }
getTxSizeLimitCached :: 
  ( MonadLogger m
  , HasSQLDB m
  , MonadCatch m
  ) => ApiContext -> m Int
getTxSizeLimitCached ctx = do
  now <- liftIO getCurrentTime
  TxSizeLimitCache{..} <- liftIO $ readIORef (_txSizeLimitCache ctx)
  
  -- Check if cache is still valid (ttl > now)
  if cacheTTL > now
    then do
      -- Cache is fresh, return cached limit
      $logDebugS "getTxSizeLimitCached" $ T.pack $
        "Using cached tx size limit: " ++ show cacheLimit
      return cacheLimit
    else do
      -- Cache expired, refresh from Postgres
      $logInfoS "getTxSizeLimitCached" "Cache expired, refreshing from Postgres"
      newLimit <- getTxSizeLimitFromPostgres
      let newExpirationTime = addUTCTime txSizeLimitTTL now
      liftIO $ atomicWriteIORef (_txSizeLimitCache ctx) $ 
        TxSizeLimitCache newLimit newExpirationTime
      $logInfoS "getTxSizeLimitCached" $ T.pack $
        "Refreshed tx size limit: " ++ show newLimit ++ " (TTL: 1 hour)"
      return newLimit

