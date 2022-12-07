{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TupleSections     #-}

module Main where

import           Control.Monad
import           Control.Monad.IO.Class
-- import           Control.Monad.Logger
import           Data.ByteString                        as B hiding (putStrLn)
import           Data.Cache
import           Data.Text                              as T hiding (unlines)   
import           Data.Text.Encoding                     as TE
import           Debug.Trace
import           HFlags
import           GHC.Conc
import qualified Network.HTTP.Client                    as HCLI
import           Network.HTTP.Conduit                   as HCON hiding (Request)
import           Network.HTTP.ReverseProxy
import           Network.HTTP.Types.Header             (hAuthorization)
import           Network.Wai.Handler.Warp              (run)
import           Network.Wai                           as W
import           System.IO                              (BufferMode (..),
                                                        hSetBuffering, stderr,
                                                        stdout)

import           BlockApps.Init
import           Servant.Client
import           Strato.VaultProxy.DataTypes              as VaultProxy
import           Strato.VaultProxy.RawOauth               as RO
import           Strato.VaultProxy.Server.Token

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
  -- $logInfoS "Vault-Proxy is Starting"
  when (flags_VAULT_URL == "") $ error "There is no shared vault connection 😓"
  
  --Initialize a new connection manager, ensure TLS communication as everything is sensitive info from here on out.
  mgr <- HCLI.newManager HCON.tlsManagerSettings
  tokenCash <- atomically $ newCacheSTM Nothing
  traceM "Trying to parse the oauth url"
  ourl <- parseBaseUrl $ show flags_OAUTH_DISCOVERY_URL 
  rawOauthInfo <- runClientM RO.connectRawOauth (mkClientEnv mgr ourl)
  noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
  --get the awesome token, awesome token alters the token cash, so a result is not needed
  _ <- liftIO $ getAwesomeToken tokenCash flags_OAUTH_CLIENT_ID flags_OAUTH_CLIENT_SECRET flags_OAUTH_RESERVE_SECONDS noErrorOauth

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
  --  $logInfoS "Vault-Proxy is starting up inside of the strato container on port: " ++ vport
  
  run vport (app' $ httpManager vaultConnection)
  --  $logInfoS "Vault-Proxy is shutting down"

app :: VaultConnection -> W.Request -> IO WaiProxyResponse
app vc rev = do
  jwt <- vaulty vc
  foreignVault <- (parseBaseUrl $ T.unpack $ vaultUrl vc)
  let fport = baseUrlPort foreignVault
      furl = baseUrlHost foreignVault
      goodJwt = accessToken jwt
      headers = W.requestHeaders rev
      auth = (hAuthorization,) . (bearerBS <>) <$> (Just (TE.encodeUtf8 goodJwt))
      modReq = case auth of
        Nothing    -> rev
        Just auth' -> rev { W.requestHeaders = auth':headers }
    --Assuming the port is 8094 for the shared vault
  pure . WPRModifiedRequest modReq $ ProxyDest (TE.encodeUtf8 $ T.pack furl) fport

bearerBS :: ByteString
bearerBS = TE.encodeUtf8 "Bearer "