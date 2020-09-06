
{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.SQL where

import           Control.Monad.Reader

import qualified Database.Persist.Sql as SQL

newtype SQLData = SQLData Int deriving (Show)

type SQLM = ReaderT SQLData

class HasSQL m where
  getSQLPool :: m SQL.ConnectionPool

runSQLM :: SQLM m a -> m a
runSQLM f = do
  let x = 1
  runReaderT f $ SQLData x

