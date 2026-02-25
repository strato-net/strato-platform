{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Strato.Auth.Client
  ( AuthEnv
  , newAuthEnv
  , runWithAuth
  ) where

import Network.HTTP.Client (Manager, newManager)
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.HTTP.Types.Status (Status(..))
import Servant.Client
import Servant.Client.Core (Request, addHeader)
import Strato.Auth.ClientCredentials
import Strato.Auth.Token

data AuthEnv = AuthEnv
  { aeBaseUrl :: BaseUrl
  , aeManager :: Manager
  }

-- | Create an authenticated environment for making OAuth-protected calls
newAuthEnv :: String -> IO AuthEnv
newAuthEnv url = do
  baseUrl <- parseBaseUrl url
  mgr <- newManager tlsManagerSettings
  pure AuthEnv
    { aeBaseUrl = baseUrl
    , aeManager = mgr
    }

-- | Run a Servant client action with OAuth authentication (retries once on 401)
runWithAuth :: AuthEnv -> ClientM a -> IO (Either ClientError a)
runWithAuth ae action = do
  result <- runOnce ae
  case result of
    Left (FailureResponse _ resp) | responseStatusCode resp == status401 -> do
      _ <- refreshToken (discoveryUrl clientCredentialsConfig)
      runOnce ae
    _ -> pure result
  where
    runOnce AuthEnv{..} = do
      token <- getToken (discoveryUrl clientCredentialsConfig)
      let addAuth :: Request -> Request
          addAuth = addHeader "Authorization" ("Bearer " <> token)
          env = (mkClientEnv aeManager aeBaseUrl) { makeClientRequest = \url req -> defaultMakeClientRequest url (addAuth req) }
      runClientM action env

status401 :: Status
status401 = Status 401 "Unauthorized"
