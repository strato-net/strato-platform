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
import           System.IO                          (BufferMode (..),
                                                     hSetBuffering, stderr,
                                                     stdout)



import qualified BlockApps.Bloc21.API as Bloc21
import qualified BlockApps.Bloc21.Database.Create as Bloc21
import qualified BlockApps.Bloc21.Monad as Bloc21
import qualified BlockApps.Bloc21.Server as Bloc21

import qualified BlockApps.Bloc22.API as Bloc22
import qualified BlockApps.Bloc22.Database.Create as Bloc22
import qualified BlockApps.Bloc22.Monad as Bloc22
import qualified BlockApps.Bloc22.Server as Bloc22

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

  doesNotExist22 <- null <$>
    (query_ dbCreateConn dbExistsQuery22 :: IO [Only Int])
  when doesNotExist22 . void $
    execute_ dbCreateConn Bloc22.createDatabase

  doesNotExist21 <- null <$>
    (query_ dbCreateConn dbExistsQuery21 :: IO [Only Int])
  when doesNotExist21 . void $
    execute_ dbCreateConn Bloc21.createDatabase

  close dbCreateConn



  conn22 <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc22 password=" ++ flags_password
  
  conn21 <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc21 password=" ++ flags_password

  -- TODO: database connection resource management
  void $ execute_ conn22 Bloc22.createTables
  void $ execute_ conn21 Bloc21.createTables
  mgr <- newManager defaultManagerSettings
  stratoUrl <- parseBaseUrl $ resolveStratoURL flags_stratourl
  cirrusUrl <- parseBaseUrl flags_cirrusurl
  let blocEnv = Bloc22.BlocEnv stratoUrl cirrusUrl mgr conn22 $ toEnum flags_loglevel
  let bloc21Env = Bloc21.BlocEnv stratoUrl cirrusUrl mgr conn21 $ toEnum flags_loglevel
  putStrLn $ "Using Strato URL: " ++ showBaseUrl stratoUrl
  putStrLn $ "Using Cirrus URL: " ++ showBaseUrl cirrusUrl
  run flags_port (appBloc blocEnv bloc21Env)

dbExistsQuery22 :: Query
dbExistsQuery22 = "SELECT 1 FROM pg_database WHERE datname='bloc22';"

dbExistsQuery21 :: Query
dbExistsQuery21 = "SELECT 1 FROM pg_database WHERE datname='bloc21';"

appBloc :: Bloc22.BlocEnv -> Bloc21.BlocEnv -> Application
appBloc env22 env21 =
  logStdoutDev
  . cors (const $ Just policy)
  . provideOptions (Proxy @ (Bloc22.BlocAPI :<|> Bloc21.BlocAPI))
  . serve (Proxy @ (
              "bloc" :> "v2.2" :> Bloc22.BlocAPI :<|>
              "bloc" :> "v2.2" :> Bloc22.BlocDocsAPI :<|>
              "bloc" :> "v2.1" :> Bloc21.BlocAPI :<|>
              "bloc" :> "v2.1" :> Bloc21.BlocDocsAPI
              ))
  $ Bloc22.serveBloc env22
     :<|> return Bloc22.blocSwagger
     :<|> Bloc21.serveBloc env21
     :<|> return Bloc21.blocSwagger
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}
