{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.BlocSQL where

import           Control.Monad.Reader
import           Control.Monad.Trans.Control
import           Data.Pool
import           Data.Word
import           Database.PostgreSQL.Simple

import           Control.Monad.FT

type BlocSQLM = ReaderT BlocSQLEnv

type HasBlocSQL m = (Gettable BlocSQLEnv m, MonadBaseControl IO m)

data BlocSQLEnv =
  BlocSQLEnv {
    pool :: Pool Connection
  }

createBlocSQLEnv :: MonadIO m =>
                    String -> Word16 -> String -> String -> m BlocSQLEnv
createBlocSQLEnv host port user password = do 
  let dbConnectInfo =
        ConnectInfo {
            connectHost = host
          , connectPort = port
          , connectUser = user
          , connectPassword = password
          , connectDatabase = "bloc22"
          }

  fmap BlocSQLEnv $ liftIO $ createPool (connect dbConnectInfo) close 5 3 5

runBlocSQLMUsingEnv :: BlocSQLEnv -> BlocSQLM m a -> m a
runBlocSQLMUsingEnv env f = runReaderT f env

runBlocSQLM :: MonadIO m => String -> Word16 -> String -> String -> BlocSQLM m a -> m a
runBlocSQLM host port user password f = 
  flip runBlocSQLMUsingEnv f =<< createBlocSQLEnv host port user password
