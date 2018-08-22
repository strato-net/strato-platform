{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeApplications      #-}

module Control.Monad.Stats.MTL
    ( MonadStats
    , StatsT
    , runStatsT
    , runNoStatsT
    , tick
    , tickBy
    , setCounter
    , setGauge
    , time
    , histoSample
    , addSetMember
    , reportEvent
    , reportServiceCheck
    , MTLStatsT
    ) where

import           Control.Monad.IO.Class
import qualified Control.Monad.Stats.Monad as Ethereal
import           Control.Monad.Stats.Types
import           Data.Time.Clock           (NominalDiffTime)

data MTLStatsT

type MonadStats m = (Monad m, MonadIO m, Ethereal.MonadStats MTLStatsT m)
type StatsT = Ethereal.StatsT MTLStatsT

runStatsT :: forall m a.(MonadIO m) => StatsT m a -> StatsTConfig -> m a
runStatsT = Ethereal.runStatsT @m @MTLStatsT

runNoStatsT :: forall m a.(MonadIO m) => StatsT m a -> m a
runNoStatsT = Ethereal.runNoStatsT @m @MTLStatsT

tick :: (MonadStats m) => Counter -> m ()
tick = Ethereal.tick @MTLStatsT

tickBy :: (MonadStats m) => Int -> Counter -> m ()
tickBy = Ethereal.tickBy @MTLStatsT

setCounter :: (MonadStats m) => Int -> Counter -> m ()
setCounter = Ethereal.setCounter @MTLStatsT

setGauge :: (MonadStats m) => Int -> Gauge -> m ()
setGauge = Ethereal.setGauge @MTLStatsT

time :: forall m.(MonadStats m) => NominalDiffTime -> Timer -> m ()
time = Ethereal.time @NominalDiffTime @MTLStatsT

histoSample  :: forall m.(MonadStats m) => Int -> Histogram -> m ()
histoSample = Ethereal.histoSample @m @MTLStatsT

addSetMember :: forall m.(MonadStats m) => Int -> Set -> m ()
addSetMember = Ethereal.addSetMember @m @MTLStatsT

reportEvent :: (MonadStats m) => Event -> m ()
reportEvent = Ethereal.reportEvent @MTLStatsT

reportServiceCheck :: forall m.(MonadStats m) => ServiceCheck -> ServiceCheckValue -> m ()
reportServiceCheck = Ethereal.reportServiceCheck @m @MTLStatsT
