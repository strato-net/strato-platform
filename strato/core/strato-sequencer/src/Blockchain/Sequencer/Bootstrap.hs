{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE TypeApplications #-}
module Blockchain.Sequencer.Bootstrap (bootstrapSequencer) where

import           ClassyPrelude (atomically, newTMChan, fromMaybe)
import qualified Control.Monad.Change.Alter as A
import qualified Data.ByteString.Char8 as C8
import           Data.Foldable (for_)

import           BlockApps.Logging
import           BlockApps.X509.Certificate
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
bootstrapSequencer :: [(Address, X509CertInfoState)] -> Block -> IO OutputBlock
bootstrapSequencer extraCerts Block{blockBlockData = bd,
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
                   , otPrivatePayload = Nothing
                   }
  initLevelDB :: CablePackage -> IO ()
  initLevelDB pkg = do
      tch <- atomically newTMChan
      
      -- initialize vault client, TODO: make this URL a cl arg
      mgr <- newManager defaultManagerSettings
      vaultWrapperUrl <- parseBaseUrl "http://vault-wrapper:8000/strato/v2.3"
      let clientEnv = mkClientEnv mgr vaultWrapperUrl

          dummySequencerCfg = SequencerConfig
            { depBlockDBCacheSize   = 0
            , depBlockDBPath        = dbDir "h" ++ sequencerDependentBlockDBPath
            , seenTransactionDBSize = 10
            , syncWrites            = False
            , blockstanbulBlockPeriod = BlockPeriod 0
            , blockstanbulRoundPeriod = RoundPeriod 0
            , blockstanbulTimeouts = tch
            , cablePackage = pkg
            , maxEventsPerIter = 65
            , maxUsPerIter = 20000
            , vaultClient = Just clientEnv
            }
      runLoggingT . runSequencerM dummySequencerCfg Nothing $ do
        bootstrapGenesisBlock hash difficulty
        A.insert (A.Proxy @EmittedBlock) hash alreadyEmittedBlock
        for_ extraCerts . uncurry $ A.insert (A.Proxy @X509CertInfoState)
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
