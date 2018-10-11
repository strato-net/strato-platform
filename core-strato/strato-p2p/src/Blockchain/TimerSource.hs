{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.TimerSource (
  timerSource
  ) where

import           Control.Concurrent     (threadDelay)
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Data.Conduit

import           Blockchain.Event

timerSource :: (MonadLogger m, MonadIO m)
            => ConduitT () Event m ()
timerSource = forever $ do
  liftIO $ threadDelay 1000000
  yield TimerEvt
