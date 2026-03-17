{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Auth.Client
  ( AuthEnv
  , newAuthEnv
  , runWithAuth
  , runWithUserToken
  ) where

import Control.Concurrent (threadDelay)
import Control.Exception (SomeException, try)
import Data.Text (Text)
import Network.HTTP.Client (Manager, newManager, managerResponseTimeout, responseTimeoutMicro)
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.HTTP.Types.Status (Status(..))
import Servant.Client
import Servant.Client.Core (Request, addHeader)
import Strato.Auth.ClientCredentials
import Strato.Auth.Token
import System.IO (hPutStrLn, stderr, hFlush)

data AuthEnv = AuthEnv
  { aeBaseUrl :: BaseUrl
  , aeManager :: Manager
  }

-- | Create an authenticated environment for making OAuth-protected calls
newAuthEnv :: String -> IO AuthEnv
newAuthEnv url = do
  baseUrl <- parseBaseUrl url
  mgr <- newManager tlsManagerSettings
    { managerResponseTimeout = responseTimeoutMicro 10000000 -- 10 seconds
    }
  pure AuthEnv
    { aeBaseUrl = baseUrl
    , aeManager = mgr
    }

-- | Run a Servant client action with OAuth authentication.
--
-- Retries on 401 (with token refresh) and on connection errors
-- (up to 4 attempts with exponential backoff: 1s, 2s, 4s).
runWithAuth :: AuthEnv -> ClientM a -> IO (Either ClientError a)
runWithAuth ae action = do
  hPutStrLn stderr "DEBUG AUTH: runWithAuth starting" >> hFlush stderr
  withConnectionRetry (1 :: Int)
  where
    maxAttempts = 4 :: Int

    withConnectionRetry attempt = do
      result <- try $ doRequestWith401Retry
      case joinResult result of
        Left (ConnectionError e)
          | attempt < maxAttempts -> do
              let delaySec = min 30 (2 ^ (attempt - 1) :: Int)
              hPutStrLn stderr $
                "Vault request: attempt " ++ show attempt ++ "/" ++ show maxAttempts ++
                " failed (" ++ show e ++ "), retrying in " ++ show delaySec ++ "s"
              threadDelay (delaySec * 1000000)
              withConnectionRetry (attempt + 1)
        r -> do
          hPutStrLn stderr ("DEBUG AUTH: final result: " ++ either (const "Left (error)") (const "Right (success)") r) >> hFlush stderr
          return r

    -- Collapse exceptions from try into ConnectionError
    joinResult :: Either SomeException (Either ClientError a) -> Either ClientError a
    joinResult (Left e) = Left (ConnectionError e)
    joinResult (Right r) = r

    doRequestWith401Retry = do
      hPutStrLn stderr "DEBUG AUTH: doRequestWith401Retry - calling runOnce" >> hFlush stderr
      result <- runOnce ae
      case result of
        Left (FailureResponse _ resp) | responseStatusCode resp == status401 -> do
          hPutStrLn stderr "DEBUG AUTH: Got 401, calling refreshToken" >> hFlush stderr
          _ <- refreshToken (discoveryUrl clientCredentialsConfig)
          hPutStrLn stderr "DEBUG AUTH: refreshToken done, retrying" >> hFlush stderr
          runOnce ae
        _ -> pure result

    runOnce AuthEnv{..} = do
      hPutStrLn stderr "DEBUG AUTH: runOnce - calling getToken" >> hFlush stderr
      token <- getToken (discoveryUrl clientCredentialsConfig)
      hPutStrLn stderr "DEBUG AUTH: runOnce - got token, making Vault request" >> hFlush stderr
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
