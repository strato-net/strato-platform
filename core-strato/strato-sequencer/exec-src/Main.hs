{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
module Main where

import           Control.Monad.Logger
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

import           Blockchain.Blockstanbul
import           Server
import           Blockchain.Strato.Model.Address
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
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer validators: " ++ show flags_validators
  putStrLn $ "strato-sequencer authorized beneficiary senders" ++ show flags_blockstanbul_authorized_addresses
  let kafkaClientId' = KP.KString $ C8.pack flags_kafkaclientid
      mKafkaAddress = case span (/=':') flags_kafkaaddress of
                          (_, "") -> Nothing
                          (khost, kport) -> Just ( KP.Host (KP.KString (C8.pack khost))
                                                 , KP.Port (readDef 9092 (drop 1 kport)))
      eValidators = Ae.eitherDecodeStrict (C8.pack flags_validators) :: Either String [Address]
      validators = fromRight (error "invalid validators") eValidators
      eAuthSenders = Ae.eitherDecodeStrict (C8.pack flags_blockstanbul_authorized_addresses) :: Either String [Address]
      authSenders = fromRight (error "invalid validators") eAuthSenders
      -- TODO(tim): Use proper initial values for the view
      ctx = newContext (View 0 0) validators authSenders
  putStrLn $ "Interpreted validators: " ++ show validators
  mCtx <- if not flags_blockstanbul
             then return Nothing
             else do
                skey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
                let bytes = fromRight (error "Invalid base64 NODEKEY") . B64.decode . C8.pack $ skey
                    pkey = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
                putStrLn . ("NODEKEY address: " ++) . formatAddress . prvKey2Address $ pkey
                return . Just . ctx $ pkey
  chv <- atomically $ newTMChan
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
    , blockstanbulBlockPeriod = fromIntegral flags_blockstanbul_block_period_ms / 1000.0
    , blockstanbulRoundPeriod = fromIntegral flags_blockstanbul_round_period_s
    , blockstanbulBeneficiary = chv
  }
  race_ (runLoggingT (runSequencerM cfg mCtx sequencer) printLogMsg) (webserver flags_blockstanbul_port chv)
