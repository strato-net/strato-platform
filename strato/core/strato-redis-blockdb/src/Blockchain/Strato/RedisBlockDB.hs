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
  "x509" -> X509Certificates
  "potu" -> ParsedSetWhitePage
  "psx509" -> ParsedSetToX509
  wut -> error $ "unknown namespace: " ++ show wut

-- TODO: Use an effect system (IO eww... 😒)
runStratoRedisIO :: MonadIO m => Redis a -> m a
runStratoRedisIO r = liftIO $ do
  conn <- checkedConnect lookupRedisBlockDBConfig
  runRedis conn r

