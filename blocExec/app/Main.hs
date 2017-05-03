{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}


module Main where

import           Control.Monad
import           Data.String
import           Database.PostgreSQL.Simple
import           HFlags
import           Network.HTTP.Client hiding (Proxy)
import           Network.Wai.Handler.Warp
import           Servant
import           Servant.Common.BaseUrl
import           System.IO                          (BufferMode (..),
                                                     hSetBuffering, stderr,
                                                     stdout)

import           Network.Wai.Middleware.Cors
import           Network.Wai.Middleware.RequestLogger


import           BlockApps.Bloc.Database.Create
import           BlockApps.Bloc.Monad
import           BlockApps.Bloc.Server

import qualified BlockApps.Bloc2.Database.Create as Bloc2
import qualified BlockApps.Bloc2.Monad as Bloc2
import qualified BlockApps.Bloc2.Server as Bloc2

import BlockApps.Bloc.API
import qualified BlockApps.Bloc2.API as Bloc2
--import           Servant.Swagger
import           Servant.Swagger.UI

import           BlockApps.Strato.StratoURLResolver
import           Options

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
    
  doesNotExist2 <- null <$>
    (query_ dbCreateConn dbExistsQuery2 :: IO [Only Int])
  when doesNotExist2 . void $
    execute_ dbCreateConn Bloc2.createDatabase
    
  close dbCreateConn




  conn <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc password=" ++ flags_password
    
  conn2 <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc2 password=" ++ flags_password

  -- TODO: database connection resource management
  void $ execute_ conn createTables
  void $ execute_ conn2 Bloc2.createTables
  mgr <- newManager defaultManagerSettings
  stratoUrl <- parseBaseUrl $ resolveStratoURL flags_stratourl
  cirrusUrl <- parseBaseUrl flags_cirrusurl
  let blocEnv = BlocEnv stratoUrl cirrusUrl mgr conn
  let bloc2Env = Bloc2.BlocEnv stratoUrl cirrusUrl mgr conn2
  putStrLn $ "Using Strato URL: " ++ showBaseUrl stratoUrl
  run flags_port (appBloc blocEnv bloc2Env)

dbExistsQuery :: Query
dbExistsQuery = "SELECT 1 FROM pg_database WHERE datname='bloc';"

dbExistsQuery2 :: Query
dbExistsQuery2 = "SELECT 1 FROM pg_database WHERE datname='bloc2';"

appBloc :: BlocEnv -> Bloc2.BlocEnv -> Application
appBloc env env2 = 
  simpleCors
  . logStdoutDev
  . serve (Proxy @ (
              "bloc" :> "v2.1" :> BlocAPI :<|>
              "bloc" :> "v2.1" :> BlocDocsAPI :<|>
              "bloc" :> "v2.0" :> Bloc2.BlocAPI :<|>
              "bloc" :> "v2.0" :> Bloc2.BlocDocsAPI
              ))
  $ (serveBloc env
     :<|> swaggerSchemaUIServer blocSwagger
     :<|> Bloc2.serveBloc env2
     :<|> swaggerSchemaUIServer Bloc2.blocSwagger)

