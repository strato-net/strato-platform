{-# LANGUAGE OverloadedStrings #-}

-- | The servant client the JSON-RPC server uses to reach the co-located
-- strato-api, which serves chain and state reads from Postgres.
module LocalApi
  ( apiBaseUrl,
    runLocal,
    formatClientError,
  )
where

import Blockchain.EthConf (ethConf)
import Blockchain.EthConf.Model (apiConfig, apiListenAddress, apiPort)
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T
import Network.HTTP.Client (Manager, defaultManagerSettings, newManager)
import Network.HTTP.Types.Status (statusCode, statusMessage)
import Servant.Client (BaseUrl (..), ClientError (..), ClientM, ResponseF (..), Scheme (Http), mkClientEnv, runClientM)
import System.IO.Unsafe (unsafePerformIO)

apiBaseUrl :: BaseUrl
apiBaseUrl =
  BaseUrl
    Http
    (apiListenAddress $ apiConfig ethConf)
    (apiPort $ apiConfig ethConf)
    "/eth/v1.2"

-- | A single, process-wide HTTP connection manager. An http-client 'Manager'
-- is a connection pool and is designed to be created once and shared for the
-- lifetime of the process. Creating a new one per request (as this used to do)
-- leaks keep-alive sockets to the backend until GC finalizers run, exhausting
-- file descriptors under load. NOINLINE keeps this a single CAF.
{-# NOINLINE sharedManager #-}
sharedManager :: Manager
sharedManager = unsafePerformIO $ newManager defaultManagerSettings

runLocal :: ClientM a -> IO (Either ClientError a)
runLocal action = runClientM action (mkClientEnv sharedManager apiBaseUrl)

formatClientError :: ClientError -> T.Text
formatClientError (FailureResponse _ resp) =
  let s = responseStatusCode resp
  in T.pack $ "HTTP " ++ show (statusCode s) ++ " " ++ BC.unpack (statusMessage s)
formatClientError (ConnectionError _) = "connection error"
formatClientError (DecodeFailure msg _) = "decode error: " <> msg
formatClientError _ = "request failed"
