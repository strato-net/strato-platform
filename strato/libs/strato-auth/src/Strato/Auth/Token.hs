{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Auth.Token
  ( getToken
  , refreshToken
  , tokenFilePath
  ) where

import Control.Exception (catch, SomeException)
import Data.Aeson (FromJSON(..), decode, encode, object, withObject, (.:), (.=))
import Data.Base64.Types as B64
import Data.ByteString.Base64 as B64
import qualified Data.ByteString.Lazy as LBS
import Data.Maybe (fromJust)
import qualified Data.Text as T
import Data.Text.Encoding as TE
import Data.Time.Clock.POSIX (getPOSIXTime)
import Network.HTTP.Req as R
import Strato.Auth.ClientCredentials
import Strato.Auth.Retry (withRetry)
import System.Directory (createDirectoryIfMissing)
import System.FileLock (withFileLock, SharedExclusive(Exclusive))
import System.FilePath (takeDirectory)
import Text.URI as URI

tokenFilePath :: FilePath
tokenFilePath = "secrets/oauth_token"

lockFilePath :: FilePath
lockFilePath = "secrets/oauth_token.lock"

-- | Get cached token, or fetch a new one if not cached
getToken :: T.Text -> IO T.Text
getToken discUrl = do
  putStrLn "DEBUG TOKEN: getToken - checking cache"
  cached <- readCachedToken
  case cached of
    Just token -> do
      putStrLn "DEBUG TOKEN: getToken - returning cached token (not expired)"
      pure token
    Nothing -> do
      putStrLn "DEBUG TOKEN: getToken - no valid cache, calling refreshToken"
      refreshToken discUrl

-- | Force refresh the token (call this on 401)
--
-- Retries up to 4 times with exponential backoff on network failures
-- (e.g. connection timeout, DNS failure, TLS errors).
refreshToken :: T.Text -> IO T.Text
refreshToken discUrl = do
  putStrLn "DEBUG TOKEN: refreshToken - acquiring lock"
  withFileLock lockFilePath Exclusive $ \_ -> do
    putStrLn "DEBUG TOKEN: refreshToken - lock acquired, starting retry loop"
    withRetry "OAuth token fetch" 4 $ do
      let ClientCredentialsConfig{..} = clientCredentialsConfig
      putStrLn $ "DEBUG TOKEN: refreshToken - fetching token endpoint from " ++ T.unpack discUrl
      tokenEndpoint <- getTokenEndpoint discUrl
      putStrLn $ "DEBUG TOKEN: refreshToken - got endpoint: " ++ T.unpack tokenEndpoint
      TokenResponse{..} <- fetchToken tokenEndpoint clientId clientSecret
      putStrLn "DEBUG TOKEN: refreshToken - got token, writing cache"
      writeCachedToken trAccessToken trExpiresIn
      pure trAccessToken

readCachedToken :: IO (Maybe T.Text)
readCachedToken =
  (do
    content <- LBS.readFile tokenFilePath
    case decode content of
      Nothing -> pure Nothing  -- invalid JSON or old plain-text format
      Just (CachedToken token expiresAt) -> do
        now <- round <$> getPOSIXTime
        if now >= expiresAt - 60
          then pure Nothing  -- expired or within 60s of expiry
          else pure (Just token)
  ) `catch` (\(_ :: SomeException) -> pure Nothing)

writeCachedToken :: T.Text -> Integer -> IO ()
writeCachedToken token expiresIn = do
  now <- round <$> getPOSIXTime
  let tokenData = object
        [ "access_token" .= token
        , "expires_at" .= (now + expiresIn)
        ]
  createDirectoryIfMissing True (takeDirectory tokenFilePath)
  LBS.writeFile tokenFilePath (encode tokenData)

-- | Fetch token endpoint from OpenID discovery document
getTokenEndpoint :: T.Text -> IO T.Text
getTokenEndpoint discoveryUrl = do
  uri <- URI.mkURI discoveryUrl
  let (url, _) = fromJust (useHttpsURI uri)
  response <- runReq defaultHttpConfig $ R.req R.GET url NoReqBody jsonResponse
    (R.responseTimeout 10000000) -- 10 seconds
  pure $ ddTokenEndpoint (responseBody response)

newtype DiscoveryDocument = DiscoveryDocument { ddTokenEndpoint :: T.Text }

instance FromJSON DiscoveryDocument where
  parseJSON = withObject "DiscoveryDocument" $ \o ->
    DiscoveryDocument <$> o .: "token_endpoint"

fetchToken :: T.Text -> T.Text -> T.Text -> IO TokenResponse
fetchToken tokenEndpoint clientId' clientSecret' = do
  uri <- URI.mkURI tokenEndpoint
  let (url, _) = fromJust (useHttpsURI uri)
      authHeader = R.header "Authorization" $ TE.encodeUtf8 $
        "Basic " <> B64.extractBase64 (B64.encodeBase64 $ TE.encodeUtf8 $ clientId' <> ":" <> clientSecret')
      contentType = R.header "Content-Type" "application/x-www-form-urlencoded"
      body = ReqBodyUrlEnc $ "grant_type" =: ("client_credentials" :: String)
  response <- runReq defaultHttpConfig $
    R.req R.POST url body jsonResponse (authHeader <> contentType <> R.responseTimeout 10000000) -- 10 seconds
  pure $ responseBody response

data TokenResponse = TokenResponse
  { trAccessToken :: T.Text
  , trExpiresIn :: Integer
  }

instance FromJSON TokenResponse where
  parseJSON = withObject "TokenResponse" $ \o ->
    TokenResponse <$> o .: "access_token" <*> o .: "expires_in"

-- | On-disk JSON format: {"access_token":"...","expires_at":...}
data CachedToken = CachedToken T.Text Integer

instance FromJSON CachedToken where
  parseJSON = withObject "CachedToken" $ \o ->
    CachedToken <$> o .: "access_token" <*> o .: "expires_at"
