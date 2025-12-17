{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Sequencer.Bootstrap (bootstrapSequencer) where

import Blockchain.Constants
import Blockchain.Data.Block
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Model.WrappedBlock
import Blockchain.EthConf (runKafkaMConfigured)
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Constants
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka (writeSeqVmEvents, writeSeqP2pEvents, assertSequencerTopicsCreation)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import ClassyPrelude (atomically, fromMaybe)
import Control.Monad.Composable.Kafka
import qualified Data.ByteString.Char8 as C8

-- | Bootstrap genesis block into LevelDB and Kafka.
--
-- This is a one-time initialization that:
-- 1. Marks the genesis block as 'Emitted' in the DependentBlockDB
-- 2. Creates the sequencer Kafka topics
-- 3. Writes the genesis block to the VM and P2P event topics
bootstrapSequencer :: Block -> IO OutputBlock
bootstrapSequencer
  Block
    { blockBlockData = bd,
      blockReceiptTransactions = txs,
      blockBlockUncles = us
    } = do
    pkg <- atomically newCablePackage
    initLevelDB
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
      initLevelDB :: IO ()
      initLevelDB = do
        let dbPath = dbDir "h" ++ sequencerDependentBlockDBPath
            cacheSize = 0
        runWithDependentBlockDB dbPath cacheSize $
          bootstrapGenesisBlock hash
      initKafka :: CablePackage -> IO ()
      initKafka _ = do
        runKafkaMConfigured (KString $ C8.pack defaultKafkaClientId') $ do
          _ <- assertSequencerTopicsCreation
          _ <- writeSeqVmEvents [VmBlock shortCircuit] -- todo handle the error :)
          _ <- writeSeqP2pEvents [P2pBlock shortCircuit] -- todo handle the error :)
          return ()
