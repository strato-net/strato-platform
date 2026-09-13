{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | A server span per request for WAI applications, continuing the trace
-- nginx propagated (or the load balancer's, or a new one).
module Strato.Tracing.Wai
  ( tracingMiddleware,
    requestTraceContext,
  )
where

import Control.Exception (SomeException, throwIO, try)
import Data.IORef
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Network.HTTP.Types (statusCode)
import Network.Wai
import Strato.Tracing

-- | The incoming trace position, from @traceparent@ first and the load
-- balancer's @X-Amzn-Trace-Id@ second.
requestTraceContext :: Request -> Maybe TraceContext
requestTraceContext req =
  case lookup "traceparent" (requestHeaders req) >>= parseTraceparent of
    Just c -> Just c
    Nothing -> lookup "x-amzn-trace-id" (requestHeaders req) >>= parseAmznTraceId

-- | Wraps the application in a server span named by method and path, with
-- the usual HTTP attributes, and keeps the request's context available to
-- the handler thread through 'currentRequestContext'. A no-op when tracing
-- is not enabled.
tracingMiddleware :: Text -> Middleware
tracingMiddleware service app req respond = do
  enabled <- tracingEnabled
  if not enabled
    then app req respond
    else do
      let parent = requestTraceContext req
          name = TE.decodeUtf8 (requestMethod req) <> " " <> TE.decodeUtf8 (rawPathInfo req)
      statusRef <- newIORef Nothing
      let attrs =
            [ attrText "http.method" (TE.decodeUtf8 (requestMethod req)),
              attrText "http.target" (TE.decodeUtf8 (rawPathInfo req <> rawQueryString req)),
              attrText "service.instance" service,
              attrText "net.peer" (T.pack (show (remoteHost req)))
            ]
      r <- try $ withSpan parent name Server attrs $ \ctx ->
        withRequestContext ctx $
          app req $ \resp -> do
            writeIORef statusRef (Just (statusCode (responseStatus resp)))
            respond resp
      status <- readIORef statusRef
      case r of
        Right received -> do
          recordStatus parent status
          pure received
        Left (e :: SomeException) -> throwIO e
  where
    -- withSpan has already recorded the span; the status code arrives too
    -- late to be an attribute of it, so 5xx responses get their own marker
    -- event, which is what the alert rules key on anyway.
    recordStatus parent status = do
      let code = fromMaybe 0 status
      if code >= 500
        then do
          now <- nowNanos
          recordSpan (maybe "" traceId parent) Nothing "http.server_error" Internal now now [attrInt "http.status_code" code] [] (Just (T.pack ("HTTP " ++ show code)))
        else pure ()
