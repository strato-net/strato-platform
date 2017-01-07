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

import qualified Data.Binary as Binary
import qualified Blockchain.Stream.VMEvent as BSVME
import qualified Blockchain.Sequencer.Event as BSE

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
  decodedBlocks <- liftIO $ runKafkaConfigured "blockapps-data" $
    forM rawData $ \line -> do
        let predecoded = decodeWithCheck $ BL.toStrict line
        let theIngestEvent = Binary.decode $ BLC.fromStrict predecoded
        _ <- produceMessages $ (TopicAndMessage (lookupTopic "unseqevents") . makeMessage) <$> [predecoded]

        return $ case theIngestEvent of
            BSE.IEBlock b -> [BSVME.ChainBlock $ BSE.ingestBlockToBlock b]
            _ -> []
  forM_ (concat decodedBlocks) BSVME.produceVMEvents
  return ()
