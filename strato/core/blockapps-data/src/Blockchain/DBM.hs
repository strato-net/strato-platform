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

-- | The peer store of strato-p2p and ethereum-discover (p_peer, sync_task):
-- this cell's own database when 'peerDbConfig' is set, created on first use.
openDBs :: MonadUnliftIO m => m DBs
openDBs = do
  liftIO $ mapM_ ensureDatabaseExists (peerDbConfig ethConf)
  fmap DBs . runNoLoggingT $ createPostgresqlPool peerConnStr 20
