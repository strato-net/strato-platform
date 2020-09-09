{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.BlocSQL where

import           Control.Monad.Reader
import           Data.Pool (Pool)
import           Database.PostgreSQL.Simple         (Connection)

import           Control.Monad.Change.Modify

newtype BlocSQLData = BlocSQLData (Pool Connection) deriving (Show)

type BlocSQLM = ReaderT BlocSQLData

type HasBlocSQL m = Accessible BlocSQLData m

runBlocSQLM :: BlocSQLM m a -> m a
runBlocSQLM f = do
  let x = undefined
  runReaderT f $ BlocSQLData x

