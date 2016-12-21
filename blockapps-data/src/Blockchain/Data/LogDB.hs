{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Data.LogDB (
     putLogDB
    ) where

import Database.Persist hiding (get)
import qualified Database.Persist.Postgresql as SQL

import Control.Monad.State
import Control.Monad.Trans.Resource

import Blockchain.Data.DataDefs
import Blockchain.DB.SQLDB

putLogDB::(HasSQLDB m, MonadIO m, MonadBaseControl IO m)=>
          LogDB->m (Key LogDB)
putLogDB tr = do
  pool <- getSQLDB
  runResourceT $ SQL.runSqlPool (SQL.insert tr) pool
