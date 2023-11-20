{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

module Control.Monad.Composable.Redis where

import Control.Monad.Composable.Base
import Control.Monad.Reader
import Database.Redis (Redis)
import qualified Database.Redis as Redis

type RedisM = ReaderT RedisEnv

type HasRedis m = AccessibleEnv RedisEnv m

data RedisEnv = RedisEnv
  { redisConnection :: Redis.Connection
  }

createRedisEnv :: MonadIO m =>
                  Redis.ConnectInfo -> m RedisEnv
createRedisEnv connectInfo = do
  redis <- liftIO $ Redis.checkedConnect connectInfo
  return $ RedisEnv redis

runRedisMUsingEnv :: RedisEnv -> RedisM m a -> m a
runRedisMUsingEnv env f =
  runReaderT f env

runRedisM :: MonadIO m =>
             Redis.ConnectInfo -> RedisM m a -> m a
runRedisM connectInfo f = flip runRedisMUsingEnv f =<< createRedisEnv connectInfo

execRedis :: (HasRedis m, MonadIO m) =>
             Redis a -> m a
execRedis f = do
  env <- accessEnv
  liftIO $ Redis.runRedis (redisConnection env) f
