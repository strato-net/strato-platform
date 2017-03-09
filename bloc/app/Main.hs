{-# LANGUAGE
    OverloadedStrings
  , TemplateHaskell
#-}

module Main where

import Data.String
import HFlags
import Control.Monad
import Database.PostgreSQL.Simple
import Network.HTTP.Client
import Network.Wai.Handler.Warp

import BlockApps.Bloc.API
import BlockApps.Bloc.Database.Create
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Options
import BlockApps.Strato.Client

main :: IO ()
main = do
  _ <- $initHFlags "Setup EthereumH DBs"
  dbCreateConn <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=5432 user=" ++ flags_pguser ++ " dbname=postgres password=" ++ flags_password
  dbExists <- null <$>
    (query_ dbCreateConn dbExistsQuery :: IO [Only Int])
  unless dbExists $ void
    (query_ dbCreateConn createDatabase :: IO [Only Int])
  close dbCreateConn
  conn <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=5432 user=" ++ flags_pguser ++ " dbname=bloc password=" ++ flags_password
  -- TODO: database connection resource management
  void (query_ conn createTables :: IO [Only Int])
  mgr <- newManager defaultManagerSettings
  let blocEnv = BlocEnv stratoDev mgr conn
  run flags_port (appBloc blocEnv)

dbExistsQuery :: Query
dbExistsQuery = "SELECT 1 FROM pg_database WHERE datname='bloc';"

