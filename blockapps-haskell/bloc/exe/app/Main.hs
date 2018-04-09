{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}


module Main where

import           Control.Monad
import           Database.PostgreSQL.Simple
import Data.Pool
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
  let dbConnectInfo = ConnectInfo { connectHost = flags_pghost
                                 , connectPort = read flags_pgport
                                 , connectUser = flags_pguser
                                 , connectPassword = flags_password
                                 , connectDatabase = "postgres"
                                 }
  dbCreateConn <- connect dbConnectInfo

  doesNotExist22 <- null <$>
    (query_ dbCreateConn dbExistsQuery22 :: IO [Only Int])
  when doesNotExist22 . void $
    execute_ dbCreateConn Bloc22.createDatabase
  close dbCreateConn

  conn22 <- connect dbConnectInfo{connectDatabase="bloc22"}

  void $ execute_ conn22 Bloc22.createTables
  close conn22

  -- Not creating pool for bloc21 as it's being deprecated

  pool22 <- createPool (connect dbConnectInfo{connectDatabase="bloc22"}) close 5 3 5
  mgr <- newManager defaultManagerSettings
  stratoUrl <- parseBaseUrl $ resolveStratoURL flags_stratourl
  cirrusUrl <- parseBaseUrl flags_cirrusurl
  let blocEnv = Bloc22.BlocEnv stratoUrl cirrusUrl mgr pool22 $ toEnum flags_loglevel
  putStrLn $ "Using Strato URL: " ++ showBaseUrl stratoUrl
  run flags_port (appBloc blocEnv)

dbExistsQuery22 :: Query
dbExistsQuery22 = "SELECT 1 FROM pg_database WHERE datname='bloc22';"

appBloc :: Bloc22.BlocEnv -> Application
appBloc env22 =
  logStdout
  . cors (const $ Just policy)
  . provideOptions (Proxy @ Bloc22.BlocAPI)
  . serve (Proxy @ (
              "bloc" :> "v2.2" :> Bloc22.BlocAPI
         :<|> "bloc" :> "v2.2" :> Bloc22.BlocDocsAPI
              ))
  $ Bloc22.serveBloc env22
     :<|> return Bloc22.blocSwagger
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}
