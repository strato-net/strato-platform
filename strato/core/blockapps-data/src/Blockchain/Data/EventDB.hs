{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Data.EventDB
  ( HasMemEventDB (..),
    putEventDB,
    putEventDBs,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import qualified Database.Persist.Postgresql as SQL

class (Monad m) => HasMemEventDB m where
  enqueueEventEntries :: [EventDB] -> m ()
  flushEventEntries :: m ()

  enqueueEventEntry :: EventDB -> m ()
  enqueueEventEntry = enqueueEventEntries . pure

putEventDB :: HasSQLDB m => EventDB -> m (Key EventDB)
putEventDB = fmap head . putEventDBs . pure

putEventDBs :: HasSQLDB m => [EventDB] -> m [Key EventDB]
putEventDBs = sqlQuery . SQL.insertMany
