{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Main where

import BlockApps.Init
import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.Options ()
import Blockchain.Data.GenesisInfo
import Blockchain.EthConf
import Blockchain.Generation
import Blockchain.Sequencer
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Gregor
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.Options (flags_network)
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Control.Concurrent (threadDelay)
import Control.Concurrent.Async as Async
import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad
import Data.String
import qualified Database.Redis as Redis
import Flags
import HFlags
import Instrumentation
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Safe
import Servant.Client
import qualified Strato.Strato23.API as VC
import qualified Strato.Strato23.Client as VC

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
  runInstrumentation "strato-sequencer"
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"
  validators <- readValidatorsFromGenesisInfo <$> getGenesisInfoFromFile flags_genesisBlockName

  exportFlagsAsMetrics
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer network: " ++ show flags_network
  putStrLn $ "strato-sequencer validators: " ++ show validators
  putStrLn $ "strato-sequencer vault-proxy URL: " ++ show flags_vaultWrapperUrl
  putStrLn $ "strato-sequencer validatorBehavior: " ++ show flags_validatorBehavior

  pkg <- atomically newCablePackage
  let kafkaClientId' = flags_kafkaclientid
      mKafkaAddress = case span (/= ':') flags_kafkaaddress of
        (_, "") -> Nothing
        (khost, kport) ->
          Just (fromString khost, fromInteger $ readDef 9092 $ drop 1 kport)
      gregorCfg =
        GregorConfig
          { kafkaAddress = mKafkaAddress,
            kafkaClientId = fromString kafkaClientId',
            kafkaConsumerGroup = fromString kafkaClientId',
            cablePackage = pkg
          }

  -- setup the connection with vault-proxy
  mgr <- newManager defaultManagerSettings
  vaultWrapperUrl <- parseBaseUrl flags_vaultWrapperUrl
  let clientEnv = mkClientEnv mgr vaultWrapperUrl

  selfAddress <- do
    addrAndKey <- waitOnVault $ runClientM (VC.getKey Nothing Nothing) clientEnv
    return $ VC.unAddress addrAndKey

  putStrLn $ "strato-sequencer nodeAddress: " ++ show selfAddress

  mCtx <-
    if not flags_blockstanbul
      then return Nothing
      else do
        unless (flags_blockstanbul_block_period_ms >= 0) . ioError . userError $
          "--blockstanbul_block_period_ms must be nonnegative"
        unless (flags_blockstanbul_round_period_s > 0) . ioError . userError $
          "--blockstanbul_round_period_s must be positive"

        putStrLn $ "ACTUAL validators list: " ++ show validators

        ckpt <- runGregorM gregorCfg $ initializeCheckpoint validators
        putStrLn $ "Checkpoint: " ++ show ckpt

        return $ Just $ newContext flags_network ckpt (Just selfAddress) flags_validatorBehavior Nothing

  cht <- atomically newTMChan

  redisBDBPool <- Redis.checkedConnect lookupRedisBlockDBConfig

  let seqCfg =
        SequencerConfig
          { depBlockDBCacheSize = flags_depblockcachesize,
            depBlockDBPath = flags_depblockdbpath,
            seenTransactionDBSize = flags_txdedupwindow,
            syncWrites = flags_syncwrites,
            blockstanbulBlockPeriod = BlockPeriod $ fromIntegral flags_blockstanbul_block_period_ms / 1000.0,
            blockstanbulRoundPeriod = RoundPeriod $ fromIntegral flags_blockstanbul_round_period_s,
            blockstanbulTimeouts = cht,
            cablePackage = pkg,
            maxEventsPerIter = flags_seq_max_events_per_iter,
            maxUsPerIter = flags_seq_max_us_per_iter,
            vaultClient = Just clientEnv,
            kafkaClientId = fromString kafkaClientId',
            redisConn = RBDB.RedisConnection redisBDBPool
          }
  race_ (runLoggingT (runSequencerM seqCfg mCtx (sequencer validators)))
    . run 8050
    $ metricsApp
