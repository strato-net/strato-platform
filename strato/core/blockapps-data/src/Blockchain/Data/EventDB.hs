{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Data.EventDB
    ( HasMemEventDB(..)
    , putEventDB
    , putEventDBs
    ) where

import           Database.Persist             hiding (get)
import qualified Database.Persist.Postgresql  as SQL

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB

class (Monad m) => HasMemEventDB m where
  enqueueEventEntries :: [EventDB] -> m ()
  flushEventEntries   :: m ()

  enqueueEventEntry :: EventDB -> m ()
  enqueueEventEntry = enqueueEventEntries . pure

putEventDB :: HasSQLDB m => EventDB -> m (Key EventDB)
putEventDB = fmap head . putEventDBs . pure

putEventDBs :: HasSQLDB m => [EventDB] -> m [Key EventDB]
putEventDBs = sqlQuery . SQL.insertMany
