{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Data.LogDB
  ( HasMemLogDB (..),
    putLogDB,
    putLogDBs,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import qualified Database.Persist.Postgresql as SQL

class (Monad m) => HasMemLogDB m where
  enqueueLogEntries :: [LogDB] -> m ()
  flushLogEntries :: m ()

  enqueueLogEntry :: LogDB -> m ()
  enqueueLogEntry = enqueueLogEntries . pure

putLogDB :: HasSQLDB m => LogDB -> m (Key LogDB)
putLogDB = fmap head . putLogDBs . pure

putLogDBs :: HasSQLDB m => [LogDB] -> m [Key LogDB]
putLogDBs = sqlQuery . SQL.insertMany
