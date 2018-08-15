module Main where

import           Control.Monad
import           Control.Monad.Log                  (Severity(..))
import           Database.PostgreSQL.Simple
import           Data.Pool
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
import qualified BlockApps.Bloc22.Database.Migration as Bloc22
import qualified BlockApps.Bloc22.Monad as Bloc22
import qualified BlockApps.Bloc22.Server as Bloc22

import           Options

main :: IO ()
main = do
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering
  putStrLn . unlines $
    [ " ██████╗  ██████╗ ██╗   ██╗█████████╗██╗   ██╗"
    , "██╔═══██╗██╔═══██╗██║   ██║   ███╔══╝██║   ██║"
    , "██║   ██║████████║██║   ██║   ███║   ████████║"
    , "██║   ██║██╔═══██║██║   ██║   ███║   ██║   ██║"
    , "╚██████╔╝██║   ██║╚██████╔╝   ███║   ██║   ██║"
    , " ╚═════╝ ╚═╝   ╚═╝ ╚═════╝    ╚══╝   ╚═╝   ╚═╝"
    ]
  _ <- $initHFlags "Setup Vault Wrapper DBs"
  let dbConnectInfo = ConnectInfo { connectHost = flags_pghost
                                  , connectPort = read flags_pgport
                                  , connectUser = flags_pguser
                                  , connectPassword = flags_password
                                  , connectDatabase = flags_database
                                  }

  conn <- connect dbConnectInfo
  void $ Bloc22.runMigrations conn
  close conn

  pool <- createPool (connect dbConnectInfo) close 5 3 5
  mgr <- newManager defaultManagerSettings
  let env = VaultWrapperEnv mgr pool (toEnum flags_loglevel)
  run flags_port (appVault env)

appVaultWrapper :: VaultWrapperEnv -> Application
appVaultWrapper env =
  (if Bloc22.logLevel env >= Informational then logStdoutDev else logStdout)
  . cors (const $ Just policy)
  . provideOptions (Proxy @ Bloc22.BlocAPI)
  . serve (Proxy @ (
              "bloc" :> "v2.2" :> Bloc22.BlocAPI
         :<|> "bloc" :> "v2.2" :> Bloc22.BlocDocsAPI
              ))
  $ Bloc22.serveBloc env
     :<|> Bloc22.blocSwagger
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}
