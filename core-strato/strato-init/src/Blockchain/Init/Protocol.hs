{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Init.Protocol
  ( EventInit(..)
  , initTopic
  , addEvent
  , receiveEvent
  ) where

import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.Text as T
import GHC.Generics

import Blockchain.EthConf.Model
import Blockchain.Data.GenesisInfo
import Network.Kafka.Protocol as K

data EventInit = EthConf EthConf
               | TopicList [(String, String)]
               | PeerList (Maybe [String])
               | GenesisBlock GenesisInfo
               -- As the generator doesn't need to modify the account info,
               -- its a little simpler to just ship text and the worker will
               -- pipe that to the output file. While it may seem pointless to
               -- backup the potentially huge AccountInfo file, it will preserve
               -- the contents regardless of being input as an image file, an
               -- embedded file, a file on a volume, or a file otherwise generated
               -- at the launch of the container.
               | GenesisAccounts T.Text
               | ApiConfig [(FilePath, B.ByteString)]
               | InitComplete
               deriving (Show, Eq, Generic, ToJSON, FromJSON)

initTopic :: K.TopicName
initTopic = "strato-init-events"

addEvent :: EventInit -> IO ()
addEvent = error "TODO(tim): addEvent"

receiveEvent :: IO EventInit
receiveEvent = error "TODO(tim): receiveEvent"
