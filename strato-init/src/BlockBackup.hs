{-# LANGUAGE OverloadedStrings #-}

import           Control.Monad.IO.Class
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8  as BC
import           Data.Maybe
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.KafkaTopics
import           Blockchain.Stream.Raw
import           Network.Kafka


main::IO ()
main = backupBlocks 0

backupBlocks::Offset->IO ()
backupBlocks startingBlock = do

  lastOffsetOrError <- runKafkaConfigured "strato-block-backup" $ getLastOffset LatestTime 0 (lookupTopic "unseqevents")
  case lastOffsetOrError of
    Left e           -> error (show e)
    Right lastOffset -> doConsume' startingBlock lastOffset

  where
    doConsume' offset lastOffset
      | offset >= lastOffset = return ()
      | otherwise = do

      result <- fmap (fromMaybe (error "offset out of range")) $ fetchBytesIO (lookupTopic "unseqevents") offset

      liftIO $ putStr $ unlines $ map (BC.unpack . B16.encode) result

      doConsume' (offset + fromIntegral (length result)) lastOffset


