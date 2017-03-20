{-# LANGUAGE TypeSynonymInstances, FlexibleContexts, FlexibleInstances, OverloadedStrings #-}
module Executable.AditM where

import Control.Monad.Logger
import Control.Monad.State
import Control.Monad.Trans.Resource

import qualified Database.Persist.Postgresql as SQL

import Blockchain.EthConf (connStr, mkConfiguredKafkaState)
import Blockchain.DB.SQLDB
import Network.Kafka

data AditState = AditState {
    aditSqlDatabase :: SQLDB,
    aditKafkaState  :: KafkaState
}

type AditM = StateT AditState (ResourceT (LoggingT IO))

instance HasKafkaState AditM where
    getKafkaState = aditKafkaState <$> get
    putKafkaState ns = do
        ctx <- get
        put $ ctx { aditKafkaState = ns }

instance HasSQLDB AditM where
     getSQLDB = aditSqlDatabase <$> get

runAditT :: Int -> AditM a -> LoggingT IO a
runAditT pgPoolSize m = do
    let initKafkaState = mkConfiguredKafkaState "strato-adit"
    sqldb <- runNoLoggingT  $ SQL.createPostgresqlPool connStr pgPoolSize
    runResourceT $ evalStateT m (AditState sqldb initKafkaState)
