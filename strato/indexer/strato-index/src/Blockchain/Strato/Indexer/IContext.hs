{-# LANGUAGE DeriveAnyClass #-}

module Blockchain.Strato.Indexer.IContext
  ( IndexerException (..),
    API (..),
    P2P (..),
    targetTopicName,
  )
where

import Blockchain.Strato.Indexer.Kafka
import Control.Exception
import Control.Monad.Composable.Kafka

newtype API a = API { unAPI :: a }

newtype P2P a = P2P { unP2P :: a }

data IndexerException
  = Lookup String String String
  | Delete String String String
  deriving (Eq, Show, Exception)

targetTopicName :: TopicName
targetTopicName = indexEventsTopicName

