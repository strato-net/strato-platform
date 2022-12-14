{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE MultiWayIf #-}

module Main where

import           Control.Monad
import           Control.Monad.IO.Class
import           Data.ByteString                        as B hiding (putStrLn, map)
import qualified Data.Cache                             as Cache
import           Data.Text                              as T hiding (unlines, map)   
import           Data.Text.Encoding                     as TE
import           Debug.Trace
import           HFlags
import           GHC.Conc
import qualified Network.HTTP.Client                    as HCLI
import           Network.HTTP.Conduit                   as HCON hiding (Request)
import           Network.HTTP.ReverseProxy
import           Network.HTTP.Types.Header             (hAuthorization, RequestHeaders)
import           Network.HTTP.Headers                  as H   
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
  --get the awesome token, awesome token alters the token cash, so a result is not needed
  _ <- liftIO $ getAwesomeToken tokenCash flags_OAUTH_CLIENT_ID flags_OAUTH_CLIENT_SECRET flags_OAUTH_RESERVE_SECONDS noErrorOauth
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
      additionalOauth = noErrorOauth
  }
  --Create the proxy server
  let app' = (waiProxyTo (app vaultConnection) defaultOnExc)
      vport = vaultProxyPort vaultConnection
  traceM $ "Starting the proxy server on port: " ++ show vport  
  run vport (app' $ httpManager vaultConnection)

app :: VaultConnection -> W.Request -> IO WaiProxyResponse
app vc rev = do
  --get the JWT information
  traceM "Getting the JWT information"
  jwt <- vaulty vc
  --get the foreign vault information
  foreignVault <- (parseBaseUrl $ T.unpack $ vaultUrl vc)
  let fport = baseUrlPort foreignVault
      furl = baseUrlHost foreignVault
      goodJwt = accessToken jwt
      --get the old headers
      headers = W.requestHeaders rev
  --Check and review the headers that were added
  traceM "Checking if the request contains the X-USER-ACCESS-TOKEN header"
  modReq <- checkHeaders rev vc
  traceM "Changing the request to the foreign vault."
  pure . WPRModifiedRequest modReq $ ProxyDest (TE.encodeUtf8 $ T.pack furl) fport

checkHeaders :: W.Request -> VaultConnection -> IO Request
checkHeaders rev vc = do
  traceM "Inspecting the headers given to the vault-proxy"
  xuat <- checkXuat rev
  authy <- checkAuth rev vc
  traceM "Fixing the headers"
  h <- if
    | (authy /= Nothing && xuat /= Nothing) -> do
      traceM "Authorization was present, but X-USER-ACCESS-TOKEN was not, returning the original headers"
      pure authy
    | (xuat /= Nothing && authy == Nothing) -> do 
      traceM "X-USER-ACCESS-TOKEN was present, but Authorization was not, adding the Authorization header"
      pure xuat
    | otherwise -> do
      traceM "Neither Authorization or X-USER-ACCESS-TOKEN were present, adding the Authorization header"
      goodJwt <- vaulty vc
      let uth = (hAuthorization,) . (bearerBS <>) <$> (Just (TE.encodeUtf8 (accessToken goodJwt)))
      goodAuth <- case uth of 
        Nothing -> error "There was no good authorization"
        Just val -> return val
      goodAuth
  traceM "changing the headers."
  headers <- W.requestHeaders rev
  let modReq = case h of
        Nothing    -> rev
        Just auth' -> rev { W.requestHeaders = auth':headers }
  traceM "Here are the raw headers: "
  traceM $ show (W.requestHeaders rev)
  pure modReq

checkXuat :: Request -> IO (Maybe Header)
checkXuat rev = do
  traceM "Inspecting the headers given to the vault-proxy"
  case (lookup "referer" $ W.requestHeaders rev) of
    Just (a,b) -> do
      traceM "X-USER-ACCESS-TOKEN was present, converting it into an authorization header"
      let newXuat = (hAuthorization,) . (bearerBS <>) <$> (Just (TE.encodeUtf8 b))
      pure newXuat
    Nothing -> do
      traceM "X-USER-ACCESS-TOKEN was not present"
      pure Nothing

checkAuth :: Request -> VaultConnection -> IO (Maybe Header)
checkAuth hd vc = do
  traceM "Inspecting the headers given to the vault-proxy"
  case (map (lookup "Authorization") hd) of
    Just (_,auth) -> do
      traceM "Authorization header was already present"
      newAuth <- checkValidAuth auth vc
      pure auth
    Nothing -> do
      traceM "Authorization header was not present"
      pure Nothing

checkValidAuth :: Header -> VaultConnection -> IO Header
checkValidAuth auth vc = do
  traceM "Inspecting the Authorization header given to the vault-proxy"
  (headName,postfix) <- auth
  case (postfix == Nothing) of
    True -> do
      traceM "Authorization had something in it, so I am going to assume it is valid"
      pure auth
    False -> do
      traceM "Nothing was present in the Authorization, so I am replacing the header with a new one"
      goodJwt <- vaulty vc
      let h = (hAuthorization,) . (bearerBS <>) <$> (Just (TE.encodeUtf8 $ accessToken goodJwt))
      hh <- case h of
        Nothing -> do
          traceM "There was an error with the adding the new Authorization header, just returning the old one"
          pure auth
        Just h' -> h'
      pure hh
-- authHeader :: B.ByteString -> Header
-- authHeader jwt = (hAuthorization,) . (bearerBS <>) <$> (Just (TE.encodeUtf8 jwt))

bearerBS :: ByteString
bearerBS = TE.encodeUtf8 "Bearer "
