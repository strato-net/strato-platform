{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE TypeApplications #-}
module Blockchain.Sequencer.Bootstrap (bootstrapSequencer) where

import           ClassyPrelude (atomically, newTMChan, newTQueue, fromMaybe)
import qualified Control.Monad.Change.Alter as A
import qualified Data.ByteString.Char8 as C8

import           BlockApps.Logging
import           Blockchain.Constants
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.EthConf as EC
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.Transaction as TX
import           Blockchain.Privacy.Monad
import           Blockchain.Strato.Model.Class
import qualified Network.Kafka.Protocol as KP

import           Blockchain.Sequencer.CablePackage
import           Blockchain.Sequencer.Constants
import           Blockchain.Sequencer.DB.DependentBlockDB
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Gregor
import           Blockchain.Sequencer.Monad
import           Blockchain.Strato.Model.Address

import           Network.HTTP.Client        (newManager, defaultManagerSettings)
import           Servant.Client

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
                   , otPrivatePayload = Nothing
                   }
  initLevelDB :: CablePackage -> IO ()
  initLevelDB pkg = do
      tch <- atomically newTMChan
      vch <- atomically newTQueue
      rch <- atomically newTQueue
      
      -- initialize vault client, TODO: make this URL a cl arg
      mgr <- newManager defaultManagerSettings
      vaultProxyUrl <- parseBaseUrl "http://strato:8013/" --Might have a harder time removing hardcoding here, no real way to implement flags
      let clientEnv = mkClientEnv mgr vaultProxyUrl

          dummySequencerCfg = SequencerConfig
            { depBlockDBCacheSize   = 0
            , depBlockDBPath        = dbDir "h" ++ sequencerDependentBlockDBPath
            , seenTransactionDBSize = 10
            , syncWrites            = False
            , blockstanbulBlockPeriod = BlockPeriod 0
            , blockstanbulRoundPeriod = RoundPeriod 0
            , blockstanbulBeneficiary = vch
            , blockstanbulVoteResps = rch
            , blockstanbulTimeouts = tch
            , cablePackage = pkg
            , maxEventsPerIter = 65
            , maxUsPerIter = 20000
            , vaultClient = Just clientEnv
            }
      runLoggingT . runSequencerM dummySequencerCfg Nothing $ do
        bootstrapGenesisBlock hash difficulty
        A.insert (A.Proxy @EmittedBlock) hash alreadyEmittedBlock
        flushLdbBatchOps
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
        writeSeqVmEvents [VmBlock shortCircuit]  -- todo handle the error :)
        writeSeqP2pEvents [P2pBlock shortCircuit]  -- todo handle the error :)
