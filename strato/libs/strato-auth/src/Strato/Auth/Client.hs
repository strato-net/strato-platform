{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Auth.Client
  ( AuthEnv
  , newAuthEnv
  , newAuthEnvWith
  , runWithAuth
  , runWithUserToken
  ) where

import Control.Concurrent (threadDelay)
import Control.Concurrent.MVar (MVar, newMVar, modifyMVar)
import Control.Exception (SomeException, try)
import qualified Data.Map.Strict as Map
import Data.Map.Strict (Map)
import Data.Text (Text)
import Network.HTTP.Client
  ( Manager
  , ManagerSettings (..)
  , newManager
  , managerConnCount
  , managerResponseTimeout
  , responseTimeoutMicro
  )
import Network.HTTP.Client.TLS (tlsManagerSettings)
import Network.HTTP.Types.Status (Status(..))
import Servant.Client
import Servant.Client.Core (Request, addHeader)
import Strato.Auth.ClientCredentials
import Strato.Auth.Token
import System.IO (hPutStrLn, stderr)
import System.IO.Unsafe (unsafePerformIO)

data AuthEnv = AuthEnv
  { aeBaseUrl :: BaseUrl
  , aeManager :: Manager
  }

-- | Default response timeout (seconds) for AuthEnvs built via 'newAuthEnv'.
-- Callers that want a different timeout should use 'newAuthEnvWith'. Kept
-- separate so init-time callers (strato-init's 'getNodeKey', etc.) that have
-- no config in hand still get a sensible value.
defaultTimeoutSec :: Int
defaultTimeoutSec = 10

-- | Maximum total connections held by a single shared 'Manager'. http-client's
-- own default is 10 globally with a ~2 per-host effective cap, which causes
-- TLS-handshake stampedes and request queueing under load. Sized to comfortably
-- exceed the steady-state per-node concurrency we expect to see signing txs.
maxConnections :: Int
maxConnections = 100

-- | Process-wide cache of HTTP 'Manager's keyed by (base URL, timeout seconds).
--
-- IMPORTANT INVARIANT — DO NOT BREAK:
-- A 'Manager' here holds only the TCP/TLS connection pool plus timeout and
-- TLS settings. It MUST NEVER carry per-call state (Authorization headers,
-- user tokens, cookies, request modifiers). All request-scoped data must
-- live in the per-call 'ClientEnv' produced inside 'runWithAuth' /
-- 'runWithUserToken'. This is what makes a shared Manager safe across
-- concurrent users with different bearer tokens.
--
-- Lookup is single-flight under one 'MVar' so concurrent first-time callers
-- don't each construct (and leak) their own 'Manager' for the same key.
managerCache :: MVar (Map (String, Int) Manager)
{-# NOINLINE managerCache #-}
managerCache = unsafePerformIO $ newMVar Map.empty

-- | Get or create the shared 'Manager' for a given (URL, timeout) pair. The
-- URL string is used as-is for keying; callers should pass the same string
-- they pass to 'parseBaseUrl' (which is what 'newAuthEnvWith' does), so any
-- syntactic equivalent URLs (trailing slash, port-omission, etc.) that differ
-- as strings will key separate Managers. That's safe — just slightly less
-- pool-sharing than possible.
getOrCreateManager :: String -> Int -> IO Manager
getOrCreateManager url timeoutSec =
  modifyMVar managerCache $ \cache ->
    case Map.lookup (url, timeoutSec) cache of
      Just mgr -> pure (cache, mgr)
      Nothing -> do
        mgr <- newManager tlsManagerSettings
          { managerResponseTimeout = responseTimeoutMicro (timeoutSec * 1000000)
          , managerConnCount = maxConnections
          }
        pure (Map.insert (url, timeoutSec) mgr cache, mgr)

-- | Create an authenticated environment for making OAuth-protected calls.
-- Uses the shared per-URL 'Manager' cache and the default timeout.
newAuthEnv :: String -> IO AuthEnv
newAuthEnv = newAuthEnvWith defaultTimeoutSec

-- | Like 'newAuthEnv' but with an explicit HTTP response timeout in seconds.
-- Used by hot-path callers (transaction signing) that should read the
-- configured value from EthConf instead of relying on the default.
newAuthEnvWith :: Int -> String -> IO AuthEnv
newAuthEnvWith timeoutSec url = do
  baseUrl <- parseBaseUrl url
  mgr <- getOrCreateManager url timeoutSec
  pure AuthEnv
    { aeBaseUrl = baseUrl
    , aeManager = mgr
    }

-- | Retry on 'ConnectionError' (i.e. anything thrown as a transport-level
-- error: TCP timeouts, TLS handshake failures, premature socket close, etc).
-- 4 attempts total; sleeps 1s, 2s, 4s between attempts. The cap of 8s exists
-- so a future bump in 'maxAttempts' doesn't accidentally produce very long
-- waits — at the current 4 attempts the cap is non-binding.
withConnectionRetry :: String -> IO (Either ClientError a) -> IO (Either ClientError a)
withConnectionRetry label go = loop (1 :: Int)
  where
    maxAttempts = 4 :: Int

    loop attempt = do
      result <- try go
      case joinResult result of
        Left (ConnectionError e)
          | attempt < maxAttempts -> do
              let delaySec = min 8 (2 ^ (attempt - 1) :: Int)
              hPutStrLn stderr $
                label ++ ": attempt " ++ show attempt ++ "/" ++ show maxAttempts ++
                " failed (" ++ show e ++ "), retrying in " ++ show delaySec ++ "s"
              threadDelay (delaySec * 1000000)
              loop (attempt + 1)
        r -> return r

    joinResult :: Either SomeException (Either ClientError a) -> Either ClientError a
    joinResult (Left e)  = Left (ConnectionError e)
    joinResult (Right r) = r

-- | Run a Servant client action with OAuth authentication.
--
-- Retries on 401 (with token refresh) and on connection errors
-- (up to 4 attempts with exponential backoff: 1s, 2s, 4s).
runWithAuth :: AuthEnv -> ClientM a -> IO (Either ClientError a)
runWithAuth ae action = withConnectionRetry "Vault request" doRequestWith401Retry
  where
    doRequestWith401Retry = do
      result <- runOnce ae
      case result of
        Left (FailureResponse _ resp) | responseStatusCode resp == status401 -> do
          _ <- refreshToken (discoveryUrl clientCredentialsConfig)
          runOnce ae
        _ -> pure result

    runOnce AuthEnv{..} = do
      token <- getToken (discoveryUrl clientCredentialsConfig)
      let addAuth :: Request -> Request
          addAuth = addHeader "Authorization" ("Bearer " <> token)
          env = (mkClientEnv aeManager aeBaseUrl) { makeClientRequest = \url req -> defaultMakeClientRequest url (addAuth req) }
      runClientM action env

status401 :: Status
status401 = Status 401 "Unauthorized"

-- | Run a Servant client action with a user-provided token (no node
-- credentials). Retries on connection errors with the same policy as
-- 'runWithAuth' (4 attempts, 1s/2s/4s backoff). The bearer token lives only
-- inside this call's 'ClientEnv' closure — never on the shared 'Manager' —
-- so the per-URL pool can be reused across concurrent users safely.
runWithUserToken :: AuthEnv -> Text -> ClientM a -> IO (Either ClientError a)
runWithUserToken AuthEnv{..} token action =
  withConnectionRetry "Vault user-token request" $ do
    let addAuth :: Request -> Request
        addAuth = addHeader "Authorization" ("Bearer " <> token)
        env = (mkClientEnv aeManager aeBaseUrl) { makeClientRequest = \url req -> defaultMakeClientRequest url (addAuth req) }
    runClientM action env
