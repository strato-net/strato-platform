{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.TimerSource
  ( timerSource,
  )
where

import BlockApps.Logging
import Blockchain.Event
import Control.Concurrent (threadDelay)
import Control.Monad
import Control.Monad.IO.Class
import Data.Conduit

timerSource ::
  (MonadLogger m, MonadIO m) =>
  ConduitM () Event m ()
timerSource = forever $ do
  liftIO $ threadDelay 1000000
  yield TimerEvt
