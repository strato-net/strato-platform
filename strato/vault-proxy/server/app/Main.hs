{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE MultiWayIf #-}

module Main where

import           Control.Concurrent.Lock                as L
import           Control.Monad
import           Control.Monad.IO.Class
import           Data.ByteString                        as B hiding (putStrLn, map, filter)
import qualified Data.Cache                             as Cache
import           Data.Text                              as T hiding (unlines, map, filter)   
import           Data.Text.Encoding                     as TE
import           Debug.Trace
import           HFlags
import           GHC.Conc
import qualified Network.HTTP.Client                    as HCLI
import           Network.HTTP.Conduit                   as HCON hiding (Request)
import           Network.HTTP.ReverseProxy
import           Network.HTTP.Types.Header              as TH
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
  --Initialize a new locking mechanism, this will be shared among all threads that are currently using the vault proxy
    --and will prevent multiple threads from attempting to reach the OAUTH provider at the same time.
  vaultLock <- liftIO $ L.new
  --Initialize the token cache
  tokenCash <- atomically $ Cache.newCacheSTM Nothing
  traceM "Trying to parse the oauth url"
  --Parse the shared vault url
  ourl <- parseBaseUrl $ T.unpack flags_OAUTH_DISCOVERY_URL 
  --Connect to the oauth provider
  rawOauthInfo <- runClientM RO.connectRawOauth (mkClientEnv mgr ourl)
  noErrorOauth <- case rawOauthInfo of
          Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
          Right val -> return val
  --Setup the vault connection
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
      additionalOauth = noErrorOauth,
      superLock = vaultLock,
      debuggingOn = flags_VAULT_PROXY_DEBUG
  }
  --Create the proxy server
  let app' = (waiProxyTo (app vaultConnection) defaultOnExc)
      vport = vaultProxyPort vaultConnection
  traceM $ "Starting the proxy server on port: " ++ show vport  
  run vport (app' $ httpManager vaultConnection)

app :: VaultConnection -> W.Request -> IO WaiProxyResponse
app vc rev = do
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Here is the original request incoming to the vault-proxy:" 
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ show rev ---Can remove in production

  --get the foreign vault information
  foreignVault <- (parseBaseUrl $ T.unpack $ vaultUrl vc)
  let fport = baseUrlPort foreignVault
      furl = baseUrlHost foreignVault
  --Check and review the headers that were added
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Checking if the request contains the X-USER-ACCESS-TOKEN header"
  modReq <- checkHeaders rev vc
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Changing the request to the foreign vault."
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Here is the modified request: "
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ show modReq
  pure . WPRModifiedRequest modReq $ ProxyDest (TE.encodeUtf8 $ T.pack furl) fport

checkHeaders :: W.Request -> VaultConnection -> IO Request
checkHeaders rev vc = do
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Inspecting the headers given to the vault-proxy"
  xuat <- checkXuat rev vc
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Fixing the headers"
  h <- if
    | (xuat /= Nothing) -> do 
      vaultProxyDebug flags_VAULT_PROXY_DEBUG "X-USER-ACCESS-TOKEN was present"
      pure xuat
    | otherwise -> do
      vaultProxyDebug flags_VAULT_PROXY_DEBUG "X-USER-ACCESS-TOKEN was not present, adding the Authorization header"
      goodJwt <- vaulty vc
      let uth = (TH.hAuthorization,) . (bearerBS <>) <$> (Just (TE.encodeUtf8 (accessToken goodJwt)))
      pure uth
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Filtering out the old headers, will remove old X-USER-ACCESS-TOKEN and Authorization headers"
  let headers = W.requestHeaders rev
      filteredHeaders = filter (\(a,_) -> a /= "X-USER-ACCESS-TOKEN" && a /= "Authorization") headers
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Adding the new headers to the request"
  let modReq = case h of
        Nothing    -> rev
        Just auth' -> rev { W.requestHeaders = auth':filteredHeaders }
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Here are the raw headers: "
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ show (W.requestHeaders modReq)
  pure modReq

checkXuat :: Request -> VaultConnection -> IO (Maybe Header)
checkXuat rev vc = do
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Checking if X-USER-ACCESS-TOKEN is in the list of headers in the request."
  case (lookup "X-USER-ACCESS-TOKEN" $ W.requestHeaders rev) of
    Just b -> do
      vaultProxyDebug flags_VAULT_PROXY_DEBUG "X-USER-ACCESS-TOKEN is present"
      newB <- case b of
        "" -> do
          vaultProxyDebug flags_VAULT_PROXY_DEBUG "X-USER-ACCESS-TOKEN is empty, will get a new token"
          goodJwt <- vaulty vc
          pure (TE.encodeUtf8 (accessToken goodJwt))
        _ -> do
          vaultProxyDebug flags_VAULT_PROXY_DEBUG "X-USER-ACCESS-TOKEN was not empty, using it instead of using the cache"
          vaultProxyDebug flags_VAULT_PROXY_DEBUG $ show b
          pure b
      let newXuat = (TH.hAuthorization,) . (bearerBS <>) <$> Just newB
      pure newXuat
    Nothing -> do
      vaultProxyDebug flags_VAULT_PROXY_DEBUG "X-USER-ACCESS-TOKEN was not present"
      pure Nothing

bearerBS :: ByteString
bearerBS = TE.encodeUtf8 "Bearer "