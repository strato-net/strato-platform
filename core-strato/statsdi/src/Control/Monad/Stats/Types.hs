{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TupleSections              #-}
module Control.Monad.Stats.Types where

import           Control.Concurrent.STM (TMVar)
import           Control.Monad.Ether
import           Control.Monad.IO.Class
import           Data.ByteString        (ByteString)
import qualified Data.ByteString        as ByteString
import qualified Data.ByteString.Char8  as Char8
import           Data.Dequeue
import           Data.Hashable
import           Data.HashMap.Strict    (HashMap)
import qualified Data.HashMap.Strict    as HashMap
import           Data.IORef
import           Data.Time.Clock.POSIX  (POSIXTime)
import           Network.Socket         (Socket)
import           System.Random          (Random)

import           Data.Typeable
import           GHC.Generics

type Tag  = (ByteString, ByteString)
type Tags = [Tag]
newtype SampleRate = SampleRate Float deriving (Eq, Ord, Read, Show, Num, Fractional, Random, Generic, Typeable)

data MetricStoreKey = CounterKey   { ckMetric :: Counter   }
                    | GaugeKey     { gkMetric :: Gauge     }
                    | TimerKey     { tkMetric :: Timer     }
                    | HistogramKey { hkMetric :: Histogram }
                    | SetKey       { skMetric :: Set       }
                    deriving (Eq, Ord, Read, Show, Generic, Typeable)

isHistogram :: MetricStoreKey -> Bool
isHistogram (HistogramKey _) = True
isHistogram _                = False

histogramSampleRate :: MetricStoreKey -> SampleRate
histogramSampleRate (HistogramKey h) = _histogramSampleRate h
histogramSampleRate _ = error "called histogramSampleRate on a non-HistogramKey. pls use `isHistogram` to avoid this"

newtype MetricStore = MetricStore { metricValue :: Int }
    deriving (Eq, Ord, Read, Show, Enum, Num, Real, Integral, Generic, Typeable)

class (Eq m, Ord m, Read m, Show m) => Metric m where
    metricStoreKey :: m -> MetricStoreKey

instance Hashable MetricStoreKey where
    hashWithSalt salt m = salt `hashWithSalt` keyName m `hashWithSalt` keyTags m `hashWithSalt` keyKind m

keyName :: MetricStoreKey -> ByteString
keyName (CounterKey m)   = counterName m  -- this is literally a crime against humanity
keyName (GaugeKey m)     = gaugeName m
keyName (TimerKey m)     = timerName m
keyName (HistogramKey m) = histogramName m
keyName (SetKey m)       = setName m

keyTags :: MetricStoreKey -> Tags
keyTags (CounterKey m)   = counterTags m
keyTags (GaugeKey m)     = gaugeTags m
keyTags (TimerKey m)     = timerTags m
keyTags (HistogramKey m) = histogramTags m
keyTags (SetKey m)       = setTags m

keyKind :: MetricStoreKey -> ByteString
keyKind (CounterKey m)   = "|c"
keyKind (GaugeKey m)     = "|g"
keyKind (TimerKey m)     = "|ms"
keyKind (HistogramKey m) = "|h"
keyKind (SetKey m)       = "|s"

data Counter = Counter { counterName :: !ByteString, counterTags :: !Tags }
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

data Gauge = Gauge { gaugeName :: !ByteString, gaugeTags :: !Tags }
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

data Timer = Timer { timerName :: !ByteString, timerTags :: !Tags }
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

data Histogram = Histogram { histogramName :: !ByteString , histogramTags :: !Tags, _histogramSampleRate :: !SampleRate }
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

data Set = Set { setName :: !ByteString, setTags :: !Tags }
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

data Event =
    Event { eventName      :: ByteString
          , eventText      :: ByteString
          , eventTags      :: Tags
          , eventTimestamp :: Maybe POSIXTime
          , eventHostname  :: Maybe ByteString
          , eventAggKey    :: Maybe ByteString
          , eventPriority  :: Maybe Priority
          , eventSource    :: Maybe ByteString
          , eventAlertType :: Maybe AlertType
          } deriving (Eq, Ord, Show, Generic, Typeable)

data ServiceCheck =
    ServiceCheck { serviceCheckName :: ByteString
                 , serviceCheckTags :: Tags
                 } deriving (Eq, Ord, Read, Show, Generic, Typeable)

data Priority = Normal | Low
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

renderPriority :: Priority -> ByteString
renderPriority Normal = "normal"
renderPriority Low    = "low"

data AlertType = Error | Warning | Info | Success
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

renderAlertType :: AlertType -> ByteString
renderAlertType Error   = "error"
renderAlertType Warning = "warning"
renderAlertType Info    = "info"
renderAlertType Success = "success"

data ServiceCheckStatus = StatusOK | StatusWarning | StatusCritical | StatusUnknown
    deriving (Eq, Ord, Read, Show, Generic, Typeable)

data ServiceCheckValue =
    ServiceCheckValue { scvStatus    :: ServiceCheckStatus
                      , scvTimestamp :: Maybe POSIXTime
                      , scvHostname  :: Maybe ByteString
                      , scvMessage   :: Maybe ByteString
                      } deriving (Eq, Show, Generic, Typeable)

renderServiceCheckStatus :: ServiceCheckStatus -> ByteString
renderServiceCheckStatus StatusOK       = "0"
renderServiceCheckStatus StatusWarning  = "1"
renderServiceCheckStatus StatusCritical = "2"
renderServiceCheckStatus StatusUnknown  = "3"

renderTags :: Tags -> ByteString
renderTags = ByteString.intercalate "," . map renderTag
    where renderTag :: Tag -> ByteString
          renderTag (k, v) = ByteString.concat [k, ":", v]

renderAllTags :: [Tags] -> ByteString
renderAllTags tags = case concat tags of
    [] -> ""
    xs -> ByteString.concat ["|#", renderTags xs]

instance Metric Counter where
    metricStoreKey = CounterKey

instance Metric Gauge where
    metricStoreKey = GaugeKey

instance Metric Timer where
    metricStoreKey = TimerKey

instance Metric Histogram where
    metricStoreKey = HistogramKey

instance Metric Set where
    metricStoreKey = SetKey

data StatsTConfig =
    StatsTConfig { host          :: !String
                 , port          :: !Int
                 , flushInterval :: !Int
                 , prefix        :: !ByteString
                 , suffix        :: !ByteString
                 , defaultTags   :: !Tags
                 } deriving (Eq, Read, Show, Generic, Typeable)

defaultStatsTConfig :: StatsTConfig
defaultStatsTConfig = StatsTConfig { host = "127.0.0.1"
                                   , port = 8125
                                   , flushInterval = 1000
                                   , prefix = ""
                                   , suffix = ""
                                   , defaultTags = []
                                   }

data StatsTEnvironment = StatsTEnvironment (StatsTConfig, TMVar Socket, IORef StatsTState)
                       | NoStatsTEnvironment
                       deriving (Eq, Generic, Typeable)

envConfig :: StatsTEnvironment -> StatsTConfig
envConfig NoStatsTEnvironment = error "called envConfig inside a runNoStatsT"
envConfig (StatsTEnvironment (a, _, _)) = a

envSocket :: StatsTEnvironment -> TMVar Socket
envSocket NoStatsTEnvironment = error "called envSocket inside a runNoStatsT"
envSocket (StatsTEnvironment (_, b, _)) = b

envState :: StatsTEnvironment -> IORef StatsTState
envState NoStatsTEnvironment = error "called envState inside a runNoStatsT"
envState (StatsTEnvironment (_, _, c)) = c

type MetricMap = HashMap MetricStoreKey MetricStore

metricMapLookup :: Metric m => m -> MetricMap -> Maybe MetricStore
metricMapLookup = HashMap.lookup . metricStoreKey

metricMapInsert :: Metric m => m -> MetricStore -> MetricMap -> MetricMap
metricMapInsert = HashMap.insert . metricStoreKey

data NonMetricEvent = HistogramEvent Histogram MetricStore
                    | SetEvent Set MetricStore
                    | ServiceCheckEvent ServiceCheck
                    | EventEvent Event
                    deriving (Eq, Show, Generic, Typeable)

data StatsTState =
    StatsTState { registeredMetrics :: HashMap MetricStoreKey MetricStore
                , queuedLines       :: BankersDequeue ByteString
                } deriving (Eq, Read, Show, Generic, Typeable)

mkStatsTEnv :: (MonadIO m, Monad m) => StatsTConfig -> TMVar Socket -> m StatsTEnvironment
mkStatsTEnv conf socket = liftIO $
    StatsTEnvironment . (conf,socket,) <$> newIORef (StatsTState HashMap.empty empty)
