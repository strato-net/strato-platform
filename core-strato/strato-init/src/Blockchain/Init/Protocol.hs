{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
module Blockchain.Init.Protocol
  ( EventInit(..)
  , initTopic
  ) where

import Data.Aeson
import qualified Data.ByteString as B
import GHC.Generics

import Blockchain.EthConf
import Blockchain.Data.Json (Block')
import Blockchain.Data.ChainInfo (AccountInfo)
import Network.Kafka.Protocol as K

data EventInit = EthConf EthConf
               | TopicList [(String, String)]
               | PeerList [String]
               | GenesisBlock Block'
               | GenesisAccounts [AccountInfo]
               | ApiConfig [(FilePath, B.ByteString)]
               | InitComplete
               deriving (Show, Eq, Generic, ToJSON, FromJSON)

initTopic :: K.TopicName
initTopic = "strato-init-events"
