{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module Blockchain.DBM (
  DBs(..),
  openDBs
  ) where


import Control.Monad.Trans.Resource

import           Control.Monad.Logger    (runNoLoggingT)
import qualified Database.Persist.Postgresql as SQL

import Blockchain.DB.SQLDB
import Blockchain.EthConf

--import Debug.Trace

data DBs =
  DBs {
    sqlDB'::SQLDB
    }

{-
connStr::SQL.ConnectionString
connStr = "host=localhost dbname=eth user=postgres password=api port=5432"
-}

{-
connStr'::SQL.ConnectionString
connStr' = BC.pack $ "host=localhost dbname=eth user=postgres password=api port=" ++ show (port $ sqlConfig ethConf)
-}

openDBs::(MonadResource m, MonadBaseControl IO m)=>m DBs
openDBs = do
  sqldb <-   runNoLoggingT  $ SQL.createPostgresqlPool connStr' 20
  return $ DBs sqldb
