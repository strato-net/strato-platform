{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Main where

import           Control.Monad
import           Database.PostgreSQL.Simple
import           Data.Cache
import           Data.IORef
import           Data.Pool
import           HFlags
import           Network.HTTP.Client                    hiding (Proxy)
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Cors
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Middleware.RequestLogger
import           Network.Wai.Middleware.Servant.Options
import           Servant
import           System.Clock
import           System.IO                              (BufferMode (..),
                                                        hSetBuffering, stderr,
                                                        stdout)

import           BlockApps.Init
import           BlockApps.Logging                      (LogLevel(..), flags_minLogLevel)
import qualified Strato.VaultProxy.API                    as VaultProxy
import qualified Strato.VaultProxy.Database.Migrations    as VaultProxy
import qualified Strato.VaultProxy.Monad                  as VaultProxy
import qualified Strato.VaultProxy.Server                 as VaultProxy

import           Options

main :: IO ()
main = do
  blockappsInit "blockapps-vault-proxy-server"
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering



  putStrLn . unlines $
    [ "                                      mm                                                                     "
    , "*@@@@*   *@@@*                      *@@@    @@           *@@@***@@m                                          "
    , "  *@@     m@                          @@    @@             @@   *@@m                                         "
    , "   @@m   m@    m@*@@m  *@@@  *@@@     @@  @@@@@@           @@   m@@ *@@@m@@@   m@@*@@m *@@*   *@@**@@*   *@@*"
    , "    @@m  @*   @@   @@    @@    @@     !@    @@             @@@@@@@    @@* **  @@*   *@@  *@@ m@*    @@   m@  "
    , "    *!@ !*     m@@@!@    !@    @@     !@    @@     @@@@@   @@         @!      @@     @@    @@@       @@ m!   "
    , "     !@@m     @!   !@    !@    @!     !@    @!             @!         @!      @@     !@    !!@@       @@!    "
    , "     !! !*     !!!!:!    !@    !!     !!    !!             @!         !!      !@     !!    !!@        @!!    "
    , "     !!::     !!   :!    !!    !!     :!    !!             !!         !:      !!!   !!!  !!* !!!      !!:    "
    , "      :       :!: : !:   :: !: :!:  : : :   ::: :        :!:!:      : :::      : : : :  ::    :!:     !!     "
    , "                                                                                                    ::!      "
    , "                                                                                                  :::        "
    ]
  _ <- $initHFlags "Setup Vault Proxy flags"
  let dbConnectInfo = ConnectInfo { connectHost = flags_pghost
                                  , connectPort = read flags_pgport
                                  , connectUser = flags_pguser
                                  , connectPassword = flags_password
                                  , connectDatabase = flags_database
                                  }

  conn <- connect dbConnectInfo
  void $ VaultProxy.runMigrations conn
  close conn

  pool <- createPool (connect dbConnectInfo) close 20 3 20
  mgr <- newManager defaultManagerSettings
  password <- newIORef Nothing
  cache <- newCache . Just $ TimeSpec (fromIntegral flags_keyStoreCacheTimeout) 0
  let env = VaultProxy.VaultWrapperEnv mgr pool password cache
  run flags_port (appVaultWrapper env)

appVaultWrapper :: VaultProxy.VaultWrapperEnv -> Application
appVaultWrapper env =
    prometheus def{ prometheusEndPoint = ["strato", "v2.3", "metrics"]
                  , prometheusInstrumentApp = False}
  . instrumentApp "vault-wrapper"
  . (if flags_minLogLevel == LevelDebug then logStdoutDev else logStdout)
  . cors (const $ Just policy)
  . provideOptions (Proxy @ VaultProxy.VaultWrapperAPI)
  . serve (Proxy @ (
              "strato" :> "v2.3" :> VaultProxy.VaultWrapperAPI
         :<|> "strato" :> "v2.3" :> VaultProxy.VaultWrapperDocsAPI
              ))
  $ VaultProxy.serveVaultWrapper env
     :<|> return VaultProxy.vaultWrapperSwagger
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}
