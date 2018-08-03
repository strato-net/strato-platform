{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
module Main where

import           Control.Monad.Logger
import qualified Data.Aeson                 as Ae
import qualified Data.ByteString.Base64     as B64
import qualified Data.ByteString.Char8      as C8
import           Data.Either.Extra
import           Data.Maybe                 (fromMaybe)
import           HFlags
import           Safe
import           System.Environment

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
      eValidators = Ae.eitherDecodeStrict (C8.pack flags_validators) :: Either String [Address]
      -- TODO(tim): Use proper initial values for the view
      ctx = newContext
               (View 0 0)
               (fromEither (error "invalid validators") eValidators)
  mCtx <- if not flags_tmpblockstanbul
             then return Nothing
             else do
                skey <- fromMaybe (error "NODEKEY not set") <$> lookupEnv "NODEKEY"
                let bytes = fromEither (error "Invalid base64 NODEKEY") . B64.decode . C8.pack $ skey
                    pkey = fromMaybe (error "Invalid NODEKEY") . HK.decodePrvKey HK.makePrvKey $ bytes
                return . Just . ctx $ pkey

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
