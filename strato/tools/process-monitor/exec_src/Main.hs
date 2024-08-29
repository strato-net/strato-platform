{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE Strict #-}
{-# LANGUAGE TupleSections #-}
{-# OPTIONS_GHC -Wall #-}

import Control.Concurrent (threadDelay)
import Control.Concurrent.Async (race_)
import Control.Monad (forever)
import Data.Foldable (traverse_)
import Data.Metrics
import Data.ProcessInfo
import Instrumentation
import Network.Wai.Middleware.Prometheus
import Network.Wai.Handler.Warp
import Prometheus
import System.Process

updateGauges :: ProcessInfo -> IO ()
updateGauges ProcessInfo{..} = do
  withLabel cpuMetric piCommand $ flip setGauge piPercentCpu
  withLabel memMetric piCommand $ flip setGauge piMemUsage

runProcessMonitoring :: IO ()
runProcessMonitoring = forever $ do
  threadDelay 1000000
  output <- readCreateProcess (shell "ps -eo %cpu,rss,cmd --sort -%cpu") ""
  traverse_ updateGauges . createProcessMap . drop 1 $ lines output

main :: IO ()
main = do
  runInstrumentation "process-monitor"
  race_ runProcessMonitoring
    . run 10778
    $ metricsApp