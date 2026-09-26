{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Control.Monad.Composable.Redis where

import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Database.Redis (Redis)
import qualified Database.Redis as Redis

type RedisM es = Eff (RedisEnv ': es)

type HasRedis m = AccessibleEnv RedisEnv m

data RedisEnv = RedisEnv
  { redisConnection :: Redis.Connection
  }

createRedisEnv :: MonadIO m =>
                  Redis.ConnectInfo -> m RedisEnv
createRedisEnv connectInfo = do
  redis <- liftIO $ Redis.checkedConnect connectInfo
  return $ RedisEnv redis

runRedisMUsingEnv :: RedisEnv -> RedisM es a -> Eff es a
runRedisMUsingEnv = provide

runRedisM :: Redis.ConnectInfo -> RedisM es a -> Eff es a
runRedisM connectInfo f = flip runRedisMUsingEnv f =<< createRedisEnv connectInfo

execRedis :: (HasRedis m, MonadIO m) =>
             Redis a -> m a
execRedis f = do
  env <- accessEnv
  liftIO $ Redis.runRedis (redisConnection env) f
