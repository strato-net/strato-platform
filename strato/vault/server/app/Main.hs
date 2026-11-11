{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Main where

import BlockApps.Init
import BlockApps.Logging (LogLevel (..), flags_minLogLevel)
import Control.Monad (forM_, void, when)
import Data.Cache
import Data.IORef
import Data.Pool
import qualified GHC.Conc as Conc
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

  stripes <- if flags_pgPoolStripes <= 0
               then Conc.getNumCapabilities
               else pure flags_pgPoolStripes
  let poolConfig = setNumStripes (Just stripes)
                 $ defaultPoolConfig
                     (connect dbConnectInfo)
                     close
                     (realToFrac flags_pgPoolIdleTimeout)
                     flags_pgPoolSize
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
