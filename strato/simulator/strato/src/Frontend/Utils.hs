{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Utils where

import Control.Monad (when)
import Control.Monad.IO.Class (liftIO)
import qualified Data.Text as T
import Data.Text (Text)
import Data.Time.Clock.POSIX (posixSecondsToUTCTime)
import Data.Time.Format (formatTime, defaultTimeLocale)
import Data.Time.LocalTime (utcToLocalZonedTime)
import Reflex.Dom

backendGET :: MonadWidget t m => IO a -> Event t b -> m (Event t a)
backendGET f e = performEventAsync $ ffor e $ \_ cb -> liftIO $ f >>= cb

formatUnixTime :: Integer -> IO Text
formatUnixTime ts = do
  let utcTime = posixSecondsToUTCTime (fromIntegral ts)
  localTime <- utcToLocalZonedTime utcTime
  let fmt = "%m/%d/%y %H:%M:%S"
  return $ T.pack $ formatTime defaultTimeLocale fmt localTime

whenDyn :: MonadWidget t m => Dynamic t Bool -> m () -> m ()
whenDyn d = dyn_ . ffor d . flip when

withDyn :: MonadWidget t m => (a -> m b) -> Dynamic t a -> m (Event t b)
withDyn f d = dyn $ f <$> d

withDyn_ :: MonadWidget t m => (a -> m ()) -> Dynamic t a -> m ()
withDyn_ f d = dyn_ $ f <$> d