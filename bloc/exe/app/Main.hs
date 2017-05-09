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
import           Network.Wai.Middleware.Cors
import           Network.Wai.Middleware.RequestLogger
import           Network.Wai.Middleware.Servant.Options
import           Servant
import           Servant.Common.BaseUrl
import           Servant.Swagger.UI
import           System.IO                          (BufferMode (..),
                                                     hSetBuffering, stderr,
                                                     stdout)



import qualified BlockApps.Bloc20.API as Bloc20
import qualified BlockApps.Bloc20.Database.Create as Bloc20
import qualified BlockApps.Bloc20.Monad as Bloc20
import qualified BlockApps.Bloc20.Server as Bloc20

import qualified BlockApps.Bloc21.API as Bloc21
import qualified BlockApps.Bloc21.Database.Create as Bloc21
import qualified BlockApps.Bloc21.Monad as Bloc21
import qualified BlockApps.Bloc21.Server as Bloc21

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
    
  doesNotExist21 <- null <$>
    (query_ dbCreateConn dbExistsQuery21 :: IO [Only Int])
  when doesNotExist21 . void $
    execute_ dbCreateConn Bloc21.createDatabase
    
  doesNotExist20 <- null <$>
    (query_ dbCreateConn dbExistsQuery20 :: IO [Only Int])
  when doesNotExist20 . void $
    execute_ dbCreateConn Bloc20.createDatabase
    
  close dbCreateConn




  conn21 <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc21 password=" ++ flags_password
    
  conn20 <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc20 password=" ++ flags_password

  -- TODO: database connection resource management
  void $ execute_ conn21 Bloc21.createTables
  void $ execute_ conn20 Bloc20.createTables
  mgr <- newManager defaultManagerSettings
  stratoUrl <- parseBaseUrl $ resolveStratoURL flags_stratourl
  cirrusUrl <- parseBaseUrl flags_cirrusurl
  let blocEnv = Bloc21.BlocEnv stratoUrl cirrusUrl mgr conn21 $ toEnum flags_loglevel
  let bloc2Env = Bloc20.BlocEnv stratoUrl cirrusUrl mgr conn20 $ toEnum flags_loglevel
  putStrLn $ "Using Strato URL: " ++ showBaseUrl stratoUrl
  run flags_port (appBloc blocEnv bloc2Env)

dbExistsQuery21 :: Query
dbExistsQuery21 = "SELECT 1 FROM pg_database WHERE datname='bloc21';"

dbExistsQuery20 :: Query
dbExistsQuery20 = "SELECT 1 FROM pg_database WHERE datname='bloc20';"

appBloc :: Bloc21.BlocEnv -> Bloc20.BlocEnv -> Application
appBloc env21 env20 = 
  logStdoutDev
  . cors (const $ Just policy)
  . provideOptions (Proxy @ (Bloc21.BlocAPI :<|> Bloc20.BlocAPI))
  . serve (Proxy @ (
              "bloc" :> "v2.1" :> Bloc21.BlocAPI :<|>
              "bloc" :> "v2.1" :> Bloc21.BlocDocsAPI :<|>
              "bloc" :> "v2.0" :> Bloc20.BlocAPI :<|>
              "bloc" :> "v2.0" :> Bloc20.BlocDocsAPI
              ))
  $ (Bloc21.serveBloc env21
     :<|> swaggerSchemaUIServer Bloc21.blocSwagger
     :<|> Bloc20.serveBloc env20
     :<|> swaggerSchemaUIServer Bloc20.blocSwagger)
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}



