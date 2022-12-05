{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TupleSections     #-}

module Main where

import           Control.Monad
-- import           Database.PostgreSQL.Simple
import           Data.ByteString                        as B hiding (putStrLn)
-- import           Data.ByteString.Internal
import           Data.Cache
-- import           Data.IORef
-- import           Data.Pool
-- import qualified Data.Text                              as T
import           Data.Text.Encoding                     as TE
-- import           Debug.Trace
import           HFlags
import           GHC.Conc
import qualified Network.HTTP.Client                    as HCLI
import           Network.HTTP.Conduit                   as HCON hiding (Request)
-- import           Network.HTTP.Req                       as R
import           Network.HTTP.ReverseProxy
import           Network.HTTP.Types.Header             (hAuthorization)
import           Network.Wai.Handler.Warp              (run)
import           Network.Wai                           as W
-- import           Network.Wai.Middleware.Cors
-- import           Network.Wai.Middleware.Prometheus
-- import           Network.Wai.Middleware.RequestLogger
-- import           Network.Wai.Middleware.Servant.Options
-- import           Servant
-- import           System.Clock
import           System.IO                              (BufferMode (..),
                                                        hSetBuffering, stderr,
                                                        stdout)

import           BlockApps.Init
-- import           BlockApps.Logging                      (LogLevel(..), flags_minLogLevel)
import           Servant.Client
-- import qualified Servant.Subscriber.Request               as SR
-- import           Servant.Client.Core 

-- import qualified Strato.VaultProxy.API                    as VaultProxy
-- import qualified Strato.VaultProxy.Monad                  as VaultProxy
-- import qualified Strato.VaultProxy.Server                 as VaultProxy
import           Strato.VaultProxy.DataTypes              as VaultProxy
import           Strato.VaultProxy.RawOauth               as RO
import           Strato.VaultProxy.Server.Token

-- import System.Environment (getArgs)
-- import System.IO (Handle, hSetBuffering, BufferMode(NoBuffering))

-- import Network (listenOn, accept, PortID(..), Socket)
-- import Network.Socket hiding (recv, accept)
-- import Network.Socket.ByteString (recv, sendAll)

-- import Control.Concurrent (forkIO)

-- import Data.Monoid
-- import Data.Maybe
-- import Data.Attoparsec.ByteString (maybeResult, parseWith, parse)
-- import qualified Data.ByteString as BS

-- import Types
-- import Parser
-- import PrettyPrinter

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
  mgr <- HCLI.newManager HCON.tlsManagerSettings
  tokenCash <- atomically $ newCacheSTM Nothing
  ourl <- parseBaseUrl "https://keycloak.blockapps.net/auth/realms/strato-devel/.well-known/openid-configuration" 
  rawOauthInfo <- runClientM RO.connectRawOauth (mkClientEnv mgr ourl)
  noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
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
  let app' = (waiProxyTo (app vaultConnection) defaultOnExc)
      vport = vaultProxyPort vaultConnection
  print $ "Running the vault proxy on port " ++ show vport
  run vport (app' $ httpManager vaultConnection)

app :: VaultConnection -> W.Request -> IO WaiProxyResponse
app vc rev = do
  --Get the JWT token
  jwt <- vaulty vc
  let goodJwt = accessToken jwt
      headers = W.requestHeaders rev
      -- authHeadr = R.header (TE.encodeUtf8 "X-USER-UNIQUE-NAME") (TE.encodeUtf8 $ (T.pack "Bearer " <> goodJwt))
      -- auth = (hAuthorization,) . (authHeadr <>) <$> goodJwt
      -- oldHead = W.requestHeaders req 
      -- modReq = req { W.requestHeaders = authHeadr <> oldHead  }
      auth = (hAuthorization,) . (bearerBS <>) <$> (Just (TE.encodeUtf8 goodJwt))
      modReq = case auth of
        Nothing    -> rev
        Just auth' -> rev { W.requestHeaders = auth':headers }
    --Assuming the port is 8094 for the shared vault
  pure . WPRModifiedRequest modReq $ ProxyDest (TE.encodeUtf8 $ vaultUrl vc) 8094

bearerBS :: ByteString
bearerBS = TE.encodeUtf8 "Bearer "