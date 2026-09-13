{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | What tracing costs the process that records spans, measured on the
-- exact shape vm-runner records per transaction (Blockchain.BlockChain
-- .recordExecuteSpan): five attributes including a hex-encoded hash.
--
-- Three numbers matter:
--   1. the disabled path (tracing off, the mainnet default), per call;
--   2. the enabled path in the recording thread, per call: a clock read,
--      the attribute list, and one STM queue write;
--   3. the exporter ceiling: spans per second it can serialize and ship
--      to a local collector, above which spans are dropped.
--
-- Run: stack bench strato-tracing --ba '--time-limit 3'
--      THROUGHPUT=1 stack bench strato-tracing   (throughput run only)
module Main (main) where

import Control.Concurrent (forkIO, threadDelay)
import Control.Concurrent.STM
import Control.Monad (forM_, replicateM_, when)
import Criterion.Main
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import qualified Data.Text as T
import Network.HTTP.Types (status200)
import Network.Wai (responseLBS, strictRequestBody)
import Network.Wai.Handler.Warp (run)
import Strato.Tracing
import System.Environment (lookupEnv, setEnv)
import GHC.Clock (getMonotonicTimeNSec)

-- The hash a transaction span is keyed by; 32 bytes as in the VM.
txHash :: B.ByteString
txHash = B.pack [fromIntegral i * 7 | i <- [0 .. 31 :: Int]]

hexHash :: T.Text
hexHash = T.pack $ concatMap (\w -> let h = "0123456789abcdef" in [h !! fromIntegral (w `div` 16), h !! fromIntegral (w `mod` 16)]) (B.unpack txHash)

-- vm-runner's recordExecuteSpan, verbatim in shape.
recordExecute :: Integer -> Maybe String -> IO ()
recordExecute started err = do
  enabled <- tracingEnabled
  when enabled $ do
    end <- nowNanos
    recordSpan (traceIdFromHash txHash) Nothing "tx.execute" Internal started end
      ( [ attrText "strato.tx_hash" hexHash,
          attrText "strato.stage" "vm-runner",
          attrInt "strato.block_number" (512345 :: Int),
          attrInt "strato.gas_used" (400000 - 371234 :: Int)
        ]
          ++ maybe [] (\a -> [attrText "strato.contract_created" (T.pack a)]) (Nothing :: Maybe String)
      )
      []
      (T.pack <$> err)

sampleRecord :: SpanRecord
sampleRecord =
  SpanRecord (traceIdFromHash txHash) "0123456789abcdef" Nothing "tx.execute" Internal 1700000000000000000 1700000000002000000
    [attrText "strato.tx_hash" hexHash, attrText "strato.stage" "vm-runner", attrInt "strato.block_number" (512345 :: Int), attrInt "strato.gas_used" (28766 :: Int)]
    [] Nothing

-- | A collector stand-in on localhost that counts the spans it receives.
startSink :: Int -> IO (TVar Int)
startSink port = do
  received <- newTVarIO 0
  _ <- forkIO $ run port $ \req respond -> do
    body <- strictRequestBody req
    let n = case Aeson.decode body :: Maybe Aeson.Value of
          Just v -> countSpans v
          Nothing -> 0
    atomically $ modifyTVar' received (+ n)
    respond $ responseLBS status200 [] ""
  threadDelay 200000
  pure received
  where
    countSpans v = case v of
      Aeson.Object o -> case KM.lookup "resourceSpans" o of
        Just (Aeson.Array rs) -> sum [scopeCount r | r <- foldr (:) [] rs]
        _ -> 0
      _ -> 0
    scopeCount (Aeson.Object r) = case KM.lookup "scopeSpans" r of
      Just (Aeson.Array ss) -> sum [spanCount s | s <- foldr (:) [] ss]
      _ -> 0
    scopeCount _ = 0
    spanCount (Aeson.Object s) = case KM.lookup "spans" s of
      Just (Aeson.Array xs) -> length xs
      _ -> 0
    spanCount _ = 0

-- | Enqueue @total@ spans at @rate@ per second and report how many the
-- sink received within the deadline: the exporter's real ceiling, drops
-- included.
throughputRun :: TVar Int -> Int -> Int -> IO ()
throughputRun received rate total = do
  atomically $ writeTVar received 0
  t0 <- getMonotonicTimeNSec
  let perTick = max 1 (rate `div` 100) -- 10 ms ticks
      ticks = total `div` perTick
  forM_ [1 .. ticks] $ \_ -> do
    replicateM_ perTick $ recordExecute 1700000000000000000 Nothing
    threadDelay 10000
  t1 <- getMonotonicTimeNSec
  -- give the exporter up to 15 s to drain
  let waitLoop n = do
        got <- readTVarIO received
        if got >= total || n <= 0 then pure got else threadDelay 250000 >> waitLoop (n - 1 :: Int)
  got <- waitLoop 60
  t2 <- getMonotonicTimeNSec
  let sent = ticks * perTick
      secs x y = fromIntegral (y - x) / 1e9 :: Double
  putStrLn $
    "rate " ++ show rate ++ "/s: enqueued " ++ show sent ++ " in " ++ show (secs t0 t1) ++ "s, delivered " ++ show got
      ++ " (" ++ show (round (100 * fromIntegral got / fromIntegral sent :: Double) :: Int) ++ "%) after " ++ show (secs t0 t2) ++ "s"
      ++ if got < sent then "  <- DROPPED " ++ show (sent - got) else ""

main :: IO ()
main = do
  throughputOnly <- (== Just "1") <$> lookupEnv "THROUGHPUT"
  -- 1. Disabled path: tracer never initialised.
  if throughputOnly then pure () else
    defaultMain
      [ bgroup "disabled"
          [ bench "recordExecute (tracing off)" $ whnfIO (recordExecute 1700000000000000000 Nothing)
          ]
      ]
  -- 2. Enabled path and 3. exporter ceiling, against a local sink.
  received <- startSink 44319
  setEnv "OTEL_EXPORTER_OTLP_ENDPOINT" "http://127.0.0.1:44319"
  initTracing "tracing-bench"
  if throughputOnly then pure () else
    defaultMain
      [ bgroup "enabled"
          [ bench "recordExecute (success)" $ whnfIO (recordExecute 1700000000000000000 Nothing),
            bench "recordExecute (with exception text)" $ whnfIO (recordExecute 1700000000000000000 (Just "RevertError \"insufficient balance\"")),
            bench "nowNanos" $ whnfIO nowNanos,
            bench "encode 512-span batch" $ nf (BL.length . Aeson.encode . otlpPayload "vm-runner") (replicate 512 sampleRecord)
          ]
      ]
  putStrLn "\nExporter ceiling (spans enqueued at a steady rate for ~10 s, delivered to a local sink):"
  forM_ [500, 2000, 5000, 10000, 20000, 40000] $ \rate -> throughputRun received rate (rate * 10)
  BC.putStrLn ""
