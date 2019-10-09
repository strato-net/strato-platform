{-# LANGUAGE OverloadedStrings #-}
module HTTPQuantiles (instrumentAppQuantiles) where

import Data.Ratio
import Data.Text
import Data.Text.Encoding
import Network.HTTP.Types
import Network.Wai
import Prometheus
import System.Clock

{-# NOINLINE httpQuantiles #-}
httpQuantiles :: Vector Label3 Summary
httpQuantiles = unsafeRegister
              . vector ("handler", "method", "status_code")
              . flip summary defaultQuantiles
              $ Info "http_request_duration_seconds_percentile" "Request received to response sent time, at 50%, 90%, and 99%"


instrumentAppQuantiles :: Text -> Middleware
instrumentAppQuantiles handler app req respond = do
  start <- getTime Monotonic
  app req $ \res -> do
    end <- getTime Monotonic
    let method = decodeUtf8 $ requestMethod req
    let status = pack (show (statusCode (responseStatus res)))
    let latency = fromRational $ toRational (toNanoSecs (end `diffTimeSpec` start) % 1000000000)
    withLabel httpQuantiles (handler, method, status) $ \s -> observe s latency
    respond res
