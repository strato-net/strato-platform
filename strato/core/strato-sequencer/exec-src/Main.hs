{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Main where

import BlockApps.Init
import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.Options ()
import Blockchain.Data.GenesisBlock (genesisInfoToBlock)
import qualified Blockchain.Data.GenesisInfo as GI
import Blockchain.Sequencer.Bootstrap (bootstrapSequencer)
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.EthConf
import Blockchain.Model.SyncState
import Blockchain.Sequencer
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.Address (fromPublicKey)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Strato.Model.Secp256k1 (getPub)
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.SyncDB
import Control.Concurrent.Async as Async
import Control.Concurrent.STM
import Control.Concurrent.STM.TMChan
import Control.Monad
import Control.Monad.Composable.Vault (runVaultM)
import Data.String
import qualified Database.Redis as Redis
import Flags
import HFlags
import Instrumentation
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import Text.Format

main :: IO ()
main = do
  blockappsInit "seq_main"
  runInstrumentation "strato-sequencer"
  s <- $initHFlags "Block/Txn sequencer for the Haskell EVM"

  conn <- Redis.checkedConnect lookupRedisBlockDBConfig

  maybeBestSequencedBlock <- Redis.runRedis conn getBestSequencedBlockInfo
  bestSequencedBlock <- case maybeBestSequencedBlock of
    Just bsb -> return bsb
    Nothing -> do
      putStrLn "No BestSequencedBlock found in Redis, bootstrapping from genesis.json..."
      genesisInfo <- GI.getGenesisInfo
      let genesisBlock = genesisInfoToBlock genesisInfo
          bsb = BestSequencedBlock (blockHash genesisBlock) 0 (GI.validators genesisInfo)
      bootstrapSequencer genesisBlock
      _ <- Redis.runRedis conn $ putBestSequencedBlockInfo bsb
      putStrLn $ "Bootstrapped BestSequencedBlock from genesis.json: " ++ format bsb
      return bsb
  let validators = bestSequencedBlockValidators bestSequencedBlock

  exportFlagsAsMetrics
  putStrLn $ "strato-sequencer ignoring unknown flags: " ++ show s
  putStrLn $ "strato-sequencer network: " ++ show (Conf.network (networkConfig ethConf))
  putStrLn $ "strato-sequencer validators: " ++ show validators
  let vaultUrl' = vaultUrl . urlConfig $ ethConf
  putStrLn $ "strato-sequencer vault URL: " ++ vaultUrl'
  putStrLn $ "strato-sequencer validatorBehavior: " ++ show flags_validatorBehavior

  pkg <- atomically newCablePackage

  selfAddress <- runVaultM vaultUrl' $ do
    pubKey <- getPub
    return $ fromPublicKey pubKey

  putStrLn $ "strato-sequencer nodeAddress: " ++ format selfAddress

  ctx <- do
    let blockPeriodMs' = Conf.blockPeriodMs (networkConfig ethConf)
    let roundPeriodS' = Conf.roundPeriodS (networkConfig ethConf)
    unless (blockPeriodMs' >= 0) . ioError . userError $
      "blockPeriodMs must be nonnegative"
    unless (roundPeriodS' > 0) . ioError . userError $
      "roundPeriodS must be positive"

    putStrLn $ "ACTUAL validators list: " ++ show validators

    let ckpt = def {checkpointValidators = validators, checkpointView=View 0 $ fromIntegral $ bestSequencedBlockNumber bestSequencedBlock}

    return $ newContext (Conf.network (networkConfig ethConf)) ckpt (Just selfAddress) flags_validatorBehavior

  cht <- atomically newTMChan

  let seqCfg =
        SequencerConfig
          { dependentBlockDB = error "Dependent Block DB not initialized",
            depBlockDBCacheSize = flags_depblockcachesize,
            depBlockDBPath = flags_depblockdbpath,
            seenTransactionDBSize = flags_txdedupwindow,
            blockstanbulBlockPeriod = BlockPeriod $ fromIntegral (Conf.blockPeriodMs (networkConfig ethConf)) / 1000.0,
            blockstanbulRoundPeriod = RoundPeriod $ fromIntegral (Conf.roundPeriodS (networkConfig ethConf)),
            blockstanbulTimeouts = cht,
            cablePackage = pkg,
            maxEventsPerIter = flags_seq_max_events_per_iter,
            maxUsPerIter = flags_seq_max_us_per_iter,
            kafkaClientId = fromString flags_kafkaclientid,
            redisConn = RBDB.RedisConnection conn
          }
  race_ (runLoggingT (runSequencerM vaultUrl' seqCfg ctx sequencer))
    . run 8050
    $ metricsApp
