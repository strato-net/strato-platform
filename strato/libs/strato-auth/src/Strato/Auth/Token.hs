{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Auth.Token
  ( getToken
  , refreshToken
  , tokenFilePath
  , defaultTokenCachePath
  ) where

import Control.Exception (catch, SomeException)
import Data.Aeson (FromJSON(..), decode, encode, object, withObject, (.:), (.=))
import Data.Base64.Types as B64
import Data.ByteString.Base64 as B64
import qualified Data.ByteString.Lazy as LBS
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

-- | Allow HTTP for local development: localhost, loopback, or unqualified hostnames (no dots)
isLocalhost :: URI -> Bool
isLocalhost uri = case URI.uriAuthority uri of
  Right auth -> let h = URI.unRText (URI.authHost auth)
                in h `elem` ["localhost", "127.0.0.1", "::1"] || not (T.any (== '.') h)
  _ -> False

-- | Default token cache location. Used when a caller does not supply an
-- explicit path (single-vault / back-compat). When two identities run in the
-- same container they MUST use distinct paths to avoid clobbering each other's
-- cached token — see 'Strato.Auth.Client.newAuthEnvWithCreds'.
defaultTokenCachePath :: FilePath
defaultTokenCachePath = "secrets/oauth_token"

-- | Back-compat alias for 'defaultTokenCachePath'.
tokenFilePath :: FilePath
tokenFilePath = defaultTokenCachePath

-- | The advisory lock guarding a token cache file. Derived from the cache path
-- so each identity locks independently.
lockPathFor :: FilePath -> FilePath
lockPathFor tokenPath = tokenPath ++ ".lock"

-- | Get cached token, or fetch a new one if not cached. The token is cached at
-- 'tokenPath'; credentials (discovery URL, client id/secret) come from 'creds'.
getToken :: ClientCredentialsConfig -> FilePath -> IO T.Text
getToken creds tokenPath = do
  cached <- readCachedToken tokenPath
  case cached of
    Just token -> pure token
    Nothing -> refreshToken creds tokenPath

-- | Force refresh the token (call this on 401)
--
-- Retries up to 4 times with exponential backoff on network failures
-- (e.g. connection timeout, DNS failure, TLS errors).
refreshToken :: ClientCredentialsConfig -> FilePath -> IO T.Text
refreshToken ClientCredentialsConfig{..} tokenPath =
  withFileLock (lockPathFor tokenPath) Exclusive $ \_ ->
    withRetry "OAuth token fetch" 4 $ do
      tokenEndpoint <- getTokenEndpoint discoveryUrl
      TokenResponse{..} <- fetchToken tokenEndpoint clientId clientSecret
      writeCachedToken tokenPath trAccessToken trExpiresIn
      pure trAccessToken

readCachedToken :: FilePath -> IO (Maybe T.Text)
readCachedToken tokenPath =
  (do
    content <- LBS.readFile tokenPath
    case decode content of
      Nothing -> pure Nothing  -- invalid JSON or old plain-text format
      Just (CachedToken token expiresAt) -> do
        now <- round <$> getPOSIXTime
        if now >= expiresAt - 60
          then pure Nothing  -- expired or within 60s of expiry
          else pure (Just token)
  ) `catch` (\(_ :: SomeException) -> pure Nothing)

writeCachedToken :: FilePath -> T.Text -> Integer -> IO ()
writeCachedToken tokenPath token expiresIn = do
  now <- round <$> getPOSIXTime
  let tokenData = object
        [ "access_token" .= token
        , "expires_at" .= (now + expiresIn)
        ]
  createDirectoryIfMissing True (takeDirectory tokenPath)
  LBS.writeFile tokenPath (encode tokenData)

-- | Fetch token endpoint from OpenID discovery document
getTokenEndpoint :: T.Text -> IO T.Text
getTokenEndpoint discoveryUrl = do
  uri <- URI.mkURI discoveryUrl
  response <- case useHttpsURI uri of
    Just (url, opts) -> runReq defaultHttpConfig $ R.req R.GET url NoReqBody jsonResponse
      (opts <> R.responseTimeout 10000000)
    Nothing
      | isLocalhost uri -> case useHttpURI uri of
          Just (url, opts) -> runReq defaultHttpConfig $ R.req R.GET url NoReqBody jsonResponse
            (opts <> R.responseTimeout 10000000)
          Nothing -> error $ "Invalid discovery URL: " <> T.unpack discoveryUrl
      | otherwise -> error $ "HTTPS required for non-localhost discovery URL: " <> T.unpack discoveryUrl
  pure $ ddTokenEndpoint (responseBody response)

newtype DiscoveryDocument = DiscoveryDocument { ddTokenEndpoint :: T.Text }

instance FromJSON DiscoveryDocument where
  parseJSON = withObject "DiscoveryDocument" $ \o ->
    DiscoveryDocument <$> o .: "token_endpoint"

fetchToken :: T.Text -> T.Text -> T.Text -> IO TokenResponse
fetchToken tokenEndpoint clientId' clientSecret' = do
  uri <- URI.mkURI tokenEndpoint
  let authHeader = R.header "Authorization" $ TE.encodeUtf8 $
        "Basic " <> B64.extractBase64 (B64.encodeBase64 $ TE.encodeUtf8 $ clientId' <> ":" <> clientSecret')
      contentType = R.header "Content-Type" "application/x-www-form-urlencoded"
      body = ReqBodyUrlEnc $ "grant_type" =: ("client_credentials" :: String)
      baseOpts = authHeader <> contentType <> R.responseTimeout 10000000
  response <- case useHttpsURI uri of
    Just (url, urlOpts) -> runReq defaultHttpConfig $ R.req R.POST url body jsonResponse (urlOpts <> baseOpts)
    Nothing
      | isLocalhost uri -> case useHttpURI uri of
          Just (url, urlOpts) -> runReq defaultHttpConfig $ R.req R.POST url body jsonResponse (urlOpts <> baseOpts)
          Nothing -> error $ "Invalid token endpoint URL: " <> T.unpack tokenEndpoint
      | otherwise -> error $ "HTTPS required for non-localhost token endpoint: " <> T.unpack tokenEndpoint
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
