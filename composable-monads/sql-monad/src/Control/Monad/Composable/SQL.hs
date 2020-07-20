
{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.SQL where

import           Control.Monad.Reader
import           Data.Pool (Pool)

--import           Database.Persist.Sql

import           Database.PostgreSQL.Simple         (Connection)
--                                                     withTransaction)

newtype SQLData = SQLData Int deriving (Show)

type SQLM = ReaderT SQLData

class HasSQL m where
  getSQLPool :: m (Pool Connection)

runSQLM :: SQLM m a -> m a
runSQLM f = do
  let x = 1
  runReaderT f $ SQLData x

