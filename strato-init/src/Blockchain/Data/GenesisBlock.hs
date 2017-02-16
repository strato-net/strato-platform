{-# LANGUAGE LambdaCase        #-}
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
import qualified Data.ByteString.Char8                as C8
import qualified Data.ByteString.Lazy.Char8           as BLC

import           Blockchain.Database.MerklePatricia

import           Blockchain.BackupBlocks
--import           Blockchain.BackupMP
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.DiffDB
import           Blockchain.Data.Extra
import           Blockchain.Data.GenesisInfo
import           Blockchain.Data.StateDiff            hiding
                                                       (StateDiff (blockHash))
import qualified Blockchain.Data.StateDiff            as StateDiff (StateDiff (blockHash))
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.SHA
import           Blockchain.Stream.VMEvent

import           Blockchain.Constants                 (dbDir, sequencerDependentBlockDBPath)
import           Blockchain.Output                    (printLogMsg')
import           Blockchain.Sequencer                 (bootstrap)
import qualified Blockchain.Sequencer.Constants       as SeqConstants
import           Blockchain.Sequencer.Event           (OutputBlock)
import           Blockchain.Sequencer.Monad
import           Control.Monad.Logger                 (runLoggingT)
import qualified Network.Kafka.Protocol               as KP

import qualified Data.Map                             as Map

import           Blockchain.EthConf                   (lookupConsumerGroup,
                                                       runKafkaConfigured)
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.IContext   as IContext
import qualified Blockchain.Strato.Indexer.Kafka      as IdxKafka
import qualified Blockchain.Strato.Indexer.Model      as IdxModel
import qualified Blockchain.Strato.RedisBlockDB       as RBDB
import qualified Database.Persist.Postgresql          as SQL
import           Network.Kafka.Consumer               (commitSingleOffset)

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

initializeGenesisBlock :: ( MonadResource m
                          , HasStateDB m
                          , HasCodeDB m
                          , HasSQLDB m
                          , HasHashDB m
                          , RBDB.HasRedisBlockDB m
                          )
                       => BackupType
                       -> String
                       -> m ()
initializeGenesisBlock backupType genesisBlockName = do
    (genesisBlock, obGB) <-
        case backupType of
            NoBackup -> do
                gb <- getGenesisBlockAndPopulateInitialMPs genesisBlockName
                _ <- produceVMEvents [ChainBlock gb]
                obGB <- liftIO $ bootstrapSequencer gb
                putGenesisHash $ blockHash gb
                return (gb, obGB)
            BlockBackup -> do
                gb <- getGenesisBlockAndPopulateInitialMPs genesisBlockName
                _ <- produceVMEvents [ChainBlock gb]
                obGB <- liftIO $ bootstrapSequencer gb
                backupBlocks
                putGenesisHash $ blockHash gb
                return (gb, obGB)
            MPBackup -> error "MPBackup called" 
            --    gb <- backupMP
            --    setStateDBStateRoot $ blockDataStateRoot $ blockBlockData gb
            --    return (gb, undefined)
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
    -- $logInfoS "Inserting genesis block into RedisDB"
    void . RBDB.withRedisBlockDB $ RBDB.forceBestBlockInfo 
        (blockHash genesisBlock)
        (blockDataNumber . blockBlockData $ genesisBlock)
        (blockDataDifficulty . blockBlockData $ genesisBlock)
    liftIO (bootstrapIndexer genBId obGB)

bootstrapIndexer :: SQL.Key Block -> OutputBlock -> IO ()
bootstrapIndexer key obGB =
    let clientId = fst ApiIndexer.kafkaClientIds
        consumer = snd ApiIndexer.kafkaClientIds
        topic    = IContext.targetTopicName
        ibbi     = IContext.IndexerBestBlockInfo key
        mkMeta   = KP.Metadata . KP.KString . C8.pack . show $ IContext.unIBBI ibbi
        commit   = do
            putStrLn $ "Bootstrapping indexer with " ++ show ibbi
            runKafkaConfigured clientId $
                commitSingleOffset consumer topic 0 0 mkMeta
        runner = commit >>= \case
            Right (Right _) -> do
                putStrLn "bootstrapIndex API checkpoint successful!"
                void . runKafkaConfigured clientId $ -- todo handle the error :)
                    IdxKafka.writeIndexEvents [IdxModel.RanBlock obGB]
                putStrLn "bootstrapIndex genesis seed successful!"
            Right (Left l) -> do
                putStrLn $ "will retry bootstrapIndex as I got a broker error: " ++ show l
                runner
            l -> do
                putStrLn $ "will retry bootstrapIndexer as I got a client error: " ++ show l
                runner
    in runner


bootstrapSequencer :: Block -> IO OutputBlock
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
