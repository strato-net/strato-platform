{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.EthConf
  (
    ethConf,
    connStr,
    readerConnStr,
    lookupRedisBlockDBConfig,
    edgeRedisConnectInfo,
    cirrusConnStr,
    runStreamMConfigured,
    runStreamMPooled,
    ethConfPath,
    module Blockchain.EthConf.Model,
  )
where

import Blockchain.EthConf.Model
import Control.Concurrent.MVar
import Control.Exception (catch, IOException)
import Control.Monad.Composable.Streaming
import Control.Monad.IO.Unlift (liftIO, withRunInIO)
import qualified Data.ByteString as B
import Data.Default
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe)
import qualified Data.Pool as Pool
import Data.String
import Data.Yaml
import qualified Database.Redis as Redis
import System.Environment (lookupEnv)
import System.IO.Unsafe

{- CONFIG: first change, make this local -}

-- | Where the node config is read from: @$STRATO_CONF@ if set, otherwise
-- @.ethereumH/ethconf.yaml@ relative to the working directory. The override
-- lets a process run outside a node directory (an API-tier container, a
-- tool pointed at another node's config) without the cwd convention.
ethConfPath :: IO FilePath
ethConfPath = fromMaybe ".ethereumH/ethconf.yaml" <$> lookupEnv "STRATO_CONF"

-- noinline cause its not like we had any guarantee of whether or not the file
-- got re-read anyway
{-# NOINLINE ethConf #-}
ethConf :: EthConf
ethConf = unsafePerformIO $
  (do contents <- B.readFile =<< ethConfPath
      return $ (either (error . show) id . decodeEither') contents)
  `catch` (\(_ :: IOException) -> return def)

{- CONFIG: clobber connection string -}

connStr :: B.ByteString
connStr = postgreSQLConnectionString . sqlConfig $ ethConf

cirrusConnStr :: B.ByteString
cirrusConnStr = postgreSQLConnectionString . cirrusConfig $ ethConf

-- | The eth database's read endpoint (a replica), or the writer when none is
-- configured.
readerConnStr :: B.ByteString
readerConnStr = maybe connStr postgreSQLConnectionString (sqlReaderConfig ethConf)

-- | Run against a fresh stream environment (and so a fresh broker
-- connection) each time. Right for a long-lived consumer loop that calls it
-- once; wrong for a request handler, which should use 'runStreamMPooled'.
runStreamMConfigured :: MonadUnliftIO m =>
                        ClientId -> StreamM m a -> m a
runStreamMConfigured name =
  let k = streamingConfig ethConf
  in runStreamM name (fromString $ streamingHost k, fromIntegral $ streamingPort k)

-- | Run against a stream environment borrowed from a process-wide pool, one
-- pool per client id. A milena environment carries its own broker connection
-- cache, so a borrowed environment reuses the socket it opened last time
-- instead of opening (and leaking until finalized) a new one per request,
-- which is what 'runStreamMConfigured' does from a handler. Environments are
-- borrowed exclusively: milena's state is not safe to share between threads.
runStreamMPooled :: MonadUnliftIO m => ClientId -> StreamM m a -> m a
runStreamMPooled name f = do
  pool <- liftIO $ streamEnvPool name
  withRunInIO $ \run -> Pool.withResource pool (run . flip runStreamMUsingEnv f)

streamEnvPoolSize :: Int
streamEnvPoolSize = 8

-- | Seconds an idle environment (and its sockets) is kept before being dropped.
streamEnvIdleSeconds :: Double
streamEnvIdleSeconds = 60

{-# NOINLINE streamEnvPools #-}
streamEnvPools :: MVar (Map.Map ClientId (Pool.Pool StreamEnv))
streamEnvPools = unsafePerformIO $ newMVar Map.empty

streamEnvPool :: ClientId -> IO (Pool.Pool StreamEnv)
streamEnvPool name = modifyMVar streamEnvPools $ \pools ->
  case Map.lookup name pools of
    Just pool -> return (pools, pool)
    Nothing -> do
      let k = streamingConfig ethConf
          addr = (fromString $ streamingHost k, fromIntegral $ streamingPort k)
      pool <- Pool.newPool $ Pool.defaultPoolConfig
        (createStreamEnv name addr)
        (const $ return ())
        streamEnvIdleSeconds
        streamEnvPoolSize
      return (Map.insert name pool pools, pool)

lookupRedisBlockDBConfig :: Redis.ConnectInfo
lookupRedisBlockDBConfig = redisConnection $ redisBlockDBConfig ethConf

-- | The edge tier's Redis (nonces, CSRF tokens, sessions).
edgeRedisConnectInfo :: Redis.ConnectInfo
edgeRedisConnectInfo = redisConnection $ edgeRedisConfig ethConf
