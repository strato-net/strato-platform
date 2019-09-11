{-# LANGUAGE DuplicateRecordFields #-}
module Blockchain.Sequencer.Bootstrap (bootstrapSequencer) where

import ClassyPrelude (atomically, newTMChan, newTQueue, fromMaybe)
import qualified Data.ByteString.Char8 as C8

import Blockchain.Constants
import Blockchain.Data.Address
import Blockchain.Data.BlockDB
import Blockchain.EthConf as EC
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Output
import qualified Network.Kafka.Protocol as KP

import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Constants
import Blockchain.Sequencer.DB.DependentBlockDB
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Gregor
import Blockchain.Sequencer.Monad

-- bootstrap genesis block into leveldb if needed
--
bootstrapSequencer :: Block -> IO OutputBlock
bootstrapSequencer Block{blockBlockData = bd,
                    blockReceiptTransactions = txs,
                    blockBlockUncles = us} = do
  pkg <- atomically newCablePackage
  initLevelDB pkg
  initKafka pkg
  return shortCircuit
 where
  shortCircuit :: OutputBlock
  shortCircuit = OutputBlock
               { obOrigin              = TO.Direct
               , obBlockData           = bd
               , obBlockUncles         = us
               , obTotalDifficulty     = difficulty
               , obReceiptTransactions = map kludge txs
               }
  hash       = blockHeaderHash bd
  difficulty = blockDataDifficulty bd
  kludge t   = fromMaybe fallback (wrapIngestBlockTransactionUnanchored hash t)
    where fallback = OutputTx { otOrigin = TO.BlockHash hash
                   , otSigner = Address 0
                   , otBaseTx = t
                   , otHash   = TX.transactionHash t
                   , otAnchorChain = Public
                   }
  initLevelDB :: CablePackage -> IO ()
  initLevelDB pkg = do
      tch <- atomically newTMChan
      vch <- atomically newTQueue
      rch <- atomically newTQueue
      let dummySequencerCfg = SequencerConfig
            { depBlockDBCacheSize   = 0
            , depBlockDBPath        = dbDir "h" ++ sequencerDependentBlockDBPath
            , seenTransactionDBSize = 10
            , syncWrites            = False
            , blockstanbulBlockPeriod = 0
            , blockstanbulRoundPeriod = 0
            , blockstanbulBeneficiary = vch
            , blockstanbulVoteResps = rch
            , blockstanbulTimeouts = tch
            , cablePackage = pkg
            , maxEventsPerIter = 65
            , maxUsPerIter = 20000
            }
      runLoggingT . runSequencerM dummySequencerCfg Nothing $ do
        bootstrapGenesisBlock hash difficulty
  initKafka :: CablePackage -> IO ()
  initKafka pkg = do
      let clientId = KP.KString $ C8.pack defaultKafkaClientId'
          dummyGregorCfg = GregorConfig
            { kafkaAddress = Nothing
            , kafkaClientId = clientId
            , kafkaConsumerGroup = EC.lookupConsumerGroup clientId
            , cablePackage = pkg
            }
      runGregorM dummyGregorCfg $ do
        assertTopicCreation
        writeSeqVmEvents [OSVEBlock shortCircuit]  -- todo handle the error :)
        writeSeqP2pEvents [OSPEBlock shortCircuit]  -- todo handle the error :)
