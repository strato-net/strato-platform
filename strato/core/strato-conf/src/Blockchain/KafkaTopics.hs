{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.KafkaTopics where

import Control.Monad.Composable.Kafka
import qualified Data.ByteString as B
import qualified Data.Map as Map
import Data.Maybe
import Data.String
import Data.Yaml
import System.IO.Unsafe

type TopicLabel = String

type TopicName' = String

{-# NOINLINE kafkaTopics #-}
kafkaTopics :: Map.Map TopicLabel TopicName'
kafkaTopics = unsafePerformIO $ do
  contents <- B.readFile ".ethereumH/topics.yaml"
  return $ (either (error . show) id . decodeEither') contents

lookupTopic :: TopicLabel -> TopicName
lookupTopic label = fromMaybe (fromString label) (fromString <$> Map.lookup label kafkaTopics)
