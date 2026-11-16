{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Minimal OpenTelemetry tracing.
--
-- Two kinds of trace run through STRATO:
--
-- * __Request traces__ start at the load balancer (its @X-Amzn-Trace-Id@),
--   pass through nginx as W3C @traceparent@, and continue in strato-api,
--   ethereum-jsonrpc and app-backend as server spans
--   ('Strato.Tracing.Wai.tracingMiddleware').
--
-- * __Transaction traces__ follow a transaction from submit to inclusion.
--   No header could carry them (the core's broker client has none), so the
--   trace id is derived from the transaction hash ('traceIdFromHash'): every
--   stage that knows the hash (API submit, ingest forward, result egress)
--   records its span into the same trace without coordination, and the
--   submit span links to the request trace it came from.
--
-- Spans are queued and shipped as OTLP/JSON to @$OTEL_EXPORTER_OTLP_ENDPOINT@
-- (the ADOT sidecar or cell collector on localhost:4318). Unset, everything
-- here is a no-op, so processes pay nothing outside an instrumented
-- deployment.
module Strato.Tracing
  ( TraceContext (..),
    SpanKind (..),
    AttrValue (..),
    Attr,
    initTracing,
    tracingEnabled,
    parseTraceparent,
    parseAmznTraceId,
    renderTraceparent,
    traceIdFromHash,
    newSpanId,
    nowNanos,
    recordSpan,
    withSpan,
    withRequestContext,
    currentRequestContext,
    attrText,
    attrInt,
    attrBool,
    -- * Exposed for the benchmark
    SpanRecord (..),
    otlpPayload,
  )
where

import Control.Concurrent (ThreadId, forkIO, myThreadId, threadDelay)
import Control.Concurrent.STM
import Control.Exception (SomeException, bracket_, displayException, throwIO, try)
import Control.Monad (forever, unless, void, when)
import Data.Aeson (Value (..), object, (.=))
import qualified Data.Aeson as Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Char (isHexDigit)
import Data.IORef
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe, isJust, mapMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Time.Clock.POSIX (getPOSIXTime)
import Data.Word (Word64)
import Network.HTTP.Client
import Network.HTTP.Types (hContentType)
import Numeric (showHex)
import System.Environment (lookupEnv)
import System.IO (hPutStrLn, stderr)
import System.IO.Unsafe (unsafePerformIO)
import System.Random (randomIO)

-- | A position in a trace: the trace id (32 hex) and the current span id
-- (16 hex), both lowercase.
data TraceContext = TraceContext
  { traceId :: !Text,
    spanId :: !Text
  }
  deriving (Eq, Show)

data SpanKind = Internal | Server | Client | Producer | Consumer
  deriving (Eq, Show)

data AttrValue = AttrString Text | AttrInt Integer | AttrBool Bool
  deriving (Eq, Show)

type Attr = (Text, AttrValue)

attrText :: Text -> Text -> Attr
attrText k v = (k, AttrString v)

attrInt :: Integral a => Text -> a -> Attr
attrInt k v = (k, AttrInt (toInteger v))

attrBool :: Text -> Bool -> Attr
attrBool k v = (k, AttrBool v)

data SpanRecord = SpanRecord
  { srTraceId :: !Text,
    srSpanId :: !Text,
    srParentId :: !(Maybe Text),
    srName :: !Text,
    srKind :: !SpanKind,
    srStart :: !Integer,
    srEnd :: !Integer,
    srAttrs :: ![Attr],
    srLinks :: ![TraceContext],
    srError :: !(Maybe Text)
  }

data Tracer = Tracer
  { tService :: !Text,
    tEndpoint :: !String,
    tQueue :: !(TBQueue SpanRecord),
    tManager :: !Manager
  }

{-# NOINLINE tracerRef #-}
tracerRef :: IORef (Maybe Tracer)
tracerRef = unsafePerformIO $ newIORef Nothing

-- | Start the exporter if @OTEL_EXPORTER_OTLP_ENDPOINT@ is set. The service
-- name is the process name unless @OTEL_SERVICE_NAME@ overrides it. Call
-- once at process start; calling it again is harmless.
initTracing :: Text -> IO ()
initTracing defaultService = do
  existing <- readIORef tracerRef
  mEndpoint <- lookupEnv "OTEL_EXPORTER_OTLP_ENDPOINT"
  case (existing, mEndpoint) of
    (Nothing, Just endpoint) | not (null endpoint) -> do
      service <- maybe defaultService T.pack <$> lookupEnv "OTEL_SERVICE_NAME"
      -- Burst capacity. A span record is a few hundred bytes, so even a full
      -- queue is a few megabytes; when the collector cannot keep up, spans
      -- are dropped rather than the queue growing.
      queue <- newTBQueueIO 8192
      manager <- newManager defaultManagerSettings {managerResponseTimeout = responseTimeoutMicro 5000000}
      let tracer = Tracer service (stripSlash endpoint) queue manager
      writeIORef tracerRef (Just tracer)
      void . forkIO $ exportLoop tracer
      hPutStrLn stderr $ "tracing: exporting spans for " ++ T.unpack service ++ " to " ++ endpoint
    _ -> pure ()
  where
    stripSlash = reverse . dropWhile (== '/') . reverse

tracingEnabled :: IO Bool
tracingEnabled = isJust <$> readIORef tracerRef

-- | Ships batches of up to 512 spans: back to back while the queue keeps
-- filling whole batches, and once a second otherwise, so the ceiling is
-- the serialisation and the collector, not a timer. Export failures are
-- logged at most once a minute and the batch is dropped: tracing must never
-- back up the process it observes.
exportLoop :: Tracer -> IO ()
exportLoop tracer = do
  lastLogged <- newIORef (0 :: Integer)
  forever $ do
    batch <- atomically $ drain batchSize
    if null batch
      then threadDelay 1000000
      else do
        r <- try $ post batch
        case r of
          Right () -> pure ()
          Left (e :: SomeException) -> do
            now <- nowNanos
            prev <- readIORef lastLogged
            when (now - prev > 60000000000) $ do
              writeIORef lastLogged now
              hPutStrLn stderr $ "tracing: export failed, dropping " ++ show (length batch) ++ " span(s): " ++ displayException e
        when (length batch < batchSize) $ threadDelay 1000000
  where
    batchSize = 512
    drain :: Int -> STM [SpanRecord]
    drain 0 = pure []
    drain n = do
      m <- tryReadTBQueue (tQueue tracer)
      case m of
        Nothing -> pure []
        Just s -> (s :) <$> drain (n - 1)
    post batch = do
      initial <- parseRequest (tEndpoint tracer ++ "/v1/traces")
      let req =
            initial
              { method = "POST",
                requestHeaders = [(hContentType, "application/json")],
                requestBody = RequestBodyLBS (Aeson.encode (otlpPayload (tService tracer) batch))
              }
      resp <- httpNoBody req tManager'
      let code = fromEnum (responseStatus resp)
      when (code < 200 || code >= 300) $ throwIO (userError ("collector returned HTTP " ++ show code))
    tManager' = tManager tracer

enqueue :: SpanRecord -> IO ()
enqueue s = do
  m <- readIORef tracerRef
  case m of
    Nothing -> pure ()
    Just tracer -> atomically $ do
      full <- isFullTBQueue (tQueue tracer)
      unless full $ writeTBQueue (tQueue tracer) s

-- --- Ids and propagation ---

-- | @traceparent: 00-<32 hex>-<16 hex>-<2 hex flags>@.
parseTraceparent :: B.ByteString -> Maybe TraceContext
parseTraceparent raw =
  case BC.split '-' (BC.strip raw) of
    [ver, tid, sid, _flags]
      | BC.length ver == 2 && hexOf 32 tid && hexOf 16 sid && tid /= BC.replicate 32 '0' && sid /= BC.replicate 16 '0' ->
          Just (TraceContext (lowerHex tid) (lowerHex sid))
    _ -> Nothing

-- | @X-Amzn-Trace-Id: Root=1-<8 hex epoch>-<24 hex>;Parent=<16 hex>;Sampled=1@,
-- as the load balancer sets it. The root becomes the trace id (its 32 hex
-- digits are what X-Ray expects back); the parent, if any, the parent span.
parseAmznTraceId :: B.ByteString -> Maybe TraceContext
parseAmznTraceId raw = do
  let fields = Map.fromList $ mapMaybe kv (BC.split ';' (BC.strip raw))
  root <- Map.lookup "Root" fields
  tid <- case BC.split '-' root of
    ["1", epoch, rest] | hexOf 8 epoch && hexOf 24 rest -> Just (lowerHex (epoch <> rest))
    _ -> Nothing
  let parent = case Map.lookup "Parent" fields of
        Just p | hexOf 16 p -> lowerHex p
        _ -> T.replicate 16 "0"
  pure (TraceContext tid parent)
  where
    kv f = case BC.break (== '=') f of
      (k, v) | not (B.null v) -> Just (BC.strip k, BC.strip (B.drop 1 v))
      _ -> Nothing

hexOf :: Int -> B.ByteString -> Bool
hexOf n s = B.length s == n && BC.all isHexDigit s

lowerHex :: B.ByteString -> Text
lowerHex = T.toLower . TE.decodeUtf8

renderTraceparent :: TraceContext -> B.ByteString
renderTraceparent (TraceContext tid sid) = "00-" <> TE.encodeUtf8 tid <> "-" <> TE.encodeUtf8 sid <> "-01"

-- | The trace id of a transaction: the first 16 bytes of its hash. Every
-- stage derives the same id from the hash alone.
traceIdFromHash :: B.ByteString -> Text
traceIdFromHash h = TE.decodeUtf8 . B16.encode $ B.take 16 (h <> B.replicate 16 0)

newSpanId :: IO Text
newSpanId = do
  w <- randomIO :: IO Word64
  let hex = showHex (max 1 w) ""
  pure . T.pack $ replicate (16 - length hex) '0' ++ hex

nowNanos :: IO Integer
nowNanos = round . (* 1000000000) <$> getPOSIXTime

-- --- Recording ---

-- | A span whose timing is already known (a stage that happened, or one
-- that is being marked at the instant it completes).
recordSpan ::
  Text -> Maybe Text -> Text -> SpanKind -> Integer -> Integer -> [Attr] -> [TraceContext] -> Maybe Text -> IO ()
recordSpan tid parent name kind start end attrs links err = do
  sid <- newSpanId
  enqueue (SpanRecord tid sid parent name kind start end attrs links err)

-- | Run an action inside a new span under @parent@ (a fresh trace when
-- Nothing). The action receives its own context to propagate or nest
-- under. An exception marks the span failed and is rethrown.
withSpan :: Maybe TraceContext -> Text -> SpanKind -> [Attr] -> (TraceContext -> IO a) -> IO a
withSpan parent name kind attrs act = do
  enabled <- tracingEnabled
  if not enabled
    then act (fromMaybe (TraceContext (T.replicate 32 "0") (T.replicate 16 "0")) parent)
    else do
      tid <- maybe (traceIdFromRandom) (pure . traceId) parent
      sid <- newSpanId
      start <- nowNanos
      r <- try (act (TraceContext tid sid))
      end <- nowNanos
      let (err, out) = case r of
            Left (e :: SomeException) -> (Just (T.pack (displayException e)), Left e)
            Right v -> (Nothing, Right v)
      enqueue (SpanRecord tid sid (spanId <$> parent) name kind start end attrs [] err)
      either throwIO pure out
  where
    traceIdFromRandom = do
      a <- newSpanId
      b <- newSpanId
      pure (a <> b)

-- --- Request-scoped context ---
-- Warp (and Servant under it) runs each request in its own thread, so the
-- request's context is kept by thread id for code deeper in the handler
-- (the transaction submit path) to link to.

{-# NOINLINE requestContexts #-}
requestContexts :: IORef (Map.Map ThreadId TraceContext)
requestContexts = unsafePerformIO $ newIORef Map.empty

withRequestContext :: TraceContext -> IO a -> IO a
withRequestContext ctx act = do
  tid <- myThreadId
  bracket_ (atomicModifyIORef' requestContexts (\m -> (Map.insert tid ctx m, ()))) (atomicModifyIORef' requestContexts (\m -> (Map.delete tid m, ()))) act

currentRequestContext :: IO (Maybe TraceContext)
currentRequestContext = do
  tid <- myThreadId
  Map.lookup tid <$> readIORef requestContexts

-- --- OTLP/JSON ---

otlpPayload :: Text -> [SpanRecord] -> Value
otlpPayload service spans =
  object
    [ "resourceSpans"
        .= [ object
               [ "resource" .= object ["attributes" .= [attrJson (attrText "service.name" service)]],
                 "scopeSpans" .= [object ["scope" .= object ["name" .= ("strato-tracing" :: Text)], "spans" .= map spanJson spans]]
               ]
           ]
    ]

spanJson :: SpanRecord -> Value
spanJson s =
  object $
    [ "traceId" .= srTraceId s,
      "spanId" .= srSpanId s,
      "name" .= srName s,
      "kind" .= kindCode (srKind s),
      "startTimeUnixNano" .= show (srStart s),
      "endTimeUnixNano" .= show (max (srStart s) (srEnd s)),
      "attributes" .= map attrJson (srAttrs s),
      "links" .= [object ["traceId" .= traceId l, "spanId" .= spanId l] | l <- srLinks s],
      "status" .= maybe (object ["code" .= (0 :: Int)]) (\m -> object ["code" .= (2 :: Int), "message" .= m]) (srError s)
    ]
      ++ maybe [] (\p -> ["parentSpanId" .= p]) (srParentId s)
  where
    kindCode :: SpanKind -> Int
    kindCode Internal = 1
    kindCode Server = 2
    kindCode Client = 3
    kindCode Producer = 4
    kindCode Consumer = 5

attrJson :: Attr -> Value
attrJson (k, v) = object ["key" .= k, "value" .= valueJson v]
  where
    valueJson (AttrString t) = object ["stringValue" .= t]
    valueJson (AttrInt i) = object ["intValue" .= show i]
    valueJson (AttrBool b) = object ["boolValue" .= b]
