{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Sequencer.Bootstrap (bootstrapSequencer) where

import Blockchain.Constants
import Blockchain.Data.Block
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Model.WrappedBlock
import Blockchain.EthConf (runKafkaMConfigured)
import Blockchain.Sequencer.Constants
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka (writeSeqVmEvents, writeSeqP2pEvents, assertSequencerTopicsCreation)
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Control.Monad.Composable.Kafka
import qualified Data.ByteString.Char8 as C8

-- | Bootstrap genesis block into LevelDB and Kafka.
--
-- This is a one-time initialization that:
-- 1. Marks the genesis block as 'Emitted' in the DependentBlockDB
-- 2. Creates the sequencer Kafka topics
-- 3. Writes the genesis block to the VM and P2P event topics
bootstrapSequencer :: Block -> IO ()
bootstrapSequencer Block{..} = do
    initLevelDB $ blockHeaderHash blockBlockData
    initKafka OutputBlock
      { obOrigin = TO.Direct,
        obBlockData = blockBlockData,
        obBlockUncles = blockBlockUncles,
        obReceiptTransactions = []
      }
      
initLevelDB :: Keccak256 -> IO ()
initLevelDB hash' = do
        let dbPath = dbDir "h" ++ sequencerDependentBlockDBPath
            cacheSize = 0
        runWithDependentBlockDB dbPath cacheSize $
          bootstrapGenesisBlock hash'

initKafka :: OutputBlock -> IO ()
initKafka shortCircuit = do
        runKafkaMConfigured (KString $ C8.pack defaultKafkaClientId') $ do
          _ <- assertSequencerTopicsCreation
          _ <- writeSeqVmEvents [VmBlock shortCircuit]
          _ <- writeSeqP2pEvents [P2pBlock shortCircuit]
          return ()
