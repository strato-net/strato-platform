{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Data.TransactionResult
    ( HasMemTXResultDB(..)
    , putTransactionResult
    , putTransactionResults
    ) where

import           Database.Persist             hiding (get)
import qualified Database.Persist.Postgresql  as SQL

import           Control.Monad.State
import           Control.Monad.Trans.Resource

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB

class (Monad m) => HasMemTXResultDB m where
  enqueueTransactionResults :: [TransactionResult] -> m ()
  flushTransactionResults   :: m ()

  enqueueTransactionResult :: TransactionResult -> m ()
  enqueueTransactionResult = enqueueTransactionResults . pure


putTransactionResult :: (HasSQLDB m, MonadIO m, MonadBaseControl IO m)
                     => TransactionResult
                     -> m (Key TransactionResult)
putTransactionResult = fmap head . putTransactionResults . pure

putTransactionResults :: (HasSQLDB m, MonadIO m, MonadBaseControl IO m)
                      => [TransactionResult]
                      -> m [Key TransactionResult]
putTransactionResults trs = getSQLDB >>= runResourceT . (SQL.runSqlPool $ SQL.insertMany trs)
