{-# LANGUAGE OverloadedStrings #-}

import Control.Monad
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.ByteString.Base16 as B16
import Network.Kafka
import Network.Kafka.Producer

main = do
  rawData <- fmap BLC.lines $ BL.getContents
  forM_ rawData $ \line -> do
    let (blockData, "") = B16.decode $ BL.toStrict line
    print blockData
    runKafka (mkKafkaState "qqqq" ("127.0.0.1", 9092)) $ do
      produceMessages $ [TopicAndMessage "restore" . makeMessage $ blockData]
    
