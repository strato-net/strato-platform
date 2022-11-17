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
import qualified Strato.VaultProxy.Monad                  as VaultProxy
import qualified Strato.VaultProxy.Server                 as VaultProxy

import           Options

main :: IO ()
main = do
  blockappsInit "blockapps-vault-proxy-server"
  --Print the startup logo
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
  --Initialize a new connection manager, ensure TLS communication as everything is sensitive info from here on out.
  mgr <- newManager tlsManagerSettings
  let vaultConnection = VaultConnection {
      vaultUrl = flags_VAULT_URL,
      vaultPassword = flags_VAULT_PASSWORD,
      vaultPort = flags_VAULT_PORT,
      httpManager = mgr,
      oauthEnabled = flags_OAUTH_ENABLED,
      oauthUrl = flags_OAUTH_DISCOVERY_URL,
      oauthClientId = flags_OAUTH_CLIENT_ID
      oauthClientSecret = flags_OAUTH_CLIENT_SECRET,
      oauthReserveSeconds = flags_OAUTH_RESERVE_SECONDS,
      oauthServiceClientId = flags_OAUTH_SERVICE_USER_CLIENT_ID,
      oauthServiceClientSecret = flags_OAUTH_SERVICE_USER_CLIENT_SECRET,
      vaultProxyUrl = flags_VAULT_PROXY_URL,
      vaultProxyPort = flags_VAULT_PROXY_PORT
  }
  password <- newIORef Nothing
  tokenCache <- atomically $ newCacheSTM Nothing
  -- cache <- newCache . Just $ TimeSpec (fromIntegral flags_keyStoreCacheTimeout) 0
  -- let env = VaultProxy.VaultWrapperEnv mgr pool password cache
  run (vaultConnection ^. vaultPort) (appVaultProxy vaultConnection)

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
