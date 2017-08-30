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

  close dbCreateConn




  conn21 <- connectPostgreSQL $ fromString $
    "host=" ++ flags_pghost ++ " port=" ++ flags_pgport ++ " user=" ++ flags_pguser ++ " dbname=bloc21 password=" ++ flags_password

  -- TODO: database connection resource management
  void $ execute_ conn21 Bloc21.createTables
  mgr <- newManager defaultManagerSettings
  stratoUrl <- parseBaseUrl $ resolveStratoURL flags_stratourl
  cirrusUrl <- parseBaseUrl flags_cirrusurl
  let blocEnv = Bloc21.BlocEnv stratoUrl cirrusUrl mgr conn21 $ toEnum flags_loglevel
  putStrLn $ "Using Strato URL: " ++ showBaseUrl stratoUrl
  putStrLn $ "Using Cirrus URL: " ++ showBaseUrl cirrusUrl
  run flags_port (appBloc blocEnv)

dbExistsQuery21 :: Query
dbExistsQuery21 = "SELECT 1 FROM pg_database WHERE datname='bloc21';"

appBloc :: Bloc21.BlocEnv -> Application
appBloc env21 =
  logStdoutDev
  . cors (const $ Just policy)
  . provideOptions (Proxy @ (Bloc21.BlocAPI))
  . serve (Proxy @ (
              "bloc" :> "v2.1" :> Bloc21.BlocAPI :<|>
              "bloc" :> "v2.1" :> Bloc21.BlocDocsAPI
              ))
  $ Bloc21.serveBloc env21
     :<|> return Bloc21.blocSwagger
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}
