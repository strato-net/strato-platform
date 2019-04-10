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
import           Control.Monad.Trans.Resource

import           Blockchain.Output            (runNoLoggingT)
import qualified Database.Persist.Postgresql  as SQL

import           Blockchain.DB.SQLDB
import           Blockchain.EthConf

data DebugMode = Log | Fail deriving (Eq)

newtype DBs =
  DBs {
    sqlDB'::SQLDB
    }

openDBs::(MonadResource m, MonadUnliftIO m) => m DBs
openDBs = fmap DBs . runNoLoggingT . SQL.createPostgresqlPool connStr $ 20
