{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
module Main where

import           Control.Monad.Logger
import qualified Data.ByteString.Char8      as C8
import           Data.Maybe                 (fromMaybe)
import           HFlags
import           Safe

import           Blockchain.Blockstanbul
import           Blockchain.Data.Address
import qualified Blockchain.EthConf         as EC
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.Monad
import qualified Network.Haskoin.Crypto     as HK
import qualified Network.Kafka.Protocol     as KP

import           Flags

main :: IO ()
main = do
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  putStrLn $ "strato-sequencer with flags: " ++ unlines s
  let kafkaClientId' = KP.KString $ C8.pack flags_kafkaclientid
      mKafkaAddress = case span (/=':') flags_kafkaaddress of
                          (_, "") -> Nothing
                          (khost, kport) -> Just ( KP.Host (KP.KString (C8.pack khost))
                                                 , KP.Port (readDef 9092 (drop 1 kport)))
  -- TODO(tim): Use proper values
      ctx = newContext
               (View 0 0)
               [Address 0x80976e7d04c8ae9b3a1c08278a5c385e5b0ff446]
               (fromMaybe (error "invalid argument")  $ HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5)
      mCtx = if flags_tmpblockstanbul
               then Just ctx
               else Nothing

  let cfg = SequencerConfig {
      depBlockDBCacheSize   = flags_depblockcachesize
    , depBlockDBPath        = flags_depblockdbpath
    , kafkaClientId         = kafkaClientId'
    , kafkaConsumerGroup    = EC.lookupConsumerGroup kafkaClientId'
    , kafkaAddress          = mKafkaAddress
    , seenTransactionDBSize = flags_txdedupwindow
    , syncWrites            = flags_syncwrites
    , bootstrapDoEmit       = True
    , statsConfig           = EC.statsConfig EC.ethConf
  }
  runLoggingT (runSequencerM cfg mCtx sequencer) printLogMsg
