{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE DuplicateRecordFields #-}
module Main where

import           Control.Monad
import           Control.Concurrent.Async             as Async
import           Control.Concurrent.STM
import           Control.Concurrent.STM.TMChan
import qualified Data.Aeson                 as Ae
import qualified Data.ByteString.Base64     as B64
import qualified Data.ByteString.Char8      as C8
import           Data.Either.Extra
import           Data.Maybe                 (fromMaybe)
import           HFlags
import           Safe
import           System.Environment

import           BlockApps.Init
import           Blockchain.Blockstanbul
import           Blockchain.Blockstanbul.HTTPAdmin
import           Blockchain.Strato.Model.Address
import qualified Blockchain.EthConf         as EC
import           Blockchain.Output
import           Blockchain.Sequencer
import           Blockchain.Sequencer.Gregor
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.CablePackage
import qualified Network.Haskoin.Crypto     as HK
import qualified Network.Kafka.Protocol     as KP
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus

import           Flags

main :: IO ()
main = do
  blockappsInit "seq_main"
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  exportFlagsAsMetrics
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer validators: " ++ show flags_validators
  putStrLn $ "strato-sequencer authorized beneficiary senders" ++ show flags_blockstanbul_admins
  pkg <- atomically newCablePackage
  let kafkaClientId' = KP.KString $ C8.pack flags_kafkaclientid
      mKafkaAddress = case span (/=':') flags_kafkaaddress of
                          (_, "") -> Nothing
                          (khost, kport) -> Just ( KP.Host (KP.KString (C8.pack khost))
                                                 , KP.Port (readDef 9092 (drop 1 kport)))
      gregorCfg = GregorConfig
        { kafkaAddress = mKafkaAddress
        , kafkaClientId = kafkaClientId'
        , kafkaConsumerGroup = EC.lookupConsumerGroup kafkaClientId'
        , cablePackage = pkg
        }
  let eValidators = Ae.eitherDecodeStrict (C8.pack flags_validators) :: Either String [Address]
      !validators = fromRight (error "invalid validators") eValidators
      eAuthSenders = Ae.eitherDecodeStrict (C8.pack flags_blockstanbul_admins) :: Either String [Address]
      !authSenders = fromRight (error "invalid admins") eAuthSenders
  ckpt <- runGregorM gregorCfg $ initializeCheckpoint validators authSenders
  putStrLn $ "Checkpoint: " ++ show ckpt
      -- TODO(tim): checkpoint validators, authSenders
  putStrLn $ "Interpreted validators: " ++ show validators
  mCtx <- if not flags_blockstanbul
             then do
                unless (null validators) . ioError . userError
                    $ "cannot specify --validators with --blockstanbul=false"
                return Nothing
             else do
                !skey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
                let !bytes = fromRight (error "Invalid base64 NODEKEY") . B64.decode . C8.pack $ skey
                    !pkey = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
                    selfAddress = prvKey2Address pkey
                putStrLn . ("NODEKEY address: " ++) . formatAddress $ selfAddress
                addSelfAsMetric selfAddress
                when (null validators) . ioError . userError
                    $ "must specify --validators with --blockstanbul"
                unless (selfAddress `elem` validators) . putStrLn
                    $ "NODEKEY does not correspond to an address within --validators.\
                      \ This probably means that you are connecting to an existing network,\
                      \ and you are not one of the original validators of that network.\
                      \ If this is the case, please disregard this message. Otherwise,\
                      \ you may experience difficulty operating this node."
                unless (flags_blockstanbul_block_period_ms >= 0) . ioError . userError
                    $ "--blockstanbul_block_period_ms must be nonnegative"
                unless (flags_blockstanbul_round_period_s > 0) . ioError . userError
                    $ "--blockstanbul_round_period_s must be positive"
                return . Just . newContext ckpt $ pkey
  chr <- atomically newTQueue
  chv <- atomically newTQueue
  cht <- atomically newTMChan

  let seqCfg = SequencerConfig
        { depBlockDBCacheSize   = flags_depblockcachesize
        , depBlockDBPath        = flags_depblockdbpath
        , seenTransactionDBSize = flags_txdedupwindow
        , syncWrites            = flags_syncwrites
        , blockstanbulBlockPeriod = fromIntegral flags_blockstanbul_block_period_ms / 1000.0
        , blockstanbulRoundPeriod = fromIntegral flags_blockstanbul_round_period_s
        , blockstanbulBeneficiary = chv
        , blockstanbulVoteResps = chr
        , blockstanbulTimeouts = cht
        , cablePackage = pkg
        , maxEventsPerIter = flags_seq_max_events_per_iter
        , maxUsPerIter = flags_seq_max_us_per_iter
        }
  race_ (runTheGregor gregorCfg)
      . race_ (runLoggingT (runSequencerM seqCfg mCtx sequencer))
      . run flags_blockstanbul_port
      . prometheus def{ prometheusInstrumentApp = False }
      . instrumentApp "blockstanbul-admin"
      $ createWebServer chv chr
