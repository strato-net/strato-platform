{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.InsertP2P where

import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Text.Printf

insertP2P :: P2pEvent -> IO ()
insertP2P oev = do
  printf "Inserting %s into seq_p2p_events...\n" $ show oev
  resps <- runKafkaMConfigured "queryStrato" $ do
    assertSequencerTopicsCreation
    writeSeqP2pEvents [oev]
  mapM_ print resps
