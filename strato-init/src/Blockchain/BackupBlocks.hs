{-# LANGUAGE OverloadedStrings #-}

module Blockchain.BackupBlocks (
  backupBlocks
  ) where

import Control.Monad
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.ByteString.Base16 as B16
import Network.Kafka
import Network.Kafka.Producer


import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Blockchain.KafkaTopics
--import Blockchain.Stream.Raw

decodeWithCheck::B.ByteString->B.ByteString
decodeWithCheck x =
  case B16.decode x of
   (result, "") -> result
   _ -> error "bad data passed to decodeWithCheck"

{-
backupBlocks'::HasSQLDB m=>m ()
backupBlocks' = do
  rawData <- liftIO $ fmap BLC.lines $ BL.getContents
  forM_ rawData $ \line -> 
    produceBytes "block" [decodeWithCheck . BL.toStrict $ line]
-}

backupBlocks::HasSQLDB m=>m ()
backupBlocks = do
  rawData <- liftIO $ fmap BLC.lines $ BL.getContents
  _ <- liftIO $ runKafkaConfigured "blockapps-data" $
       forM_ rawData $ \line ->
                     produceMessages $ map (TopicAndMessage (lookupTopic "unseqevents") . makeMessage) [decodeWithCheck . BL.toStrict $ line]
  return ()
