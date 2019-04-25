{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}


module Main where

import           Control.Monad
import           Database.PostgreSQL.Simple
import           Data.Pool
import           HFlags
import           Network.HTTP.Client hiding (Proxy, responseStatus)
import           Network.HTTP.Types (hContentType, status400)
import           Network.Wai
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Cors
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Middleware.RequestLogger
import           Network.Wai.Middleware.Servant.Options
import           Servant
import           Servant.Client
import           System.IO                          (BufferMode (..),
                                                     hSetBuffering, stderr,
                                                     stdout)



import qualified BlockApps.Bloc22.API as Bloc22
import qualified BlockApps.Bloc22.Database.Create as Bloc22
import qualified BlockApps.Bloc22.Database.Migration as Bloc22
import qualified BlockApps.Bloc22.Monad as Bloc22
import qualified BlockApps.Bloc22.Server as Bloc22
import           BlockApps.Logging (LogLevel(..), flags_minLogLevel)

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
  when doesNotExist22 $ void $ execute_ dbCreateConn Bloc22.createDatabase

  close dbCreateConn

  pool22 <- createPool (connect dbConnectInfo{connectDatabase="bloc22"}) close 5 3 5
  mgr <- newManager defaultManagerSettings
  stratoUrl <- parseBaseUrl flags_stratourl
  vaultWrapperUrl <- parseBaseUrl flags_vaultwrapperurl
  let mode = if flags_publicmode then Bloc22.Public else Bloc22.Enterprise
  let blocEnv = Bloc22.BlocEnv stratoUrl vaultWrapperUrl mgr pool22 mode flags_stateFetchLimit
  putStrLn $ "Using Strato URL: " ++ showBaseUrl stratoUrl
  void $ Bloc22.runBlocToIO blocEnv Bloc22.runBlocMigrations
  run flags_port (appBloc blocEnv)

dbExistsQuery22 :: Query
dbExistsQuery22 = "SELECT 1 FROM pg_database WHERE datname='bloc22';"

serveErrorsPlain :: Middleware
serveErrorsPlain app req respond = app req $ \resp -> respond $
  if responseStatus resp < status400
    then resp
    else mapResponseHeaders ((hContentType, "text/plain"):) resp


appBloc :: Bloc22.BlocEnv -> Application
appBloc env22 =
    prometheus def{ prometheusEndPoint = ["bloc", "v2.2", "metrics"]
                  , prometheusInstrumentApp = False}
  . instrumentApp "bloc22"
  . (if flags_minLogLevel == LevelDebug then logStdoutDev else logStdout)
  . serveErrorsPlain
  . cors (const $ Just policy)
  . provideOptions (Proxy @ Bloc22.BlocAPI)
  . serve (Proxy @ (
              "bloc" :> "v2.2" :> Bloc22.BlocAPI
         :<|> "bloc" :> "v2.2" :> Bloc22.BlocDocsAPI
              ))
  $ Bloc22.serveBloc env22
     :<|> return (case Bloc22.deployMode env22 of
                    Bloc22.Public -> Bloc22.filterEnterprisePaths Bloc22.blocSwagger
                    Bloc22.Enterprise -> Bloc22.blocSwagger)
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}
