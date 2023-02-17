{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE DuplicateRecordFields #-}
module Main where

import           Control.Monad
import           Control.Concurrent         (threadDelay)
import           Control.Concurrent.Async             as Async
import           Control.Concurrent.STM
import           Control.Concurrent.STM.TMChan
import qualified Data.ByteString.Char8      as C8
import qualified Data.Text                  as T
import           HFlags
import           Safe

import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.Blockstanbul
import           Blockchain.Data.GenesisInfo
import           Blockchain.Generation
import           Blockchain.Strato.Model.ChainMember
import qualified Blockchain.EthConf         as EC
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

waitOnVault :: (Show a) => IO (Either a b) -> IO b
waitOnVault action = do
  putStrLn "asking vault-proxy for the node address"
  res <- action
  case res of
    Left err -> do 
      putStrLn $ "failed to get node address from vault-proxy... got this error: " ++ show err
      threadDelay 2000000 -- 2 seconds
      waitOnVault action
    Right val -> return val

main :: IO ()
main = do
  blockappsInit "seq_main"
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  validators <- readValidatorsFromGenesisInfo <$> getGenesisInfoFromFile flags_genesisBlockName
  exportFlagsAsMetrics
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer network: " ++ show flags_network
  putStrLn $ "strato-sequencer validators: " ++ show validators
  putStrLn $ "strato-sequencer vault-proxy URL: " ++ show flags_vaultWrapperUrl
  putStrLn $ "strato-sequencer validatorBehavior: " ++ show flags_validatorBehavior
  putStrLn $ "strato-sequencer node cert info: " ++ flags_myOrgName ++ "-" ++ flags_myOrgUnit ++ "-" ++ flags_myCommonName

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
  
  -- setup the connection with vault-proxy
  mgr <- newManager defaultManagerSettings
  vaultWrapperUrl <- parseBaseUrl flags_vaultWrapperUrl
  let clientEnv = mkClientEnv mgr vaultWrapperUrl

  let !self = case T.pack <$> [flags_myOrgName, flags_myOrgUnit, flags_myCommonName] of
        ["", _, _] -> error "Missing required organization name"
        [_, _, ""] -> error "Missing required common name"
        [o, u, c]  -> CommonName o u c True
        _          -> error "???"

  mCtx <- if not flags_blockstanbul
             then return Nothing
             else do
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