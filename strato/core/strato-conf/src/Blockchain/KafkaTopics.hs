{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.KafkaTopics where

import qualified Data.ByteString        as B
import qualified Data.ByteString.Char8  as C
import qualified Data.Map               as Map
import           Data.Maybe
import           Data.Yaml

import           Network.Kafka.Protocol
import           System.IO.Unsafe

type TopicLabel = String
type TopicName' = String

{-# NOINLINE kafkaTopics #-}
kafkaTopics:: Map.Map TopicLabel TopicName'
kafkaTopics = unsafePerformIO $ do
            contents <- B.readFile ".ethereumH/topics.yaml"
            return $ (either (error . show) id . decodeEither') contents


lookupTopic :: TopicLabel -> TopicName
lookupTopic label = fromMaybe (TName  . KString . C.pack $ label) (TName . KString . C.pack <$> Map.lookup label kafkaTopics)
