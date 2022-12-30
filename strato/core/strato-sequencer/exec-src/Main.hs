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
import qualified Data.ByteString.Char8      as C8
import           Data.ByteString.Base64
import           Data.Either.Extra
import           HFlags
import           Safe

import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.Blockstanbul
import           Blockchain.Strato.Model.ChainMember
import qualified Blockchain.EthConf         as EC
import qualified Blockchain.Network         as Net
import           Blockchain.Sequencer
import           Blockchain.Sequencer.Gregor
import           Blockchain.Sequencer.Monad
import           Blockchain.Sequencer.CablePackage
import qualified Network.Kafka.Protocol     as KP
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Prometheus
import           Network.HTTP.Client        (newManager, defaultManagerSettings)
import           Servant.Client

import           Flags

main :: IO ()
main = do
  blockappsInit "seq_main"
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  exportFlagsAsMetrics
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer network: " ++ show flags_network
  putStrLn $ "strato-sequencer validators: " ++ show flags_validators
  putStrLn $ "strato-sequencer isRootNode: " ++ show flags_isRootNode
  putStrLn $ "strato-sequencer vault-wrapper URL: " ++ show flags_vaultWrapperUrl
  putStrLn $ "strato-sequencer validatorBehavior: " ++ show flags_validatorBehavior
  putStrLn $ "strato-sequencer certInfo: " ++ show flags_certInfo

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

  -- setup the connection with vault-wrapper
  mgr <- newManager defaultManagerSettings
  vaultWrapperUrl <- parseBaseUrl flags_vaultWrapperUrl
  let clientEnv = mkClientEnv mgr vaultWrapperUrl

  maybeNetworkParams <- Net.getParams flags_network
  --  Allow these flags to accept base64-encoded JSONs optionally
  let b64decode inp = if isBase64 inp then (fromRight inp . decodeBase64) inp else inp
      eValidators = (Ae.eitherDecodeStrict . b64decode) (C8.pack flags_validators) :: Either String [ChainMemberParsedSet]
      !validators' =
        case (maybeNetworkParams, eValidators) of
          (Just networkParams, Right []) -> map Net.identity networkParams
          (_, Right v) -> v
          (_, Left e) -> error $ "invalid validators: " ++ e
      eSelf = (Ae.eitherDecodeStrict . b64decode) (C8.pack flags_certInfo) :: Either String ChainMemberParsedSet
      !self = fromRight (error "invalid self cert info") eSelf


  mCtx <- if not flags_blockstanbul
             then return Nothing
             else do
               validators <-
                 if flags_isRootNode then do
                   when (length validators' == 0) . putStrLn
                      $ "WARNING: You have given me an empty validators list. \
                        \ This is a configuration error on your part. \
                        \ PBFT will almost certainly not function properly."
                   return validators'
                 else do
                   when (length validators' == 0) . putStrLn
                      $ "WARNING: You have given me an empty validators list, but this node is not the root \
                        \ node. This is a configuration error on your part. \
                        \ PBFT will almost certainly not function properly."
                   return validators'

               unless (self `elem` validators) . putStrLn
                    $ "WARNING: NODEKEY does not correspond to a validator identity.\
                      \ This probably means that you are connecting to an existing network,\
                      \ and you are not one of the original validators of that network.\
                      \ If this is the case, please disregard this message. Otherwise,\
                      \ you may experience difficulty operating this node."
               unless (flags_blockstanbul_block_period_ms >= 0) . ioError . userError
                    $ "--blockstanbul_block_period_ms must be nonnegative"
               unless (flags_blockstanbul_round_period_s > 0) . ioError . userError
                    $ "--blockstanbul_round_period_s must be positive"

               putStrLn $ "ACTUAL validators list: " ++ show validators

               ckpt <- runGregorM gregorCfg $ initializeCheckpoint validators
               putStrLn $ "Checkpoint: " ++ show ckpt

               return $ Just $ newContext ckpt self


  cht <- atomically newTMChan

  let seqCfg = SequencerConfig
        { depBlockDBCacheSize   = flags_depblockcachesize
        , depBlockDBPath        = flags_depblockdbpath
        , seenTransactionDBSize = flags_txdedupwindow
        , syncWrites            = flags_syncwrites
        , blockstanbulBlockPeriod = BlockPeriod $ fromIntegral flags_blockstanbul_block_period_ms / 1000.0
        , blockstanbulRoundPeriod = RoundPeriod $ fromIntegral flags_blockstanbul_round_period_s
        , blockstanbulTimeouts = cht
        , cablePackage = pkg
        , maxEventsPerIter = flags_seq_max_events_per_iter
        , maxUsPerIter = flags_seq_max_us_per_iter
        , vaultClient = Just clientEnv
        }
  race_ (runTheGregor gregorCfg)
      . race_ (runLoggingT (runSequencerM seqCfg mCtx sequencer ))
      . run flags_blockstanbul_port
      $ metricsApp