{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Auth.Token
  ( getToken
  , refreshToken
  , tokenFilePath
  ) where

import Control.Exception (catch, SomeException)
import Data.Aeson (FromJSON(..), withObject, (.:))
import Data.Base64.Types as B64
import Data.ByteString.Base64 as B64
import Data.Maybe (fromJust)
import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import Data.Text.Encoding as TE
import Network.HTTP.Req as R
import Strato.Auth.ClientCredentials
import System.Directory (createDirectoryIfMissing, doesFileExist)
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
      putStrLn "DEBUG TOKEN: getToken - returning cached token"
      pure token
    Nothing -> do
      putStrLn "DEBUG TOKEN: getToken - no cache, calling refreshToken"
      refreshToken discUrl

-- | Force refresh the token (call this on 401)
refreshToken :: T.Text -> IO T.Text
refreshToken discUrl = do
  putStrLn "DEBUG TOKEN: refreshToken - acquiring lock"
  withFileLock lockFilePath Exclusive $ \_ -> do
    putStrLn "DEBUG TOKEN: refreshToken - lock acquired"
    let ClientCredentialsConfig{..} = clientCredentialsConfig
    putStrLn $ "DEBUG TOKEN: refreshToken - fetching token endpoint from " ++ T.unpack discUrl
    tokenEndpoint <- getTokenEndpoint discUrl
    putStrLn $ "DEBUG TOKEN: refreshToken - got endpoint: " ++ T.unpack tokenEndpoint
    token <- fetchToken tokenEndpoint clientId clientSecret
    putStrLn "DEBUG TOKEN: refreshToken - got token, writing cache"
    writeCachedToken token
    pure token

readCachedToken :: IO (Maybe T.Text)
readCachedToken = do
  exists <- doesFileExist tokenFilePath
  if not exists
    then pure Nothing
    else (Just <$> TIO.readFile tokenFilePath) `catch` (\(_ :: SomeException) -> pure Nothing)

writeCachedToken :: T.Text -> IO ()
writeCachedToken token = do
  createDirectoryIfMissing True (takeDirectory tokenFilePath)
  TIO.writeFile tokenFilePath token

-- | Fetch token endpoint from OpenID discovery document
getTokenEndpoint :: T.Text -> IO T.Text
getTokenEndpoint discoveryUrl = do
  uri <- URI.mkURI discoveryUrl
  let (url, _) = fromJust (useHttpsURI uri)
  response <- runReq defaultHttpConfig $ R.req R.GET url NoReqBody jsonResponse mempty
  pure $ ddTokenEndpoint (responseBody response)

newtype DiscoveryDocument = DiscoveryDocument { ddTokenEndpoint :: T.Text }

instance FromJSON DiscoveryDocument where
  parseJSON = withObject "DiscoveryDocument" $ \o ->
    DiscoveryDocument <$> o .: "token_endpoint"

fetchToken :: T.Text -> T.Text -> T.Text -> IO T.Text
fetchToken tokenEndpoint clientId' clientSecret' = do
  uri <- URI.mkURI tokenEndpoint
  let (url, _) = fromJust (useHttpsURI uri)
      authHeader = R.header "Authorization" $ TE.encodeUtf8 $ 
        "Basic " <> B64.extractBase64 (B64.encodeBase64 $ TE.encodeUtf8 $ clientId' <> ":" <> clientSecret')
      contentType = R.header "Content-Type" "application/x-www-form-urlencoded"
      body = ReqBodyUrlEnc $ "grant_type" =: ("client_credentials" :: String)
  
  response <- runReq defaultHttpConfig $
    R.req R.POST url body jsonResponse (authHeader <> contentType)
  
  pure $ trAccessToken (responseBody response)

newtype TokenResponse = TokenResponse { trAccessToken :: T.Text }

instance FromJSON TokenResponse where
  parseJSON = withObject "TokenResponse" $ \o ->
    TokenResponse <$> o .: "access_token"
