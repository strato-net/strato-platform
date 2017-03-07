{-# LANGUAGE
    OverloadedStrings
#-}

module Main where

import Control.Monad
import Database.PostgreSQL.Simple
import Network.HTTP.Client
import Network.Wai.Handler.Warp

import BlockApps.Bloc.API
import BlockApps.Bloc.Monad
import BlockApps.Strato.Client
import BlockApps.Bloc.Database.Create

main :: IO ()
main = do
  dbCreateConn <- connectPostgreSQL
    "host=localhost port=5432 user=postgres dbname=postgres"
  dbExists <- null <$>
    (query_ dbCreateConn dbExistsQuery :: IO [Only Int])
  unless dbExists $ void
    (query_ dbCreateConn createDatabase :: IO [Only Int])
  close dbCreateConn
  conn <- connectPostgreSQL
    "host=localhost port=5432 user=postgres dbname=bloc"
  -- TODO: database connection resource management
  void (query_ conn createTables :: IO [Only Int])
  mgr <- newManager defaultManagerSettings
  let blocEnv = BlocEnv stratoDev mgr conn
  run 8000 (appBloc blocEnv)

dbExistsQuery :: Query
dbExistsQuery = "SELECT 1 FROM pg_database WHERE datname='bloc';"
