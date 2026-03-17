{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Strato.Auth.Client
  ( AuthEnv
  , newAuthEnv
  , runWithAuth
  , runWithUserToken
  ) where

import Data.Text (Text)
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
  putStrLn "DEBUG AUTH: runWithAuth starting, calling runOnce"
  result <- runOnce ae
  putStrLn $ "DEBUG AUTH: runOnce returned: " ++ either (const "Left (error)") (const "Right (success)") result
  case result of
    Left (FailureResponse _ resp) | responseStatusCode resp == status401 -> do
      putStrLn "DEBUG AUTH: Got 401, calling refreshToken"
      _ <- refreshToken (discoveryUrl clientCredentialsConfig)
      putStrLn "DEBUG AUTH: refreshToken done, retrying runOnce"
      runOnce ae
    _ -> pure result
  where
    runOnce AuthEnv{..} = do
      putStrLn "DEBUG AUTH: runOnce - calling getToken"
      token <- getToken (discoveryUrl clientCredentialsConfig)
      putStrLn "DEBUG AUTH: runOnce - got token, making Vault request"
      let addAuth :: Request -> Request
          addAuth = addHeader "Authorization" ("Bearer " <> token)
          env = (mkClientEnv aeManager aeBaseUrl) { makeClientRequest = \url req -> defaultMakeClientRequest url (addAuth req) }
      runClientM action env

status401 :: Status
status401 = Status 401 "Unauthorized"

-- | Run a Servant client action with a user-provided token (no node credentials)
runWithUserToken :: AuthEnv -> Text -> ClientM a -> IO (Either ClientError a)
runWithUserToken AuthEnv{..} token action = do
  let addAuth :: Request -> Request
      addAuth = addHeader "Authorization" ("Bearer " <> token)
      env = (mkClientEnv aeManager aeBaseUrl) { makeClientRequest = \url req -> defaultMakeClientRequest url (addAuth req) }
  runClientM action env
