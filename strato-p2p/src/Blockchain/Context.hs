{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE ScopedTypeVariables  #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS -fno-warn-orphans #-}
module Blockchain.Context
    ( Context(..)
    , ContextM
    , getDebugMsg
    , addDebugMsg
    , getBlockHeaders
    , putBlockHeaders
    , clearDebugMsg
    , stampActionTimestamp
    , getActionTimestamp
    , clearActionTimestamp
    ) where


import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Data.Time.Clock

import           Blockchain.Data.BlockHeader
import           Blockchain.DB.SQLDB

import qualified Blockchain.Strato.RedisBlockDB as RBDB
import qualified Database.Redis                 as Redis
import qualified Network.Kafka                  as K

data Context =
    Context {
        contextSQLDB        :: SQLDB,
        contextRedisBlockDB :: Redis.Connection,
        contextKafkaState   :: K.KafkaState,
        vmTrace             :: [String],
        blockHeaders        :: [BlockHeader],
        actionTimestamp     :: Maybe UTCTime
    }

type ContextM = StateT Context (ResourceT (LoggingT IO))

instance {-# OVERLAPPING #-} (MonadState Context m) => K.HasKafkaState m where
    getKafkaState = contextKafkaState <$> get
    putKafkaState s = do
      ctx <- get
      put $ ctx { contextKafkaState = s }

instance (Monad m, MonadState Context m) => RBDB.HasRedisBlockDB m where
    getRedisBlockDB = contextRedisBlockDB <$> get

instance (MonadResource m, MonadBaseControl IO m, MonadState Context m) => HasSQLDB m where
  getSQLDB = contextSQLDB <$> get

getDebugMsg :: MonadState Context m => m String
getDebugMsg = concat . reverse . vmTrace <$> get

getBlockHeaders :: MonadState Context m => m [BlockHeader]
getBlockHeaders = blockHeaders <$> get

putBlockHeaders :: MonadState Context m => [BlockHeader]->m ()
putBlockHeaders headers = do
    cxt <- get
    put cxt{blockHeaders=headers}

addDebugMsg :: MonadState Context m => String->m ()
addDebugMsg msg = do
    cxt <- get
    put cxt{vmTrace=msg:vmTrace cxt}

clearDebugMsg :: MonadState Context m => m ()
clearDebugMsg = do
    cxt <- get
    put cxt{vmTrace=[]}

stampActionTimestamp :: (MonadIO m, MonadState Context m) => m ()
stampActionTimestamp = do
    cxt <- get
    ts <- liftIO getCurrentTime
    put cxt{actionTimestamp=Just ts}

getActionTimestamp :: MonadState Context m => m (Maybe UTCTime)
getActionTimestamp = actionTimestamp <$> get

clearActionTimestamp :: MonadState Context m => m ()
clearActionTimestamp = do
    cxt <- get
    put cxt{actionTimestamp=Nothing}
