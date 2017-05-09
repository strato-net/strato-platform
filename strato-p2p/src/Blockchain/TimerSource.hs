
module Blockchain.TimerSource (
  timerSource
  ) where

import Control.Concurrent (threadDelay)
import Control.Monad
import Control.Monad.IO.Class
import Data.Conduit

import Blockchain.Event

timerSource::MonadIO m=>
             Source m Event
timerSource = forever $ do
  liftIO $ threadDelay 1000000
  yield TimerEvt
