
{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.BlocSQL where

import           Control.Monad.Reader
import           Data.Pool (Pool)
import           Database.PostgreSQL.Simple         (Connection)


newtype BlocSQLData = BlocSQLData Int deriving (Show)

type BlocSQLM = ReaderT BlocSQLData

class HasBlocSQL m where
  getBlocSQLPool :: m (Pool Connection)

runSQLM :: BlocSQLM m a -> m a
runSQLM f = do
  let x = 1
  runReaderT f $ BlocSQLData x

