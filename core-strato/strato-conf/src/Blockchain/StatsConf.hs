{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.StatsConf
    ( StatsConf(..)
    , defaultStatsConf
    , fromStatsTConfig
    , toStatsTConfig
    ) where

import           Control.Arrow         ((***))
import           Control.Monad.Stats
import qualified Data.ByteString.Char8 as Char8
import           Data.Yaml

import           Data.Typeable
import           GHC.Generics

data StatsConf = StatsConf { statsHost          :: String
                           , statsPort          :: Int
                           , statsFlushInterval :: Int
                           , statsPrefix        :: String
                           , statsSuffix        :: String
                           , statsDefaultTags   :: [(String, String)]
                           } deriving (Eq, Ord, Read, Show, Generic, Typeable)

instance FromJSON StatsConf
instance ToJSON StatsConf

defaultStatsConf :: StatsConf
defaultStatsConf = fromStatsTConfig (defaultStatsTConfig { host = "telegraf" })

fromStatsTConfig :: StatsTConfig -> StatsConf
fromStatsTConfig f =
    StatsConf { statsHost = host f
              , statsPort = port f
              , statsFlushInterval = flushInterval f
              , statsPrefix = Char8.unpack $ prefix f
              , statsSuffix = Char8.unpack $ suffix f
              , statsDefaultTags = (Char8.unpack *** Char8.unpack) <$> defaultTags f
              }

toStatsTConfig :: StatsConf -> StatsTConfig
toStatsTConfig t =
    StatsTConfig { host = statsHost t
                 , port = statsPort t
                 , flushInterval = statsFlushInterval t
                 , prefix = Char8.pack $ statsPrefix t
                 , suffix = Char8.pack $ statsSuffix t
                 , defaultTags = (Char8.pack *** Char8.pack) <$> statsDefaultTags t
                 }
