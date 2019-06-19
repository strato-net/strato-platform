module Blockchain.Watchdog where

import Control.Concurrent
import Control.Concurrent.AlarmClock
import Control.Exception
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import Data.Time
import UnliftIO.STM

import Blockchain.Metrics

-- Watchdogs are used to check that particular threads don't hang
-- indefinitely. In particular each p2p connection should be
-- sending and receiving one ROUND_CHANGE per blockstanbulRoundPeriodS, so
-- if the sending/receiving threads are stalled for a multiple of that it
-- indicates an unhealthy connection.
data Watchdog = Watchdog (TVar Bool)

data WatchdogBite = WatchdogBite ThreadId NominalDiffTime deriving (Show)

instance Exception WatchdogBite where

-- mkWatchdog will bite the passed in `mtid` when `interval` has
-- elapsed without a pet.
mkWatchdog :: MonadResource m => ThreadId -> NominalDiffTime -> m Watchdog
mkWatchdog mtid interval = do
  hasBeenPet <- atomically $ newTVar True
  let checkForPet :: AlarmClock UTCTime -> UTCTime -> IO ()
      checkForPet this now = do
        recordWatchdogWake
        lastValue <- atomically $ swapTVar hasBeenPet False
        if lastValue
          then liftIO . setAlarm this $ addUTCTime interval now
          else throwTo mtid $ WatchdogBite mtid interval

  when (interval > 0) $ do
    (_, alarm) <- allocate (liftIO $ newAlarmClock' checkForPet) destroyAlarmClock
    liftIO $ setAlarmNow alarm
  return $ Watchdog hasBeenPet

petWatchdog :: MonadUnliftIO m => Watchdog -> m ()
petWatchdog (Watchdog hasBeenPet) = do
  recordWatchdogPet
  atomically $ writeTVar hasBeenPet True
