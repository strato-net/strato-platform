{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Main where

import BlockApps.Init
import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.Options ()
import Blockchain.EthConf
import Blockchain.Model.SyncState
import Blockchain.Sequencer
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.Options (flags_network)
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.SyncDB
import Control.Concurrent (threadDelay)
import Control.Concurrent.Async as Async
import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad
import Data.Maybe
import Data.String
import qualified Database.Redis as Redis
import Flags
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Servant.Client (ClientError)
import Strato.Vault.Client (newVaultEnv, runVault)
import qualified Strato.Strato23.API as VC
import qualified Strato.Strato23.Client as VC
import Text.Format

waitOnVault :: IO (Either ClientError b) -> IO b
waitOnVault action = do
  putStrLn "asking vault for the node address"
  res <- action
  case res of
    Left err -> do
      putStrLn $ "failed to get node address from vault: " ++ show err
      threadDelay 2000000 -- 2 seconds
      waitOnVault action
    Right val -> return val

main :: IO ()
main = do
  blockappsInit "seq_main"
  runInstrumentation "strato-sequencer"
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"

  conn <- Redis.checkedConnect lookupRedisBlockDBConfig

  bestSequencedBlock <- fmap (fromMaybe (error "no BestSequencedBlock in database")) $ Redis.runRedis conn getBestSequencedBlockInfo
  let validators = bestSequencedBlockValidators bestSequencedBlock

  exportFlagsAsMetrics
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer network: " ++ show flags_network
  putStrLn $ "strato-sequencer validators: " ++ show validators
  let vaultUrl' = vaultUrl . urlConfig $ ethConf
  putStrLn $ "strato-sequencer vault URL: " ++ vaultUrl'
  putStrLn $ "strato-sequencer validatorBehavior: " ++ show flags_validatorBehavior

  pkg <- atomically newCablePackage

  -- setup the connection with vault
  vaultEnv <- newVaultEnv vaultUrl'

  selfAddress <- do
    addrAndKey <- waitOnVault $ runVault vaultEnv (VC.getKey Nothing Nothing)
    return $ VC.unAddress addrAndKey

  putStrLn $ "strato-sequencer nodeAddress: " ++ format selfAddress

  ctx <- do
    unless (flags_blockstanbul_block_period_ms >= 0) . ioError . userError $
      "--blockstanbul_block_period_ms must be nonnegative"
    unless (flags_blockstanbul_round_period_s > 0) . ioError . userError $
      "--blockstanbul_round_period_s must be positive"

    putStrLn $ "ACTUAL validators list: " ++ show validators

    let ckpt = def {checkpointValidators = validators, checkpointView=View 0 $ fromIntegral $ bestSequencedBlockNumber bestSequencedBlock}

    return $ newContext flags_network ckpt (Just selfAddress) flags_validatorBehavior

  cht <- atomically newTMChan

  let seqCfg =
        SequencerConfig
          { dependentBlockDB = error "Dependent Block DB not initialized",
            depBlockDBCacheSize = flags_depblockcachesize,
            depBlockDBPath = flags_depblockdbpath,
            seenTransactionDBSize = flags_txdedupwindow,
            blockstanbulBlockPeriod = BlockPeriod $ fromIntegral flags_blockstanbul_block_period_ms / 1000.0,
            blockstanbulRoundPeriod = RoundPeriod $ fromIntegral flags_blockstanbul_round_period_s,
            blockstanbulTimeouts = cht,
            cablePackage = pkg,
            maxEventsPerIter = flags_seq_max_events_per_iter,
            maxUsPerIter = flags_seq_max_us_per_iter,
            vaultClient = Just vaultEnv,
            kafkaClientId = fromString flags_kafkaclientid,
            redisConn = RBDB.RedisConnection conn
          }
  race_ (runLoggingT (runSequencerM seqCfg ctx sequencer ))
    . run 8050
    $ metricsApp
