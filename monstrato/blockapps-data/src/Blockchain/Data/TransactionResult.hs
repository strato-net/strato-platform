{-# LANGUAGE FlexibleContexts #-}

module Blockchain.Data.TransactionResult
    ( HasMemTXResultDB(..)
    , putInsertTransactionResult
    , putInsertTransactionResults
    , putUpdateTransactionResult
    , putUpdateTransactionResults
    ) where

import qualified Database.Esqueleto           as E
import           Database.Persist             hiding (get)
import qualified Database.Persist.Postgresql  as SQL

import           Control.Monad.State
import           Control.Monad.Trans.Resource

import           Blockchain.Data.DataDefs
import           Blockchain.Data.MiningStatus
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA

class (Monad m) => HasMemTXResultDB m where
  enqueueInsertTransactionResults :: [TransactionResult] -> m ()
  enqueueUpdateTransactionResults :: [(SHA,SHA,SHA,MiningStatus)] -> m ()
  flushInsertTransactionResults   :: m ()
  flushUpdateTransactionResults   :: m ()
  flushTransactionResults :: m ()

  enqueueInsertTransactionResult :: TransactionResult -> m ()
  enqueueInsertTransactionResult = enqueueInsertTransactionResults . pure

  enqueueUpdateTransactionResult :: (SHA,SHA,SHA,MiningStatus) -> m ()
  enqueueUpdateTransactionResult = enqueueUpdateTransactionResults . pure

putInsertTransactionResult :: (HasSQLDB m, MonadIO m, MonadBaseControl IO m)
                           => TransactionResult
                           -> m (Key TransactionResult)
putInsertTransactionResult = fmap head . putInsertTransactionResults . pure

putInsertTransactionResults :: (HasSQLDB m, MonadIO m, MonadBaseControl IO m)
                            => [TransactionResult]
                            -> m [Key TransactionResult]
putInsertTransactionResults trs = getSQLDB >>= runResourceT . (SQL.runSqlPool $ SQL.insertMany trs)

putUpdateTransactionResult :: (HasSQLDB m, MonadIO m, MonadBaseControl IO m)
                           => (SHA,SHA,SHA,MiningStatus)
                           -> m ()
putUpdateTransactionResult (txhash,old,new,status) = do
  sqldb <- getSQLDB
  runResourceT $ flip SQL.runSqlPool sqldb $ do
    E.update $ \tr -> do
      E.set tr [ TransactionResultBlockHash E.=. E.val new , TransactionResultMiningStatus E.=. E.val status ]
      E.where_ (tr E.^. TransactionResultTransactionHash E.==. E.val txhash E.&&. tr E.^. TransactionResultBlockHash E.==. E.val old E.&&. tr E.^. TransactionResultMiningStatus E.==. E.val Unmined)

putUpdateTransactionResults :: (HasSQLDB m, MonadIO m, MonadBaseControl IO m)
                            => [(SHA,SHA,SHA,MiningStatus)]
                            -> m ()
putUpdateTransactionResults = mapM_ putUpdateTransactionResult
