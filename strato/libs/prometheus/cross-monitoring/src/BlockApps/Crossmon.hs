{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Crossmon (recordMaxBlockNumber, initializeHealthChecks) where

import Control.Monad
import Control.Monad.IO.Class
import Data.Text
import Prometheus

{-# NOINLINE maxBlockNumberSeen #-}
maxBlockNumberSeen :: Vector Text Gauge
maxBlockNumberSeen =
  unsafeRegister
    . vector "location"
    . gauge
    $ Info
      "max_block_number_seen"
      "Maximum of block numbers seen. This is most useful in\
      \ consensus algorithms with a linear sequence of blocks"

healthCheck :: Vector Text Gauge
healthCheck =
  unsafeRegister
    . vector "location"
    . gauge
    $ Info
      "health_check"
      "Check if processes are running in the last 1 minute"

reportOne :: Integer
reportOne = 1

initializeHealthChecks :: (MonadIO m) => Text -> m ()
initializeHealthChecks label = liftIO $ withLabel healthCheck label (flip setGauge . fromIntegral $ reportOne)

-- Note: This function is not threadsafe across locations:
--   recordMaxBlockNumber l1 n | recordMaxBlockNumber l1 m
-- is nondeterministic in deciding whether to keep n or m.
recordMaxBlockNumber :: (MonadIO m, Integral a) => Text -> a -> m ()
recordMaxBlockNumber loc n = liftIO $ do
  withLabel maxBlockNumberSeen loc $ \g -> do
    let new = fromIntegral n
    current <- getGauge g
    when (new > current) $ setGauge g new
