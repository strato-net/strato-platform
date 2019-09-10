{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Data.EventDB
    ( HasMemEventDB(..)
    , putEventDB
    , putEventDBs
    ) where

import           Control.Monad.Change.Modify  (Accessible(..), Proxy(..))
import           Control.Monad.Trans.Resource
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
putEventDBs ls = access (Proxy @SQLDB) >>= runResourceT . SQL.runSqlPool (SQL.insertMany ls)
