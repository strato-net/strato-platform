{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Transparent OAuth authentication for STRATO CLI tools.
--
-- This module provides "sudo-style" authentication - callers don't need to
-- think about tokens. They just run authenticated actions and the library
-- handles token loading, refresh, and interactive login when needed.
--
-- Usage:
--
-- @
-- result <- runAuthenticated authConfig baseUrl getMetaDataClient
-- @
--
-- If no valid token exists, the user is prompted to authenticate via
-- OAuth device flow (browser-based), then the action continues.

module Strato.Auth
  ( -- * Simple API (config loaded internally - preferred)
    authRequest
  , runServant
  , runServantWithAuth
  , runServantWithAuthEnv
  
    -- * Configuration (for advanced use)
  , AuthConfig(..)
  , OAuthEndpoints(..)
  , loadAuthConfig
  
    -- * Authenticated operations (require AuthConfig)
  , runAuthenticated
  , authenticatedHttp
  , getAccessToken
  
    -- * Errors
  , AuthError(..)
  , formatAuthError
  ) where

import Control.Concurrent (threadDelay)
import Control.Exception (try, SomeException)
import Data.Aeson (decode, encode, object, (.:), (.=))
import System.Exit (exitFailure)
import System.IO (hPutStrLn, stderr)
import qualified Data.Aeson.Key as Key
import Data.Aeson.Types (parseMaybe)
import qualified Data.ByteString.Lazy as LBS
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Data.Text.IO as TIO
import Data.Time.Clock.POSIX (getPOSIXTime)
import Network.HTTP.Client
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Servant.Client (ClientM, ClientEnv(..), BaseUrl, mkClientEnv, runClientM, ClientError, defaultMakeClientRequest)
import Servant.Client.Core (addHeader)
import System.Directory (doesFileExist, createDirectoryIfMissing, getHomeDirectory)
import System.FilePath ((</>))
import System.IO (hFlush, stdout)

-- | OAuth endpoint URLs
data OAuthEndpoints = OAuthEndpoints
  { tokenUrl :: T.Text      -- ^ Token endpoint (for refresh and device code exchange)
  , deviceUrl :: T.Text     -- ^ Device authorization endpoint
  } deriving (Show, Eq)

-- | Authentication configuration
data AuthConfig = AuthConfig
  { oauthEndpoints :: OAuthEndpoints
  , clientId :: T.Text
  , clientSecret :: T.Text
  , tokenStorePath :: FilePath    -- ^ Where to store tokens
  , configStorePath :: FilePath   -- ^ Where OAuth config is stored
  } deriving (Show)

-- | Authentication errors
data AuthError
  = AuthConfigNotFound FilePath
  | AuthConfigInvalid String
  | TokenStorageError String
  | DeviceFlowError String
  | RefreshFailed String
  | NetworkError String
  | UserCancelled
  deriving (Show, Eq)

-- | Format an auth error for display
formatAuthError :: AuthError -> T.Text
formatAuthError = \case
  AuthConfigNotFound path -> "OAuth config not found at " <> T.pack path
  AuthConfigInvalid msg -> "Invalid OAuth config: " <> T.pack msg
  TokenStorageError msg -> "Token storage error: " <> T.pack msg
  DeviceFlowError msg -> "Authentication failed: " <> T.pack msg
  RefreshFailed msg -> "Token refresh failed: " <> T.pack msg
  NetworkError msg -> "Network error: " <> T.pack msg
  UserCancelled -> "Authentication cancelled"

-- | Internal token representation
data StoredTokens = StoredTokens
  { accessToken :: T.Text
  , refreshToken :: T.Text
  , expiresAt :: Integer  -- Unix timestamp
  } deriving (Show)

-- | Load auth config from the standard location (~/.secrets/oauth_credentials)
loadAuthConfig :: IO (Either AuthError AuthConfig)
loadAuthConfig = do
  home <- getHomeDirectory
  let configPath = home </> ".secrets" </> "oauth_credentials"
      tokenPath = home </> ".secrets" </> "stratoToken"
  exists <- doesFileExist configPath
  if not exists
    then return $ Left $ AuthConfigNotFound configPath
    else do
      content <- TIO.readFile configPath
      let pairs = map (T.breakOn "=") $ T.lines content
          getValue key = case lookup key [(T.strip k, T.strip $ T.drop 1 v) | (k, v) <- pairs] of
            Just val -> val
            Nothing -> ""
          discoveryUrl = getValue "OAUTH_DISCOVERY_URL"
          cid = getValue "OAUTH_CLIENT_ID"
          csecret = getValue "OAUTH_CLIENT_SECRET"
          -- Derive endpoints from discovery URL
          realmUrl = T.replace "/.well-known/openid-configuration" "" discoveryUrl
          tUrl = realmUrl <> "/protocol/openid-connect/token"
          dUrl = realmUrl <> "/protocol/openid-connect/auth/device"
      
      if T.null cid
        then return $ Left $ AuthConfigInvalid "OAUTH_CLIENT_ID not set"
        else return $ Right AuthConfig
          { oauthEndpoints = OAuthEndpoints tUrl dUrl
          , clientId = cid
          , clientSecret = csecret
          , tokenStorePath = tokenPath
          , configStorePath = configPath
          }

-- | Simple: Make an authenticated HTTP request (sudo-style).
--
-- Config is loaded internally. Exits on auth failure.
--
-- @
-- response <- authRequest myRequest
-- @
authRequest :: Request -> IO (Response LBS.ByteString)
authRequest request = do
  config <- requireAuthConfig
  result <- authenticatedHttp config request
  case result of
    Left err -> authFail err
    Right response -> return response

-- | Simple: Run a Servant client with automatic authentication (sudo-style).
--
-- Config is loaded internally. Exits on auth failure.
--
-- @
-- result <- runServant baseUrl getMetadata
-- @
runServant :: BaseUrl -> ClientM a -> IO (Either ClientError a)
runServant baseUrl action = do
  config <- requireAuthConfig
  result <- runAuthenticated config baseUrl action
  case result of
    Left err -> authFail err
    Right clientResult -> return clientResult

-- | Simple: Run a Servant client that takes auth header as a parameter (sudo-style).
--
-- For APIs where the auth token is passed explicitly (e.g., bloc APIs).
-- The token is obtained internally and never exposed to the caller.
-- Exits on auth failure.
--
-- @
-- result <- runServantWithAuth baseUrl $ \authHeader ->
--   postBlocTransactionParallelExternal authHeader Nothing True request
-- @
runServantWithAuth :: BaseUrl -> (Maybe T.Text -> ClientM a) -> IO (Either ClientError a)
runServantWithAuth baseUrl mkAction = do
  manager <- newManager tlsManagerSettings
  let env = mkClientEnv manager baseUrl
  runServantWithAuthEnv env mkAction

-- | Run a Servant client that takes auth header, with custom ClientEnv (sudo-style).
--
-- Use this when you need custom headers or other env customization.
-- Exits on auth failure.
--
-- @
-- env <- makeCustomClientEnv  -- your env with CSRF bypass headers etc
-- result <- runServantWithAuthEnv env $ \authHeader ->
--   postBlocTransactionParallelExternal authHeader Nothing True request
-- @
runServantWithAuthEnv :: ClientEnv -> (Maybe T.Text -> ClientM a) -> IO (Either ClientError a)
runServantWithAuthEnv env mkAction = do
  config <- requireAuthConfig
  tokenResult <- getValidToken config
  case tokenResult of
    Left err -> authFail err
    Right token -> do
      let authHeader = Just $ "Bearer " <> token
      runClientM (mkAction authHeader) env

-- | Load auth config or exit with error (sudo-style helper)
requireAuthConfig :: IO AuthConfig
requireAuthConfig = do
  result <- loadAuthConfig
  case result of
    Left err -> authFail err
    Right config -> return config

-- | Exit with auth error message (sudo-style helper)
authFail :: AuthError -> IO a
authFail err = do
  hPutStrLn stderr $ T.unpack $ formatAuthError err
  exitFailure

-- | Run a Servant client action with automatic authentication.
--
-- This is the main entry point. It:
-- 1. Loads existing tokens (if any)
-- 2. Refreshes them if expired
-- 3. Triggers interactive device flow login if needed
-- 4. Runs the action with the valid token
runAuthenticated :: AuthConfig -> BaseUrl -> ClientM a -> IO (Either AuthError (Either ClientError a))
runAuthenticated config baseUrl action = do
  tokenResult <- getValidToken config
  case tokenResult of
    Left err -> return $ Left err
    Right token -> do
      manager <- newManager tlsManagerSettings
      let env = mkAuthenticatedEnv manager baseUrl token
      result <- runClientM action env
      return $ Right result

-- | Make an authenticated HTTP request.
--
-- For raw HTTP calls (like PostgREST queries) that aren't Servant clients.
authenticatedHttp :: AuthConfig -> Request -> IO (Either AuthError (Response LBS.ByteString))
authenticatedHttp config request = do
  tokenResult <- getValidToken config
  case tokenResult of
    Left err -> return $ Left err
    Right token -> do
      manager <- newManager tlsManagerSettings
      let reqWithAuth = request
            { requestHeaders = ("Authorization", TE.encodeUtf8 $ "Bearer " <> token) 
                             : filter ((/= "Authorization") . fst) (requestHeaders request)
            }
      result <- try $ httpLbs reqWithAuth manager
      case result of
        Left (e :: SomeException) -> return $ Left $ NetworkError (show e)
        Right resp -> return $ Right resp

-- | Create a Servant ClientEnv with auth header injection
mkAuthenticatedEnv :: Manager -> BaseUrl -> T.Text -> ClientEnv
mkAuthenticatedEnv manager baseUrl token =
  let env = mkClientEnv manager baseUrl
      customMakeRequest burl req = defaultMakeClientRequest burl
        $ addHeader "Authorization" ("Bearer " <> token)
        $ req
  in env { makeClientRequest = customMakeRequest }

-- | Get a valid access token, refreshing or prompting login as needed.
--
-- This is the core function that handles the "sudo-style" auth:
-- - If tokens exist and are valid, returns the access token
-- - If tokens are expired, refreshes them silently
-- - If no tokens or refresh fails, triggers interactive device flow login
--
-- This is exported for use cases where you need the raw token (e.g., APIs
-- that take auth header as a parameter rather than injecting it).
getAccessToken :: AuthConfig -> IO (Either AuthError T.Text)
getAccessToken = getValidToken

-- | Internal: Get a valid access token
getValidToken :: AuthConfig -> IO (Either AuthError T.Text)
getValidToken config = do
  exists <- doesFileExist (tokenStorePath config)
  if not exists
    then doDeviceFlowLogin config
    else do
      content <- LBS.readFile (tokenStorePath config)
      case parseStoredTokens content of
        Nothing -> doDeviceFlowLogin config
        Just tokens -> do
          now <- round <$> getPOSIXTime
          if now >= expiresAt tokens - 60
            then refreshOrLogin config tokens
            else return $ Right $ accessToken tokens

-- | Parse stored tokens from JSON
parseStoredTokens :: LBS.ByteString -> Maybe StoredTokens
parseStoredTokens content = do
  json <- decode content
  at <- parseMaybe (\obj -> obj .: "access_token") json
  rt <- parseMaybe (\obj -> obj .: "refresh_token") json
  ea <- parseMaybe (\obj -> obj .: "expires_at") json
  return StoredTokens { accessToken = at, refreshToken = rt, expiresAt = ea }

-- | Try to refresh token, fall back to device flow if refresh fails
refreshOrLogin :: AuthConfig -> StoredTokens -> IO (Either AuthError T.Text)
refreshOrLogin config tokens = do
  if T.null (refreshToken tokens)
    then doDeviceFlowLogin config
    else do
      result <- refreshTokens config (refreshToken tokens)
      case result of
        Right newToken -> return $ Right newToken
        Left _ -> doDeviceFlowLogin config

-- | Refresh tokens using refresh_token grant
refreshTokens :: AuthConfig -> T.Text -> IO (Either AuthError T.Text)
refreshTokens config rToken = do
  manager <- newManager tlsManagerSettings
  let endpoints = oauthEndpoints config
  
  reqResult <- try $ parseRequest $ T.unpack $ tokenUrl endpoints
  case reqResult of
    Left (e :: SomeException) -> return $ Left $ NetworkError (show e)
    Right req -> do
      let reqWithBody = urlEncodedBody
            [ ("client_id", TE.encodeUtf8 $ clientId config)
            , ("client_secret", TE.encodeUtf8 $ clientSecret config)
            , ("grant_type", "refresh_token")
            , ("refresh_token", TE.encodeUtf8 rToken)
            ] req
      
      respResult <- try $ httpLbs reqWithBody manager
      case respResult of
        Left (e :: SomeException) -> return $ Left $ NetworkError (show e)
        Right resp -> parseTokenResponse config rToken (responseBody resp)

-- | Parse token response and save tokens
parseTokenResponse :: AuthConfig -> T.Text -> LBS.ByteString -> IO (Either AuthError T.Text)
parseTokenResponse config oldRefreshToken body =
  case decode body of
    Nothing -> return $ Left $ RefreshFailed "Invalid response"
    Just json -> do
      let getField :: T.Text -> Maybe T.Text
          getField key = parseMaybe (\obj -> obj .: Key.fromText key) json
          getFieldInt :: T.Text -> Maybe Int
          getFieldInt key = parseMaybe (\obj -> obj .: Key.fromText key) json
      
      case getField "error" of
        Just err -> return $ Left $ RefreshFailed $ T.unpack err
        Nothing -> case (getField "access_token", getFieldInt "expires_in") of
          (Just newAccessToken, Just expiresIn) -> do
            let newRefreshToken = case getField "refresh_token" of
                  Just rt -> rt
                  Nothing -> oldRefreshToken
            
            now <- round <$> getPOSIXTime
            saveTokensToFile config newAccessToken newRefreshToken (now + fromIntegral expiresIn)
            return $ Right newAccessToken
          _ -> return $ Left $ RefreshFailed "Missing access_token or expires_in"

-- | Save tokens to file
saveTokensToFile :: AuthConfig -> T.Text -> T.Text -> Integer -> IO ()
saveTokensToFile config aToken rToken expAt = do
  let dir = takeDirectory (tokenStorePath config)
  createDirectoryIfMissing True dir
  let tokenData = object
        [ "access_token" .= aToken
        , "refresh_token" .= rToken
        , "expires_at" .= expAt
        ]
  LBS.writeFile (tokenStorePath config) (encode tokenData)
  where
    takeDirectory = reverse . dropWhile (/= '/') . reverse

-- | Perform OAuth device flow login (interactive)
doDeviceFlowLogin :: AuthConfig -> IO (Either AuthError T.Text)
doDeviceFlowLogin config = do
  TIO.putStrLn ""
  TIO.putStrLn "Authentication required."
  TIO.putStrLn ""
  
  manager <- newManager tlsManagerSettings
  let endpoints = oauthEndpoints config
  
  -- Request device code
  reqResult <- try $ parseRequest $ T.unpack $ deviceUrl endpoints
  case reqResult of
    Left (e :: SomeException) -> return $ Left $ NetworkError (show e)
    Right req -> do
      let reqWithBody = urlEncodedBody
            [ ("client_id", TE.encodeUtf8 $ clientId config)
            , ("client_secret", TE.encodeUtf8 $ clientSecret config)
            ] req
      
      respResult <- try $ httpLbs reqWithBody manager
      case respResult of
        Left (e :: SomeException) -> return $ Left $ NetworkError (show e)
        Right resp -> parseDeviceCodeResponse config manager (responseBody resp)

-- | Parse device code response and start polling
parseDeviceCodeResponse :: AuthConfig -> Manager -> LBS.ByteString -> IO (Either AuthError T.Text)
parseDeviceCodeResponse config manager body =
  case decode body of
    Nothing -> return $ Left $ DeviceFlowError "Invalid device code response"
    Just json -> do
      let getValue :: T.Text -> Maybe T.Text
          getValue key = parseMaybe (\obj -> obj .: Key.fromText key) json
          getValueInt :: T.Text -> Maybe Int
          getValueInt key = parseMaybe (\obj -> obj .: Key.fromText key) json
      
      case (getValue "user_code", getValue "verification_uri", getValue "device_code", getValueInt "interval") of
        (Just userCode, Just verifyUri, Just deviceCode, Just interval) -> do
          TIO.putStrLn "============================================================"
          TIO.putStrLn ""
          TIO.putStrLn $ "  Visit: " <> verifyUri
          TIO.putStrLn $ "  Enter code: " <> userCode
          TIO.putStrLn ""
          TIO.putStrLn "============================================================"
          TIO.putStrLn ""
          TIO.putStr "Waiting for authentication..."
          hFlush stdout
          
          pollForToken config manager deviceCode interval
        _ -> return $ Left $ DeviceFlowError "Invalid device code response"

-- | Poll for token until success or failure
pollForToken :: AuthConfig -> Manager -> T.Text -> Int -> IO (Either AuthError T.Text)
pollForToken config manager deviceCode interval = do
  threadDelay (interval * 1000000)
  
  let endpoints = oauthEndpoints config
  reqResult <- try $ parseRequest $ T.unpack $ tokenUrl endpoints
  case reqResult of
    Left (e :: SomeException) -> return $ Left $ NetworkError (show e)
    Right req -> do
      let reqWithBody = urlEncodedBody
            [ ("client_id", TE.encodeUtf8 $ clientId config)
            , ("client_secret", TE.encodeUtf8 $ clientSecret config)
            , ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
            , ("device_code", TE.encodeUtf8 deviceCode)
            ] req
      
      respResult <- try $ httpLbs reqWithBody manager
      case respResult of
        Left (e :: SomeException) -> return $ Left $ NetworkError (show e)
        Right resp -> handlePollResponse config manager deviceCode interval (responseBody resp)

-- | Handle poll response
handlePollResponse :: AuthConfig -> Manager -> T.Text -> Int -> LBS.ByteString -> IO (Either AuthError T.Text)
handlePollResponse config manager deviceCode interval body =
  case decode body of
    Nothing -> return $ Left $ DeviceFlowError "Invalid token response"
    Just json -> do
      let maybeError = parseMaybe (\obj -> obj .: "error") json :: Maybe T.Text
          maybeAccessToken = parseMaybe (\obj -> obj .: "access_token") json :: Maybe T.Text
      
      case (maybeError, maybeAccessToken) of
        (Just "authorization_pending", _) -> do
          TIO.putStr "."
          hFlush stdout
          pollForToken config manager deviceCode interval
        
        (Just "slow_down", _) -> do
          TIO.putStr "."
          hFlush stdout
          pollForToken config manager deviceCode (interval + 1)
        
        (Just err, _) -> do
          TIO.putStrLn ""
          return $ Left $ DeviceFlowError $ T.unpack err
        
        (Nothing, Just token) -> do
          let maybeRefresh = parseMaybe (\obj -> obj .: "refresh_token") json :: Maybe T.Text
              maybeExpiresIn = parseMaybe (\obj -> obj .: "expires_in") json :: Maybe Int
          
          case (maybeRefresh, maybeExpiresIn) of
            (Just refreshTok, Just expiresIn) -> do
              TIO.putStrLn ""
              TIO.putStrLn ""
              TIO.putStrLn "Authenticated successfully."
              TIO.putStrLn ""
              
              now <- round <$> getPOSIXTime
              saveTokensToFile config token refreshTok (now + fromIntegral expiresIn)
              return $ Right token
            
            (Nothing, Just expiresIn) -> do
              TIO.putStrLn ""
              TIO.putStrLn ""
              TIO.putStrLn "Authenticated successfully."
              TIO.putStrLn ""
              
              now <- round <$> getPOSIXTime
              saveTokensToFile config token "" (now + fromIntegral expiresIn)
              return $ Right token
            
            _ -> do
              TIO.putStrLn ""
              TIO.putStrLn ""
              TIO.putStrLn "Authenticated successfully."
              TIO.putStrLn ""
              
              now <- round <$> getPOSIXTime
              saveTokensToFile config token "" (now + 300)
              return $ Right token
        
        _ -> return $ Left $ DeviceFlowError "Unexpected response"
