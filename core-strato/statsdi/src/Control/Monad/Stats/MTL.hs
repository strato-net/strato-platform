{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
module Control.Monad.Stats.MTL
    ( MonadStats
    , StatsT(..)
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
    , MTLStatsT, mtlStatsT
    ) where

import           Control.Monad.Ether
import           Control.Monad.IO.Class
import qualified Control.Monad.Stats.Monad as Ethereal
import           Control.Monad.Stats.Types
import           Data.Time.Clock           (NominalDiffTime)

ethereal "MTLStatsT" "mtlStatsT"

type MonadStats m = (Monad m, MonadIO m, Ethereal.MonadStats MTLStatsT m)
type StatsT = Ethereal.StatsT MTLStatsT

runStatsT :: (MonadIO m) => StatsT m a -> StatsTConfig -> m a
runStatsT = Ethereal.runStatsT mtlStatsT

runNoStatsT :: (MonadIO m) => StatsT m a -> m a
runNoStatsT = Ethereal.runNoStatsT mtlStatsT

tick :: (MonadStats m) => Counter -> m ()
tick = Ethereal.tick mtlStatsT

tickBy :: (MonadStats m) => Int -> Counter -> m ()
tickBy = Ethereal.tickBy mtlStatsT

setCounter :: (MonadStats m) => Int -> Counter -> m ()
setCounter = Ethereal.setCounter mtlStatsT

setGauge :: (MonadStats m) => Int -> Gauge -> m ()
setGauge = Ethereal.setGauge mtlStatsT

time :: (MonadStats m) => NominalDiffTime -> Timer -> m ()
time = Ethereal.time mtlStatsT

histoSample  :: (MonadStats m) => Int -> Histogram -> m ()
histoSample = Ethereal.histoSample mtlStatsT

addSetMember :: (MonadStats m) => Int -> Set -> m ()
addSetMember = Ethereal.addSetMember mtlStatsT

reportEvent :: (MonadStats m) => Event -> m ()
reportEvent = Ethereal.reportEvent mtlStatsT

reportServiceCheck :: (MonadStats m) => ServiceCheck -> ServiceCheckValue -> m ()
reportServiceCheck = Ethereal.reportServiceCheck mtlStatsT
