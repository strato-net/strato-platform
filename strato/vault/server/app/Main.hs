{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Main where

import BlockApps.Init
import BlockApps.Logging (LogLevel (..), flags_minLogLevel)
import Control.Exception (SomeException, try)
import Control.Monad (forM_, void, when)
import Control.Monad.IO.Class (liftIO)
import Control.Monad.Logger (runNoLoggingT)
import Control.Monad.Reader (runReaderT)
import Data.Cache
import Data.IORef
import Data.Pool
import Data.String (fromString)
import Database.Persist.Sql (rawExecute)
import Database.Persist.Postgresql (withPostgresqlConn)
import Database.PostgreSQL.Simple
import HFlags
import Network.HTTP.Client hiding (Proxy)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger
import Network.Wai.Middleware.Servant.Options
import Options
import Servant
import qualified Strato.Strato23.API as Strato23
import qualified Strato.Strato23.Database.Migrations as Strato23
import qualified Strato.Strato23.Monad as Strato23
import qualified Strato.Strato23.Server as Strato23
import qualified Strato.Strato23.Server.Password as Strato23Pass
import System.Clock
import qualified Data.Text as T
import System.IO
  ( BufferMode (..),
    hSetBuffering,
    stderr,
    stdout,
  )

main :: IO ()
main = do
  blockappsInit "blockapps-vault-wrapper-server"
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering
  putStrLn . unlines $
    [ "@@@  @@@  @@@@@@  @@@  @@@ @@@    @@@@@@@     @@@  @@@  @@@ @@@@@@@   @@@@@@  @@@@@@@  @@@@@@@  @@@@@@@@ @@@@@@@ ",
      "@@@  @@@ @@@@@@@@ @@@  @@@ @@@    @@@@@@@     @@@  @@@  @@@ @@@@@@@@ @@@@@@@@ @@@@@@@@ @@@@@@@@ @@@@@@@@ @@@@@@@@",
      "@@!  @@@ @@!  @@@ @@!  @@@ @@!      @@!       @@!  @@!  @@! @@!  @@@ @@!  @@@ @@!  @@@ @@!  @@@ @@!      @@!  @@@",
      "!@!  @!@ !@!  @!@ !@!  @!@ !@!      !@!       !@!  !@!  !@! !@!  @!@ !@!  @!@ !@!  @!@ !@!  @!@ !@!      !@!  @!@",
      "@!@  !@! @!@!@!@! @!@  !@! @!!      @!!       @!!  !!@  @!@ @!@!!@!  @!@!@!@! @!@@!@!  @!@@!@!  @!!!:!   @!@!!@! ",
      "!@!  !!! !!!@!!!! !@!  !!! !!!      !!!       !@!  !!!  !@! !!@!@!   !!!@!!!! !!@!!!   !!@!!!   !!!!!:   !!@!@!  ",
      ":!:  !!: !!:  !!! !!:  !!! !!:      !!:       !!:  !!:  !!: !!: :!!  !!:  !!! !!:      !!:      !!:      !!: :!! ",
      " ::!!:!  :!:  !:! :!:  !:!  :!:     :!:       :!:  :!:  :!: :!:  !:! :!:  !:! :!:      :!:      :!:      :!:  !:!",
      "  ::::   ::   ::: ::::: ::  :: ::::  ::        :::: :: :::  ::   ::: ::   :::  ::       ::       :: :::: ::   :::",
      "   :      :   : :  : :  :  : :: : :  :          :: :  : :    :   : :  :   : :  :        :       : :: ::   :   : :"
    ]
  _ <- $initHFlags "Setup Vault Wrapper DBs"

  -- Create database if it doesn't exist (postgres should be ready via docker --wait)
  let adminConnStr = fromString $ "host=" <> flags_pghost <> " port=" <> flags_pgport <> " user=" <> flags_pguser <> " password=" <> flags_password <> " dbname=postgres"
      createDbQuery = "CREATE DATABASE " <> fromString flags_database <> " WITH ENCODING 'UTF8'"
  runNoLoggingT $ withPostgresqlConn adminConnStr $ \backend -> do
    result <- liftIO $ try $ runReaderT (rawExecute createDbQuery []) backend
    case result of
      Left (_ :: SomeException) -> liftIO $ putStrLn $ "Database " <> flags_database <> " already exists or could not be created"
      Right () -> return ()

  let dbConnectInfo =
        ConnectInfo
          { connectHost = flags_pghost,
            connectPort = read flags_pgport,
            connectUser = flags_pguser,
            connectPassword = flags_password,
            connectDatabase = flags_database
          }

  conn <- connect dbConnectInfo
  void $ Strato23.runMigrations conn
  close conn

  let poolConfig = defaultPoolConfig
                    (connect dbConnectInfo)
                    close
                    3 -- timeout: 3 seconds
                    20 -- max resources
  pool <- newPool poolConfig
  mgr <- newManager defaultManagerSettings
  password <- newIORef Nothing
  cache <- newCache . Just $ TimeSpec (fromIntegral flags_keyStoreCacheTimeout) 0
  let env = Strato23.VaultWrapperEnv mgr pool password cache

  -- Initialize vault password from file if provided (for local deployments)
  when (not (null flags_vaultPasswordFile)) $ do
    vaultPassword <- filter (/= '\n') <$> readFile flags_vaultPasswordFile
    putStrLn $ "Initializing vault password from: " ++ flags_vaultPasswordFile
    _ <- Strato23.runVaultToIO env (Strato23Pass.postPassword (T.pack vaultPassword))
    putStrLn "Vault password initialized."

  run flags_port (appVaultWrapper env)

appVaultWrapper :: Strato23.VaultWrapperEnv -> Application
appVaultWrapper env =
  prometheus
    def
      { prometheusEndPoint = ["strato", "v2.3", "metrics"],
        prometheusInstrumentApp = False
      }
    . instrumentApp "vault-wrapper"
    . (if flags_minLogLevel == LevelDebug then logStdoutDev else logStdout)
    . cors (const $ Just policy)
    . provideOptions (Proxy @Strato23.VaultWrapperAPI)
    . serve
      ( Proxy
          @( "strato" :> "v2.3" :> Strato23.VaultWrapperAPI
               :<|> "strato" :> "v2.3" :> Strato23.VaultWrapperDocsAPI
           )
      )
    $ Strato23.serveVaultWrapper env
      :<|> return Strato23.vaultWrapperSwagger
  where
    policy = simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]}
