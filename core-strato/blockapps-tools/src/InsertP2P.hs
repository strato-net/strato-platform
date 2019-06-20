{-# LANGUAGE OverloadedStrings #-}
module InsertP2P where

import Text.Printf

import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka

insertP2P :: OutputEvent -> IO ()
insertP2P oev = do
  printf "Inserting %s into seq_p2p_events...\n" $ show oev
  resps <- runKafkaConfigured "queryStrato" $ do
    assertTopicCreation
    writeSeqP2pEvents [oev]
  mapM_ print resps
