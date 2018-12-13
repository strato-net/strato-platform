{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Data.LogDB
    ( HasMemLogDB(..)
    , putLogDB
    , putLogDBs
    ) where

import           Control.Monad.Trans.Resource
import           Database.Persist             hiding (get)
import qualified Database.Persist.Postgresql  as SQL

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB

class (Monad m) => HasMemLogDB m where
  enqueueLogEntries :: [LogDB] -> m ()
  flushLogEntries   :: m ()

  enqueueLogEntry :: LogDB -> m ()
  enqueueLogEntry = enqueueLogEntries . pure

putLogDB :: HasSQLDB m => LogDB -> m (Key LogDB)
putLogDB = fmap head . putLogDBs . pure

putLogDBs :: HasSQLDB m => [LogDB] -> m [Key LogDB]
putLogDBs ls = getSQLDB >>= runResourceT . SQL.runSqlPool (SQL.insertMany ls)
