{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | vm-query as a service: vm-runner's JSON-RPC commands over HTTP, executed
-- against the SQL state mirror. ethereum-jsonrpc posts a command here
-- instead of onto the consensus VM's queue; the reply is the same
-- 'JsonRpcResponse' it would have read from the queue.
--
--   POST /command   body: Binary-encoded JsonRpcCommand -> Binary-encoded JsonRpcResponse
--   GET  /health    the mirror's best block and its age
--   GET  /metrics   Prometheus
--
-- The mirror is latest-only, so a command that names another block is
-- answered with an @Error@ whose message starts with @vm-query:@, which the
-- caller treats as "ask the consensus VM instead".
module Blockchain.VmQuery.Server
  ( ServerConfig (..),
    serve,
    routable,
  )
where

import Blockchain.DB.SQLDB (SQLDB)
import Blockchain.Data.BlockHeader (BlockHeader (..))
import Blockchain.JsonRpcCommand (runJsonRpcCommand')
import Blockchain.Sequencer.Event (JsonRpcCommand (..), JsonRpcResponse (..))
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Keccak256 (keccak256ToHex)
import Blockchain.VmQuery.SqlContext
import Control.Concurrent.QSem
import Control.Exception (SomeException, bracket_, displayException, fromException, try)
import Control.Monad (void)
import qualified Data.Aeson as Aeson
import qualified Data.Binary as Bin
import Data.Default (def)
import Data.IORef
import qualified Data.Text as T
import Data.Time.Clock (UTCTime, diffUTCTime, getCurrentTime)
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import GHC.Clock (getMonotonicTimeNSec)
import Network.HTTP.Types (methodGet, methodPost, status200, status404, status405, status503)
import Network.Wai
import Network.Wai.Handler.Warp (run)
import Network.Wai.Middleware.Prometheus (prometheus)
import Prometheus
import Strato.Tracing (initTracing)
import Strato.Tracing.Wai (tracingMiddleware)

data ServerConfig = ServerConfig
  { scPort :: Int,
    -- | Commands executing at once; the rest wait, and past twice this
    -- many waiting the request is shed with 503.
    scMaxConcurrent :: Int,
    -- | How long the best block header is reused before being re-read.
    scHeaderMaxAgeSeconds :: Double
  }

{-# NOINLINE requestsTotal #-}
requestsTotal :: Vector Label2 Counter
requestsTotal = unsafeRegister . vector ("command", "outcome") . counter $ Info "vm_query_requests_total" "Commands served, by command type and outcome (ok, error, declined, shed)"

{-# NOINLINE commandSeconds #-}
commandSeconds :: Vector Label1 Histogram
commandSeconds = unsafeRegister . vector "command" . histogram (Info "vm_query_command_seconds" "Command execution time") $ [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

{-# NOINLINE inFlight #-}
inFlight :: Gauge
inFlight = unsafeRegister . gauge $ Info "vm_query_in_flight" "Commands executing now"

data BestBlock = BestBlock UTCTime (Maybe BlockHeader)

-- | Whether the mirror can answer the command: latest state only, and only
-- the read commands. Anything else is declined for the consensus VM.
routable :: JsonRpcCommand -> Maybe BlockHeader -> Either String ()
routable cmd best = case cmd of
  JRCCall {} -> Right ()
  JRCCallV2 {jrcHeader = Nothing} -> Right ()
  JRCTraceCall {jrcHeader = Nothing} -> Right ()
  JRCCallV2 {jrcHeader = Just h} -> latest h
  JRCTraceCall {jrcHeader = Just h} -> latest h
  JRCSimulate {jrcHeader = Nothing} -> Right ()
  JRCSimulate {jrcHeader = Just h} -> latest h
  JRCTraceBlockTxs {} -> Left "vm-query: block replay needs the parent state, which the mirror does not hold"
  _ -> Left "vm-query: command is not served from the mirror"
  where
    latest h = case best of
      Just b | blockHeaderHash b == blockHeaderHash h -> Right ()
      _ -> Left ("vm-query: latest state only, block " ++ show (number h) ++ " requested")

serve :: SQLDB -> ServerConfig -> IO ()
serve db cfg = do
  initTracing "vm-query"
  now <- getCurrentTime
  headerRef <- newIORef (BestBlock now Nothing)
  void $ refreshHeader db cfg headerRef
  sem <- newQSem (scMaxConcurrent cfg)
  waiting <- newIORef (0 :: Int)
  putStrLn $ "vm-query serving on port " ++ show (scPort cfg)
  run (scPort cfg) . prometheus def . tracingMiddleware "vm-query" $ app db cfg headerRef sem waiting

-- | The best header, re-read from the mirror when older than the configured age.
refreshHeader :: SQLDB -> ServerConfig -> IORef BestBlock -> IO (Maybe BlockHeader)
refreshHeader db cfg ref = do
  BestBlock at h <- readIORef ref
  now <- getCurrentTime
  if realToFrac (now `diffUTCTime` at) < scHeaderMaxAgeSeconds cfg && h /= Nothing
    then pure h
    else do
      h' <- bestHeaderFromDb db
      writeIORef ref (BestBlock now h')
      pure h'

app :: SQLDB -> ServerConfig -> IORef BestBlock -> QSem -> IORef Int -> Application
app db cfg headerRef sem waiting req respond = case (requestMethod req, pathInfo req) of
  (m, ["health"]) | m == methodGet -> do
    h <- refreshHeader db cfg headerRef
    now <- getCurrentTime
    let body = case h of
          Nothing -> Aeson.object ["ok" .= False, "reason" .= ("mirror has no blocks" :: T.Text)]
          Just hdr ->
            Aeson.object
              [ "ok" .= True,
                "bestBlock" .= number hdr,
                "bestBlockHash" .= keccak256ToHex (blockHeaderHash hdr),
                "bestBlockAgeSeconds" .= (realToFrac (now `diffUTCTime` timestamp hdr) :: Double),
                "bestBlockTimestamp" .= (realToFrac (utcTimeToPOSIXSeconds (timestamp hdr)) :: Double)
              ]
    respond $ responseLBS status200 [("Content-Type", "application/json")] (Aeson.encode body)
  (m, ["command"]) | m == methodPost -> do
    body <- strictRequestBody req
    case Bin.decodeOrFail body of
      Left (_, _, err) -> reply (Error "?" ("vm-query: undecodable command: " ++ err))
      Right (_, _, cmd) -> do
        best <- refreshHeader db cfg headerRef
        case routable cmd best of
          Left why -> do
            count cmd "declined"
            reply (Error (jrcId cmd) why)
          Right () -> do
            queued <- atomicModifyIORef' waiting (\n -> (n + 1, n + 1))
            if queued > 2 * scMaxConcurrent cfg
              then do
                void $ atomicModifyIORef' waiting (\n -> (n - 1, ()))
                count cmd "shed"
                respond $ responseLBS status503 [("Content-Type", "text/plain")] "vm-query: too many commands in flight"
              else do
                resp <- bracket_ (waitQSem sem >> incGauge inFlight) (signalQSem sem >> decGauge inFlight >> atomicModifyIORef' waiting (\n -> (n - 1, ()))) $ execute db best cmd
                count cmd (case resp of Error {} -> "error"; _ -> "ok")
                reply resp
  _ -> respond $ responseLBS (if pathInfo req `elem` [["command"], ["health"]] then status405 else status404) [] ""
  where
    reply r = respond $ responseLBS status200 [("Content-Type", "application/octet-stream")] (Bin.encode r)
    count cmd outcome = withLabel requestsTotal (commandName cmd, outcome) incCounter

-- | One command on a fresh context over the shared pool: the overlay,
-- caches and best block are per request, the code collection cache global.
execute :: SQLDB -> Maybe BlockHeader -> JsonRpcCommand -> IO JsonRpcResponse
execute db best cmd = do
  t0 <- getMonotonicTimeNSec
  env <- newSqlQueryEnvWith db best
  r <- try $ runSqlQueryM env (runJsonRpcCommand' cmd)
  t1 <- getMonotonicTimeNSec
  withLabel commandSeconds (commandName cmd) (`observe` (fromIntegral (t1 - t0) / 1e9))
  pure $ case r of
    Right resp -> resp
    Left (e :: SomeException) -> case fromException e of
      Just (TrieAccess what) -> Error (jrcId cmd) ("vm-query: trie access, not served from the mirror: " ++ what)
      Nothing -> Error (jrcId cmd) ("vm-query: internal: " ++ displayException e)

commandName :: JsonRpcCommand -> T.Text
commandName = \case
  JRCCall {} -> "call"
  JRCCallV2 {} -> "callV2"
  JRCTraceCall {} -> "traceCall"
  JRCTraceBlockTxs {} -> "traceBlockTxs"
  JRCSimulate {} -> "simulate"
  JRCGetBalance {} -> "getBalance"
  JRCGetCode {} -> "getCode"
  JRCGetTransactionCount {} -> "getTransactionCount"
  JRCGetStorageAt {} -> "getStorageAt"

(.=) :: Aeson.ToJSON v => Aeson.Key -> v -> (Aeson.Key, Aeson.Value)
k .= v = (k, Aeson.toJSON v)
