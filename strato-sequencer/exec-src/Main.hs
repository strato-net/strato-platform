{-# LANGUAGE TemplateHaskell, OverloadedStrings #-}
module Main where

import Control.Monad.Logger
import HFlags

import Blockchain.Output
import Blockchain.Sequencer
import Blockchain.Sequencer.Monad

import HFlags()
import Flags

import qualified Data.ByteString.Char8  as C8
import qualified Network.Kafka.Protocol as KP

main :: IO ()
main = do
  _ <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  cfg <- return $ SequencerConfig {
      depBlockDBCacheSize   = flags_depblockcachesize
    , depBlockDBPath        = flags_depblockdbpath
    , kafkaClientId         = KP.KString . C8.pack $ flags_kafkaclientid
    , seenTransactionDBSize = flags_txdedupwindow
    , syncWrites            = flags_syncwrites
    , bootstrapDoEmit       = True
    , startOffset           = flags_startoffset
  }
  flip runLoggingT printLogMsg $ runSequencerM cfg sequencer
