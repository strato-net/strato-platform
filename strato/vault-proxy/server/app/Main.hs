{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Main where

import           Control.Monad
-- import           Database.PostgreSQL.Simple
import           Data.Cache
-- import           Data.IORef
-- import           Data.Pool
import qualified Data.Text                              as T
import           HFlags
import           GHC.Conc
import           Network.HTTP.Client                    hiding (Proxy)
-- import           Network.HTTP.Conduit                   hiding (Proxy)
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Cors
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Middleware.RequestLogger
import           Network.Wai.Middleware.Servant.Options
import           Servant
-- import           System.Clock
import           System.IO                              (BufferMode (..),
                                                        hSetBuffering, stderr,
                                                        stdout)

import           BlockApps.Init
import           BlockApps.Logging                      (LogLevel(..), flags_minLogLevel)
import           Servant.Client
-- import           Servant.Client.Core 

import qualified Strato.VaultProxy.API                    as VaultProxy
-- import qualified Strato.VaultProxy.Monad                  as VaultProxy
import qualified Strato.VaultProxy.Server                 as VaultProxy
import           Strato.VaultProxy.DataTypes              as VaultProxy
import           Strato.VaultProxy.RawOauth               as RO


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
  when (flags_VAULT_URL == "") $ error "There is no shared vault connection 😓"
  --Initialize a new connection manager, ensure TLS communication as everything is sensitive info from here on out.
  mgr <- newManager defaultManagerSettings
  tokenCash <- atomically $ newCacheSTM Nothing
  --make the connection to the OAUTH provider to get the information we need to connect to the shared vault
  rawoauth <- case flags_OAUTH_DISCOVERY_URL of
    "" -> error "No OAuth2 Discovery URL was provided"
    url -> do
        ourl <- parseBaseUrl (T.unpack url)
        rawOauthInfo <- runClientM RO.connectRawOauth (mkClientEnv mgr ourl)
        case rawOauthInfo of
            Left err -> error $ "Error connecting to the OAUTH server: " <> show err
            Right val -> return val
  let vaultConnection = VaultConnection {
      vaultUrl = flags_VAULT_URL,
      vaultPassword = flags_VAULT_PASSWORD,
      vaultPort = flags_VAULT_PORT,
      httpManager = mgr,
      oauthUrl = flags_OAUTH_DISCOVERY_URL,
      oauthClientId = flags_OAUTH_CLIENT_ID,
      oauthClientSecret = flags_OAUTH_CLIENT_SECRET,
      oauthReserveSeconds = flags_OAUTH_RESERVE_SECONDS,
      oauthServiceClientId = flags_OAUTH_SERVICE_USER_CLIENT_ID,
      oauthServiceClientSecret = flags_OAUTH_SERVICE_USER_CLIENT_SECRET,
      vaultProxyUrl = flags_VAULT_PROXY_URL,
      vaultProxyPort = flags_VAULT_PROXY_PORT,
      tokenCache = tokenCash,
      additionalOauth = rawoauth
  }

  --Actually run the app and keep it alive
  run (vaultPort vaultConnection) (appVaultProxy vaultConnection)

appVaultProxy :: VaultProxy.VaultConnection -> Application
appVaultProxy env =
    prometheus def{ prometheusEndPoint = ["vault-proxy", "metrics"]
                  , prometheusInstrumentApp = False}
  . instrumentApp "vault-proxy"
  . (if flags_minLogLevel == LevelDebug then logStdoutDev else logStdout)
  . cors (const $ Just policy)
  . provideOptions (Proxy @ VaultProxy.VaultProxyAPI)
  . serve (Proxy @ (
              VaultProxy.VaultProxyAPI
         :<|> VaultProxy.VaultProxyDocsAPI
              ))
  $ VaultProxy.serveVaultProxy env
     :<|> return VaultProxy.vaultProxySwagger
  where
    policy = simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]}
