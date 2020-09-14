{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.BlocSQL where

import           Control.Monad.Reader
import           Control.Monad.Trans.Control
import           Data.Pool
import           Data.Word
import           Database.PostgreSQL.Simple

import           Control.Monad.Change.Modify

newtype BlocSQLData = BlocSQLData (Pool Connection) deriving (Show)

type BlocSQLM = ReaderT BlocSQLData

type HasBlocSQL m = (Accessible BlocSQLData m, MonadBaseControl IO m)

runBlocSQLM :: MonadIO m => String -> Word16 -> String -> String -> BlocSQLM m a -> m a
runBlocSQLM host port user password f = do

  let dbConnectInfo =
        ConnectInfo {
            connectHost = host
          , connectPort = port
          , connectUser = user
          , connectPassword = password
          , connectDatabase = "bloc22"
          }
                      
--  dbCreateConn <- connect dbConnectInfo

--  doesNotExist22 <- null <$>
--    (query_ dbCreateConn dbExistsQuery22 :: IO [Only Int])
--  when doesNotExist22 $ void $ execute_ dbCreateConn Bloc22.createDatabase

--  close dbCreateConn

  pool <- liftIO $ createPool (connect dbConnectInfo) close 5 3 5
  runReaderT f $ BlocSQLData pool

