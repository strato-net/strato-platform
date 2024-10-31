{-# LANGUAGE DataKinds #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Main where

import BlockApps.Init
import Control.Concurrent.Lock as L
import Control.Monad
import Control.Monad.IO.Class
import Data.ByteString as B hiding (filter, map)
import qualified Data.Cache as Cache
import Data.Text as T hiding (filter, map, unlines)
import Data.Text.Encoding as TE
import Debug.Trace
import GHC.Conc
import HFlags
import Instrumentation
import qualified Network.HTTP.Client as HCLI
import Network.HTTP.Conduit as HCON hiding (Request)
import Network.HTTP.ReverseProxy
import Network.HTTP.Types.Header as TH
import Network.Wai as W
import Network.Wai.Handler.Warp (run)
import Options
import Servant.Client as S
import Servant.Client.Core (addHeader)
import Strato.VaultProxy.DataTypes as VaultProxy
import Strato.VaultProxy.GetPing as GP
import Strato.VaultProxy.RawOauth as RO
import Strato.VaultProxy.Server.Token
import System.IO
  ( BufferMode (..),
    hSetBuffering,
    stderr,
    stdout,
  )
import Text.Regex

main :: IO ()
main = do
  blockappsInit "blockapps-vault-proxy-server"
  runInstrumentation "blockapps-vault-proxy-server"
  --Print the startup logo
  forM_ [stdout, stderr] $ flip hSetBuffering LineBuffering
  putStrLn . unlines $
    [ "                                      mm                                                                     ",
      "*@@@@*   *@@@*                      *@@@    @@           *@@@***@@m                                          ",
      "  *@@     m@                          @@    @@             @@   *@@m                                         ",
      "   @@m   m@    m@*@@m  *@@@  *@@@     @@  @@@@@@           @@   m@@ *@@@m@@@   m@@*@@m *@@*   *@@**@@*   *@@*",
      "    @@m  @*   @@   @@    @@    @@     !@    @@             @@@@@@@    @@* **  @@*   *@@  *@@ m@*    @@   m@  ",
      "    *!@ !*     m@@@!@    !@    @@     !@    @@     @@@@@   @@         @!      @@     @@    @@@       @@ m!   ",
      "     !@@m     @!   !@    !@    @!     !@    @!             @!         @!      @@     !@    !!@@       @@!    ",
      "     !! !*     !!!!:!    !@    !!     !!    !!             @!         !!      !@     !!    !!@        @!!    ",
      "     !!::     !!   :!    !!    !!     :!    !!             !!         !:      !!!   !!!  !!* !!!      !!:    ",
      "      :       :!: : !:   :: !: :!:  : : :   ::: :        :!:!:      : :::      : : : :  ::    :!:     !!     ",
      "                                                                                                    ::!      ",
      "                                                                                                  :::        "
    ]
  _ <- $initHFlags "Setup Vault Proxy flags"
  when (flags_VAULT_URL == "") $ error "There is no shared vault connection 😓"
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Checking if the connection to the VAULT is https encrypted"

  --Initialize a new connection manager, ensure TLS communication as everything is sensitive info from here on out.
  mgr <- HCLI.newManager HCON.tlsManagerSettings

  traceM "Trying to parse the oauth url"
  --Parse the shared vault url
  ourl <- parseBaseUrl $ T.unpack flags_OAUTH_DISCOVERY_URL
  --Connect to the oauth provider
  rawOauthInfo <- runClientM RO.connectRawOauth (mkClientEnv mgr ourl)
  noErrorOauth <- case rawOauthInfo of
    Left err -> error $ "Error connecting to the OAUTH server: " ++ show err
    Right val -> return val

  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ "Making an intial call to the OAUTH provider, please note that there will be two calls to the oauth provider."
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ "First call is used to see if everything is alive, then if everything is working it will store it in cache."
  --make an initial call to see if the vault is working
  initialToken <- getVirginToken flags_OAUTH_CLIENT_ID flags_OAUTH_CLIENT_SECRET noErrorOauth

  let minimumVersion :: Int
      minimumVersion = 0

  --Check the version of the foreign shared vault
  traceM "Checking the version of the foreign vault"
  pvault <- parseBaseUrl $ T.unpack flags_VAULT_URL <> "/strato/v2.3/_ping"
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ "The foreign vault url is: " <> show pvault
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ "Making the initial request to the shared vault with the authorization header."
  foreignVaultPing <- runClientM GP.connectGetPing (mkClientEnv mgr pvault) {makeClientRequest = const $ defaultMakeClientRequest pvault . addHeader ("Authorization") ("Bearer " ++ T.unpack (accessToken initialToken))}
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ "Calling the _ping endpoint on the foreign vault results in this: " <> show foreignVaultPing
  vaultVersion <- case foreignVaultPing of
    Left err -> error $ "Could not reach the foreign vault: " ++ show err
    --Error out and quit compilation if the version is too old, "0.1.0.0" is the current version of the shared vault
    --This value is retrieved from blockapps-vault-wrapper-server package.yaml file when making a ping to the foreign vault
    Right val -> do
      when ((VaultProxy.version val) < minimumVersion) $ error "The foreign vault is too old, please update it to the latest version"
      pure val
  traceM $ "The version of the foreign vault provided is :" <> show vaultVersion

  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ "Setting up persistence in the vault-proxy"

  traceM "Setting up the locking mechanism"
  --Initialize a new locking mechanism, this will be shared among all threads that are currently using the vault proxy
  --and will prevent multiple threads from attempting to reach the OAUTH provider at the same time.
  vaultLock <- liftIO $ L.new
  --Initialize the token cache
  traceM "Setting up the caching service"
  tokenCash <- atomically $ Cache.newCacheSTM Nothing

  --Setup the vault connection
  let vaultConnection =
        VaultConnection
          { vaultUrl = flags_VAULT_URL,
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
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ show rev

  --get the foreign vault information
  foreignVault <- (parseBaseUrl $ T.unpack $ vaultUrl vc)
  let fport = baseUrlPort foreignVault
      furl = baseUrlHost foreignVault
      httpsMaybe = S.baseUrlScheme foreignVault
  --Check and review the headers that were added
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Checking if the request contains the X-USER-ACCESS-TOKEN header"
  modReq <- checkHeaders rev vc
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Changing the request to the foreign vault."
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Here is the modified request: "
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ show modReq
  pure $ secureWai httpsMaybe modReq furl fport

secureWai :: S.Scheme -> Request -> String -> Int -> WaiProxyResponse
secureWai S.Https modReq furl fport = WPRModifiedRequestSecure modReq $ ProxyDest (TE.encodeUtf8 $ T.pack furl) fport
secureWai _ modReq furl fport = WPRModifiedRequest modReq $ ProxyDest (TE.encodeUtf8 $ T.pack furl) fport

checkHeaders :: W.Request -> VaultConnection -> IO Request
checkHeaders rev vc = do
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Inspecting the headers given to the vault-proxy"
  xuat <- checkXuat rev vc
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Fixing the headers"
  h <-
    if
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
      filteredHeaders = filter (\(a, _) -> a /= "X-USER-ACCESS-TOKEN" && a /= "Authorization") headers
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Adding the new headers to the request"
  let modReq = case h of
        Nothing -> rev
        Just auth' -> rev {W.requestHeaders = auth' : filteredHeaders}
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

inspectVaultUrl :: T.Text -> IO ()
inspectVaultUrl url = do
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Inspecting the vault url"
  purl <- S.parseBaseUrl $ T.unpack url
  let allowedIPAddressRegex = "^172.17.((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\\.){1}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$"

  vaultProxyDebug flags_VAULT_PROXY_DEBUG "Inspecting the URL using this regex: "
  vaultProxyDebug flags_VAULT_PROXY_DEBUG allowedIPAddressRegex
  let dockerIps = matchRegexAll (mkRegex allowedIPAddressRegex) $ S.baseUrlHost purl
  vaultProxyDebug flags_VAULT_PROXY_DEBUG "This is the result of the regex search on the VAULT_URL: "
  vaultProxyDebug flags_VAULT_PROXY_DEBUG $ show dockerIps
  if
      | (dockerIps /= Nothing) -> do
        traceM ("There was a special url provided (" ++ showBaseUrl purl ++ "),  I will allow any types of connections to this url.")
        pure ()
      | (S.baseUrlHost purl == "docker.for.mac.localhost") -> do
        traceM ("There was a special url provided (" ++ showBaseUrl purl ++ "),  I will allow any types of connections to this url.")
        pure ()
      | (S.baseUrlScheme purl /= S.Https) -> error $ "The provided url (" ++ show purl ++ ") is http, please use https, I will not change it for you, I am quitting. 🙎"
      | otherwise -> pure ()
