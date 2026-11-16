{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Strato.RedisBlockDB
  ( RedisConnection (..),
    findNamespace,
    runStratoRedisIO,
    withRedisBlockDB
  )
where

import Blockchain.EthConf (lookupRedisBlockDBConfig)
import Blockchain.Strato.RedisBlockDB.Models as Models
import Control.Monad.Change.Modify hiding (get)
import Control.Monad.Trans
import qualified Data.ByteString.Char8 as S8
import Database.Redis
import System.IO.Unsafe (unsafePerformIO)

newtype RedisConnection = RedisConnection {unRedisConnection :: Connection}

withRedisBlockDB ::
  (MonadIO m, Accessible RedisConnection m) =>
  Redis a ->
  m a
withRedisBlockDB m = do
  db <- unRedisConnection <$> access (Proxy @RedisConnection)
  liftIO $ runRedis db m

findNamespace :: S8.ByteString -> BlockDBNamespace
findNamespace key = case S8.takeWhile (/= ':') key of
  "h" -> Headers
  "t" -> Transactions
  "n" -> Numbers
  "u" -> Uncles
  "p" -> Parent
  "c" -> Children
  "q" -> Canonical
  "validators" -> Validators
  wut -> error $ "unknown namespace: " ++ show wut

-- | The process-wide Redis connection pool. hedis' 'Connection' is itself a
-- pool (50 sockets, 30s idle) whose sockets are opened lazily on first use,
-- so building it once at startup costs nothing until Redis is actually
-- reached, and a Redis that is still loading fails the first command (which
-- callers already retry) instead of failing here. Previously every
-- 'runStratoRedisIO' called 'checkedConnect', opening and pinging a new
-- socket per call: invisible over loopback, but strato-api's /metadata and
-- every bloc transaction do it, and the API tier is moving off the core host.
{-# NOINLINE stratoRedisConnection #-}
stratoRedisConnection :: Connection
stratoRedisConnection = unsafePerformIO $ connect lookupRedisBlockDBConfig

-- TODO: Use an effect system (IO eww... 😒)
runStratoRedisIO :: MonadIO m => Redis a -> m a
runStratoRedisIO r = liftIO $ runRedis stratoRedisConnection r

