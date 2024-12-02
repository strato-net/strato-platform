{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

-- all OAuth-related data types and functions go here
module IdentityProvider.OAuth where

import Control.Monad.IO.Class
import Data.Aeson
import Data.ByteString.Base64
import qualified Data.ByteString.UTF8 as B (fromString)
import Data.List (isSuffixOf)
import Data.List.Split (splitOn)
import Data.Text (Text)
import GHC.Generics
import Network.HTTP.Client
import Network.HTTP.Client.TLS
import Network.HTTP.Types.Header (hAuthorization, hContentType)

data OAuthEndpoints = OAuthEndpoints
  { issuer :: String,
    token_endpoint :: String
  }
  deriving (Show, Generic, ToJSON, FromJSON)


--TODO: make this return an Either
getEndpointsFromDiscovery :: MonadIO m => String -> m OAuthEndpoints
getEndpointsFromDiscovery url = do
  discoveryRequest <- liftIO $ parseRequest url
  manager <- liftIO $ newManager tlsManagerSettings
  response <- liftIO $ httpLbs discoveryRequest manager
  either error return (eitherDecode $ responseBody response)

extractRealmName :: String -> String
extractRealmName idProv = last $ splitOn "/" (if "/" `isSuffixOf` idProv then init idProv else idProv)

data AccessToken = AccessToken
  { access_token :: Text,
    expires_in :: Integer
  }
  deriving (Show, Generic, ToJSON, FromJSON)

getAccessToken :: MonadIO m => String -> String -> String -> m (Maybe AccessToken)
getAccessToken id' sec tokenEndpoint = do
  manager <- liftIO $ newManager tlsManagerSettings
  let creds64 = encodeBase64' . B.fromString $ id' <> ":" <> sec
  templateRequest <- liftIO $ parseRequest tokenEndpoint
  let rBody = RequestBodyLBS "grant_type=client_credentials"
      rHead = [(hContentType, "application/x-www-form-urlencoded"), (hAuthorization, "Basic " <> creds64)]
      request = templateRequest {requestHeaders = rHead, requestBody = rBody, method = "POST"}
  response <- liftIO $ httpLbs request manager
  return $ decode $ responseBody response