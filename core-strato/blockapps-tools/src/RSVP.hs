{-# LANGUAGE OverloadedStrings #-}
module RSVP (rsvp) where

import Control.Exception
import Control.Monad.IO.Class
import qualified Data.ByteString.Char8 as C8
import System.Exit
import Text.Printf

import Blockchain.EthConf
import Blockchain.Data.DataDefs
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Indexer.TxrIndexer (addTopic)
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.ExtendedWord

rsvp :: Word256 -> String -> Address -> IO ()
rsvp chainId member addr = do
  let txHash = SHA 0x7065
      blkHash = SHA 0x7065
      govAddr = 0x100
      bloom = 0x0
      -- TODO: For now, member has to be an enode address and > 31 bytes. In the
      -- future, I think this would be the wrong encoding if it was e.g. a VM address as a string.
      memberLen = fromIntegral $ length member
      payload = assert (memberLen > 31) $ word256ToBytes (fromIntegral addr) <> word256ToBytes 0x0 <> word256ToBytes memberLen <> C8.pack member
      entry = LogDB blkHash txHash (Just $ chainId) govAddr (Just $ unSHA addTopic) Nothing Nothing Nothing payload bloom
  result <- runKafkaConfigured "queryStrato" $ do
    let req = [LogDBEntry entry]
    liftIO $ printf "request: %s\n" (show req)
    resp <- writeIndexEvents [LogDBEntry entry]
    liftIO $ printf "response: %s\n" (show resp)
  case result of
    Left err -> die $ show err
    Right () -> exitSuccess

