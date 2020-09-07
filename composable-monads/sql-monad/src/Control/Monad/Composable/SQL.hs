{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

module           Control.Monad.Composable.SQL where


import           Control.Monad.Reader

import           Blockchain.DB.SQLDB



newtype SQLData = SQLData Int deriving (Show)

type SQLM = ReaderT SQLData

type HasSQL m = HasSQLDB m

runSQLM :: SQLM m a -> m a
runSQLM f = do
  let x = 1
  runReaderT f $ SQLData x

