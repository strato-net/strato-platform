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
-- import qualified Data.Text                              as T
import           Debug.Trace
import           HFlags
import           GHC.Conc
import           Network.HTTP.Client                    hiding (Proxy)
import           Network.HTTP.Conduit                   hiding (Proxy)
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
  mgr <- newManager tlsManagerSettings
  tokenCash <- atomically $ newCacheSTM Nothing
  ourl <- parseBaseUrl "https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration" 
  rawOauthInfo <- runClientM RO.connectRawOauth (mkClientEnv mgr ourl)
  noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
  traceShowM noErrorOauth
  traceM "Able to get all of the OAUTH information"
  let vaultConnection = VaultConnection {
      vaultUrl = flags_VAULT_URL,
      httpManager = mgr,
      oauthUrl = flags_OAUTH_DISCOVERY_URL,
      oauthClientId = flags_OAUTH_CLIENT_ID,
      oauthClientSecret = flags_OAUTH_CLIENT_SECRET,
      oauthReserveSeconds = flags_OAUTH_RESERVE_SECONDS,
      vaultProxyUrl = flags_VAULT_PROXY_URL,
      vaultProxyPort = flags_VAULT_PROXY_PORT,
      tokenCache = tokenCash,
      additionalOauth = noErrorOauth
  }

  --Actually run the app and keep it alive
  --Was instructed to hardcode the vault port, previous implementation, first arguement for the run command should be the foreign vault port
  traceM "VaultProxy is trying to start up"
  run 8013 (appVaultProxy vaultConnection)
  traceM "VaultProxy is shutting down"

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
