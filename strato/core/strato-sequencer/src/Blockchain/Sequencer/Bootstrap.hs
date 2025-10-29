{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Sequencer.Bootstrap (bootstrapSequencer) where

import BlockApps.Logging
import Blockchain.Constants
import Blockchain.Data.Block
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.Transaction as TX
import Blockchain.EthConf as EC
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Constants
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka (writeSeqVmEvents, writeSeqP2pEvents, assertSequencerTopicsCreation)
import Blockchain.Sequencer.Monad
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import ClassyPrelude (atomically, fromMaybe, newTMChan)
import Control.Monad.Composable.Kafka
import qualified Data.ByteString.Char8 as C8
import Network.HTTP.Client (defaultManagerSettings, newManager)
import Servant.Client

-- bootstrap genesis block into leveldb if needed
--
bootstrapSequencer :: Block -> IO OutputBlock
bootstrapSequencer
  Block
    { blockBlockData = bd,
      blockReceiptTransactions = txs,
      blockBlockUncles = us
    } = do
    pkg <- atomically newCablePackage
    initLevelDB pkg
    initKafka pkg
    return shortCircuit
    where
      shortCircuit :: OutputBlock
      shortCircuit =
        OutputBlock
          { obOrigin = TO.Direct,
            obBlockData = bd,
            obBlockUncles = us,
            obReceiptTransactions = map kludge txs
          }
      hash = blockHeaderHash bd
      kludge t = fromMaybe fallback (wrapIngestBlockTransactionUnanchored hash t)
        where
          fallback =
            OutputTx
              { otOrigin = TO.BlockHash hash,
                otSigner = Address 0,
                otBaseTx = t,
                otHash = TX.transactionHash t
              }
      initLevelDB :: CablePackage -> IO ()
      initLevelDB pkg = do
        tch <- atomically newTMChan

        -- initialize vault client, TODO: make this URL a cl arg
        mgr <- newManager defaultManagerSettings
        vaultWrapperUrl <- parseBaseUrl "http://localhost:8013/strato/v2.3"
        let clientEnv = mkClientEnv mgr vaultWrapperUrl

            dummySequencerCfg =
              SequencerConfig
                { dependentBlockDB = error "Dependent Block DB not initialized",
                  depBlockDBCacheSize = 0,
                  depBlockDBPath = dbDir "h" ++ sequencerDependentBlockDBPath,
                  seenTransactionDBSize = 10,
                  blockstanbulBlockPeriod = BlockPeriod 0,
                  blockstanbulRoundPeriod = RoundPeriod 0,
                  blockstanbulTimeouts = tch,
                  cablePackage = pkg,
                  maxEventsPerIter = 65,
                  maxUsPerIter = 20000,
                  vaultClient = Just clientEnv,
                  kafkaClientId = KString $ C8.pack defaultKafkaClientId',
                  redisConn = error "initLevelDB: redisConn"
                }
        runLoggingT . runSequencerM dummySequencerCfg Nothing $ do
          bootstrapGenesisBlock hash
      initKafka :: CablePackage -> IO ()
      initKafka _ = do
        runKafkaMConfigured (KString $ C8.pack defaultKafkaClientId') $ do
          _ <- assertSequencerTopicsCreation
          _ <- writeSeqVmEvents [VmBlock shortCircuit] -- todo handle the error :)
          _ <- writeSeqP2pEvents [P2pBlock shortCircuit] -- todo handle the error :)
          return ()
