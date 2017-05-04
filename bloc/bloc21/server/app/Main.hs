{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Main where

import           Control.Monad
import           Data.String
import           Database.PostgreSQL.Simple
import           HFlags
import           Network.HTTP.Client
import           Network.Wai.Handler.Warp
import           Servant.Common.BaseUrl
import           System.IO                          (BufferMode (..),
                                                     hSetBuffering, stderr,
                                                     stdout)

import           BlockApps.Bloc.Database.Create
import           BlockApps.Bloc.Monad
import           BlockApps.Bloc.Options
import           BlockApps.Bloc.Server
import           BlockApps.Strato.StratoURLResolver

main :: IO ()
main = do
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering
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
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=postgres password=" ++ flags_password
  doesNotExist <- null <$>
    (query_ dbCreateConn dbExistsQuery :: IO [Only Int])
  when doesNotExist . void $
    execute_ dbCreateConn createDatabase
  close dbCreateConn
  conn <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc password=" ++ flags_password
  -- TODO: database connection resource management
  void $ execute_ conn createTables
  mgr <- newManager defaultManagerSettings
  stratoUrl <- parseBaseUrl $ resolveStratoURL flags_stratourl
  cirrusUrl <- parseBaseUrl flags_cirrusurl
  let blocEnv = BlocEnv stratoUrl cirrusUrl mgr conn
  putStrLn $ "Using Strato URL: " ++ showBaseUrl stratoUrl
  run flags_port (appBloc blocEnv)

dbExistsQuery :: Query
dbExistsQuery = "SELECT 1 FROM pg_database WHERE datname='bloc';"
