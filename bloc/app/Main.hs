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
import Servant.Common.BaseUrl

import BlockApps.Bloc.API
import BlockApps.Bloc.Database.Create
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Options
import BlockApps.Strato.StratoURLResolver

main :: IO ()
main = do
  putStrLn . unlines $
    [ "██████╗ ██╗      ██████╗  ██████╗"
    , "██╔══██╗██║     ██╔═══██╗██╔════╝"
    , "██████╔╝██║     ██║   ██║██║     "
    , "██╔══██╗██║     ██║   ██║██║     "
    , "██████╔╝███████╗╚██████╔╝╚██████╗"
    , "╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝"
    ]
  _ <- $initHFlags "Setup EthereumH DBs"
  dbCreateConn <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=5432 user=" ++ flags_pguser ++ " dbname=postgres password=" ++ flags_password
  doesNotExist <- null <$>
    (query_ dbCreateConn dbExistsQuery :: IO [Only Int])
  when doesNotExist . void $
    execute_ dbCreateConn createDatabase
  close dbCreateConn
  conn <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=5432 user=" ++ flags_pguser ++ " dbname=bloc password=" ++ flags_password
  -- TODO: database connection resource management
  void $ execute_ conn createTables
  mgr <- newManager defaultManagerSettings
  baseUrl <- parseBaseUrl $ resolveStratoURL flags_stratourl
  let blocEnv = BlocEnv baseUrl mgr conn
  run flags_port (appBloc blocEnv)

dbExistsQuery :: Query
dbExistsQuery = "SELECT 1 FROM pg_database WHERE datname='bloc';"
