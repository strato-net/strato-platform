{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Timing where

import BlockApps.Logging
import Control.Monad
import Control.Monad.IO.Class
import qualified Data.Text as T
import Data.Time.Clock
import Data.Time.Clock.POSIX
import Prometheus
import Text.Printf

timeIt :: MonadIO m => m a -> m (NominalDiffTime, a)
timeIt f = do
  timeBefore <- liftIO getPOSIXTime
  result <- f
  timeAfter <- liftIO getPOSIXTime
  return (timeAfter - timeBefore, result)

timeit :: (MonadIO m, MonadLogger m) => String -> Maybe Gauge -> m a -> m a
timeit message timer f = do
  (diff, ret) <- timeIt f
  $logDebugS "timeit" . T.pack $ "#### " ++ message ++ " time = " ++ printf "%.4f" (realToFrac diff :: Double) ++ "s"
  liftIO $ forM_ timer (flip setGauge (realToFrac diff))
  return ret
