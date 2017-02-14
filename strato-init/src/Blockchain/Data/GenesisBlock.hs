{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.Data.GenesisBlock (
  initializeGenesisBlock,
  initializeStateDB,
  BackupType(..)
) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Data.Aeson
import qualified Data.ByteString.Char8              as C8
import qualified Data.ByteString.Lazy.Char8         as BLC

import           Blockchain.Database.MerklePatricia

import           Blockchain.BackupBlocks
import           Blockchain.BackupMP
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.DiffDB
import           Blockchain.Data.Extra
import           Blockchain.Data.GenesisInfo
import           Blockchain.Data.StateDiff          hiding
                                                     (StateDiff (blockHash))
import qualified Blockchain.Data.StateDiff          as StateDiff (StateDiff (blockHash))
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.SHA
import           Blockchain.Stream.VMEvent

import           Blockchain.Constants               (dbDir, sequencerDependentBlockDBPath)
import           Blockchain.Output                  (printLogMsg')
import           Blockchain.Sequencer               (bootstrap)
import qualified Blockchain.Sequencer.Constants     as SeqConstants
import           Blockchain.Sequencer.Monad
import           Control.Monad.Logger               (runLoggingT)
import qualified Network.Kafka.Protocol             as KP

import qualified Data.Map                           as Map

import           Blockchain.EthConf                 (lookupConsumerGroup,
                                                     runKafkaConfigured)
import qualified Blockchain.Strato.Indexer.IContext as Indexer
import qualified Database.Persist.Postgresql        as SQL
import           Network.Kafka.Consumer             (commitSingleOffset)

initializeBlankStateDB :: HasStateDB m => m ()
initializeBlankStateDB = do
    db <- getStateDB
    liftIO . runResourceT $ initializeBlank db
    setStateDBStateRoot emptyTriePtr

initializeStateDB :: (HasStateDB m, HasHashDB m)
                  => [(Address, Integer)]
                  -> m ()
initializeStateDB addressInfo = do
    initializeBlankStateDB
    forM_ addressInfo $ \(address, balance') ->
        putAddressState address blankAddressState{addressStateBalance=balance'}

genesisInfoToGenesisBlock :: (HasStateDB m, HasHashDB m)
                          => GenesisInfo
                          -> m Block
genesisInfoToGenesisBlock gi = do
    initializeStateDB $ genesisInfoAccountInfo gi
    db <- getStateDB
    return Block {
        blockBlockData = BlockData {
            blockDataParentHash = genesisInfoParentHash gi,
            blockDataUnclesHash = genesisInfoUnclesHash gi,
            blockDataCoinbase = genesisInfoCoinbase gi,
            blockDataStateRoot = stateRoot db,
            blockDataTransactionsRoot = genesisInfoTransactionsRoot gi,
            blockDataReceiptsRoot = genesisInfoReceiptsRoot gi,
            blockDataLogBloom = genesisInfoLogBloom gi,
            blockDataDifficulty = genesisInfoDifficulty gi,
            blockDataNumber = genesisInfoNumber gi,
            blockDataGasLimit = genesisInfoGasLimit gi,
            blockDataGasUsed = genesisInfoGasUsed gi,
            blockDataTimestamp = genesisInfoTimestamp gi,
            blockDataExtraData = genesisInfoExtraData gi,
            blockDataMixHash = genesisInfoMixHash gi,
            blockDataNonce = genesisInfoNonce gi
        },
        blockReceiptTransactions = [],
        blockBlockUncles         = []
    }

getGenesisBlockAndPopulateInitialMPs :: (MonadIO m, HasStateDB m, HasHashDB m)
                                     => String
                                     -> m Block
getGenesisBlockAndPopulateInitialMPs genesisBlockName = do
    theJSONString <- liftIO . BLC.readFile $ genesisBlockName ++ "Genesis.json"
    let theJSON = either error id (eitherDecode theJSONString)
    genesisInfoToGenesisBlock theJSON

data BackupType = NoBackup | BlockBackup | MPBackup

initializeGenesisBlock :: (MonadResource m, HasStateDB m, HasCodeDB m, HasSQLDB m, HasHashDB m)
                       => BackupType
                       -> String
                       -> m ()
initializeGenesisBlock backupType genesisBlockName = do
    genesisBlock <-
        case backupType of
            NoBackup -> do
                gb <- getGenesisBlockAndPopulateInitialMPs genesisBlockName
                _ <- produceVMEvents [ChainBlock gb]
                liftIO $ bootstrapSequencer gb
                putGenesisHash $ blockHash gb
                return gb
            BlockBackup -> do
                gb <- getGenesisBlockAndPopulateInitialMPs genesisBlockName
                _ <- produceVMEvents [ChainBlock gb]
                liftIO $ bootstrapSequencer gb
                backupBlocks
                putGenesisHash $ blockHash gb
                return gb
            MPBackup -> do
                gb <- backupMP
                setStateDBStateRoot $ blockDataStateRoot $ blockBlockData gb
                return gb
    [(genBId, _)] <- putBlocks [(SHA 0, 0)] [genesisBlock] False
    genAddrStates <- getAllAddressStates
    accountDiffs <- mapM eventualAccountState $ Map.fromList genAddrStates
    let diff = StateDiff {
        blockNumber         = 0,
        StateDiff.blockHash = blockHash genesisBlock,
        createdAccounts     = accountDiffs,
        deletedAccounts     = Map.empty,
        updatedAccounts     = Map.empty
    }
    commitSqlDiffs diff
    liftIO (bootstrapIndexer genBId)

bootstrapIndexer :: SQL.Key Block -> IO ()
bootstrapIndexer =
    let clientId = fst Indexer.kafkaClientIds
        consumer = snd Indexer.kafkaClientIds
        topic    = Indexer.targetTopicName
        mkMeta   = KP.Metadata . KP.KString . C8.pack . show
    in
        void . runKafkaConfigured clientId . commitSingleOffset consumer topic 0 0 . mkMeta

bootstrapSequencer :: Block -> IO ()
bootstrapSequencer gb = do
    let clientId = KP.KString $ C8.pack SeqConstants.defaultKafkaClientId'
    let dummySequencerCfg = SequencerConfig { depBlockDBCacheSize   = 0
                                            , depBlockDBPath        = dbDir "h" ++ sequencerDependentBlockDBPath
                                            , kafkaClientId         = clientId
                                            , kafkaConsumerGroup    = lookupConsumerGroup clientId
                                            , seenTransactionDBSize = 10
                                            , syncWrites            = False
                                            , bootstrapDoEmit       = True
                                            }
    runLoggingT (runSequencerM dummySequencerCfg (bootstrap gb)) (printLogMsg' True True)
