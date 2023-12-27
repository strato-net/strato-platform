{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeFamilies #-}

module Blockchain.DBM
  ( DBs (..),
    DebugMode (..),
    openDBs,
  )
where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Control.Monad.IO.Unlift

data DebugMode = Log | Fail deriving (Eq)

newtype DBs = DBs
  { sqlDB' :: SQLDB
  }

openDBs :: MonadUnliftIO m => m DBs
openDBs = fmap DBs . runNoLoggingT $ createPostgresqlPool connStr 20
