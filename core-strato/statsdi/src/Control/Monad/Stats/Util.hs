module Control.Monad.Stats.Util where

import           Control.Monad.IO.Class
import           Data.Time.Clock.POSIX

getMicrotime :: (MonadIO m) => m Int
getMicrotime = posixToMicros <$> liftIO getPOSIXTime

posixToMicros :: POSIXTime -> Int
posixToMicros = round . (* 1000000.0) . toDouble

getMillitime :: (MonadIO m) => m Int
getMillitime = posixToMillis <$> liftIO getPOSIXTime

posixToMillis :: POSIXTime -> Int
posixToMillis = round . (* 1000.0) . toDouble

toDouble :: (Real n) => n -> Double
toDouble = realToFrac
