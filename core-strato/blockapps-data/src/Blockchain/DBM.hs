{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE TypeFamilies               #-}

module Blockchain.DBM (
  DBs(..),
  DebugMode(..),
  openDBs
  ) where

import           Control.Monad.IO.Unlift

import           Blockchain.Output            (runNoLoggingT)

import           Blockchain.DB.SQLDB
import           Blockchain.EthConf

data DebugMode = Log | Fail deriving (Eq)

newtype DBs =
  DBs {
    sqlDB'::SQLDB
    }

openDBs:: MonadUnliftIO m => m DBs
openDBs = fmap DBs . runNoLoggingT $ createPostgresqlPool connStr 20
