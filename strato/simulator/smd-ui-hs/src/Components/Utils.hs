{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Components.Utils where

import Reflex.Dom
import Control.Monad.IO.Class (liftIO)
import qualified Data.Text as T
import Data.Text (Text)
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import Data.Time.Format (formatTime, defaultTimeLocale)
import Data.Time.LocalTime (utcToLocalZonedTime)

backendGET :: MonadWidget t m => IO a -> Event t b -> m (Event t a)
backendGET f e = performEventAsync $ ffor e $ \_ cb -> liftIO $ f >>= cb

formatUnixTime :: Integer -> IO Text
formatUnixTime ts = do
  let utcTime = posixSecondsToUTCTime (fromIntegral ts)
  localTime <- utcToLocalZonedTime utcTime
  let fmt = "%m/%d/%y %H:%M:%S"
  return $ T.pack $ formatTime defaultTimeLocale fmt localTime