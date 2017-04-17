{-# LANGUAGE TemplateHaskell, OverloadedStrings #-}
module Main where

import Control.Monad.Logger
import HFlags

import Blockchain.Output
import Blockchain.Sequencer
import Blockchain.Sequencer.Monad

import Blockchain.EthConf

import Flags

import qualified Data.ByteString.Char8  as C8
import qualified Network.Kafka.Protocol as KP

main :: IO ()
main = do
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  putStrLn $ "strato-sequencer with flags: " ++ unlines s
  let kafkaClientId' = KP.KString $ C8.pack flags_kafkaclientid
  let cfg = SequencerConfig {
      depBlockDBCacheSize   = flags_depblockcachesize
    , depBlockDBPath        = flags_depblockdbpath
    , kafkaClientId         = kafkaClientId'
    , kafkaConsumerGroup    = lookupConsumerGroup kafkaClientId'
    , seenTransactionDBSize = flags_txdedupwindow
    , syncWrites            = flags_syncwrites
    , bootstrapDoEmit       = True
  }
  runLoggingT (runStatsTConfigured (runSequencerM cfg sequencer)) (printLogMsg' True True)
