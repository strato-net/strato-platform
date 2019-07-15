{-# LANGUAGE OverloadedStrings #-}
module InsertSeq where

import Data.Aeson
import Data.ByteString.Char8 as C8
import System.Exit
import Text.Printf

import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction
import Blockchain.Data.Json
import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Util (getCurrentMicrotime)

insertSeq :: IngestEvent -> IO ()
insertSeq iev = do
  printf "Inserting %s into unseqevents...\n" $ show iev
  resps <- runKafkaConfigured "queryStrato" $ do
    assertTopicCreation
    writeUnseqEvents [iev]
  mapM_ print resps

addTx :: String -> IO ()
addTx tx' = do
  rtx <- either (die . printf "failed raw tx decoding: %s") (return . rtPrimeToRt) . eitherDecodeStrict . C8.pack $ tx'
  let origin = rawTransactionOrigin rtx
      tx = rawTX2TX rtx
  now <- getCurrentMicrotime
  let iev = IETx now $ IngestTx origin tx
  insertSeq iev
