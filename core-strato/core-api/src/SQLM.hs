{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

{-# OPTIONS -fno-warn-orphans #-}

module SQLM where

import qualified Control.Monad.Change.Modify as Mod
import           Control.Monad.Trans.Reader
import           Database.Persist.Sql

type SQLM = ReaderT ConnectionPool IO

instance Mod.Accessible ConnectionPool SQLM where
  access _ = ask

runSQLM :: ConnectionPool -> SQLM a -> IO a
runSQLM pool f = do
  runReaderT f pool

