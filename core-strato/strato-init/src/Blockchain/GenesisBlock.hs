{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.GenesisBlock (
  initializeGenesisBlock,
  BackupType(..)
) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Data.Aeson
import qualified Data.ByteString.Char8                as C8
import qualified Data.ByteString.Lazy.Char8           as BLC

import           Blockchain.BackupBlocks
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Extra
import           Blockchain.Data.GenesisBlock
import           Blockchain.Data.GenesisInfo
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.SHA
import           Blockchain.Stream.VMEvent

import           Blockchain.Strato.StateDiff          hiding (StateDiff (chainId, blockHash))
import qualified Blockchain.Strato.StateDiff          as StateDiff (StateDiff (chainId, blockHash))
import           Blockchain.Strato.StateDiff.Database
import           Blockchain.Strato.StateDiff.Kafka    (filterResponse, splitWriteStateDiffs, assertTopicCreation)

import           Blockchain.Constants                 (dbDir, sequencerDependentBlockDBPath)
import           Blockchain.MilenaTools               (commitSingleOffset)
import           Blockchain.Output                    (printLogMsg)
import           Blockchain.Sequencer                 (bootstrap)
import qualified Blockchain.Sequencer.Constants       as SeqConstants
import           Blockchain.Sequencer.Event           (OutputBlock)
import           Blockchain.Sequencer.Monad
import           Control.Monad.Logger                 (runLoggingT)
import qualified Network.Kafka                        as K
import qualified Network.Kafka.Protocol               as KP

import qualified Data.Map                             as Map

import           Blockchain.EthConf                   (lookupConsumerGroup, runKafkaConfigured)
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.IContext   as IContext
import qualified Blockchain.Strato.Indexer.Kafka      as IdxKafka
import qualified Blockchain.Strato.Indexer.Model      as IdxModel
import qualified Blockchain.Strato.RedisBlockDB       as RBDB
import qualified Database.Persist.Postgresql          as SQL

getGenesisBlockAndPopulateInitialMPs :: (MonadIO m, HasCodeDB m, HasHashDB m, Mem.HasMemAddressStateDB m,
                                         HasStateDB m, HasStorageDB m)
                                     => String
                                     -> m ([(AccountInfo, CodeInfo)], Block)
getGenesisBlockAndPopulateInitialMPs genesisBlockName = do
    theJSONString <- liftIO . BLC.readFile $ genesisBlockName ++ "Genesis.json"
    let theJSON = either error id (eitherDecode theJSONString)
    genesisInfoToGenesisBlock theJSON

data BackupType = NoBackup | BlockBackup | MPBackup

initializeGenesisBlock :: ( MonadResource m
                          , HasCodeDB m
                          , HasHashDB m
                          , Mem.HasMemAddressStateDB m
                          , RBDB.HasRedisBlockDB m
                          , HasSQLDB m
                          , HasStateDB m
                          , HasStorageDB m
                          )
                       => BackupType
                       -> String
                       -> m ()
initializeGenesisBlock backupType genesisBlockName = do
    (srcInfo, genesisBlock, obGB) <-
        case backupType of
            NoBackup -> do
                (si, gb) <- getGenesisBlockAndPopulateInitialMPs genesisBlockName
                _ <- produceVMEvents [ChainBlock gb]
                obGB <- liftIO $ bootstrapSequencer gb
                putGenesisHash $ blockHash gb
                return (si, gb, obGB)
            BlockBackup -> do
                (si, gb) <- getGenesisBlockAndPopulateInitialMPs genesisBlockName
                _ <- produceVMEvents [ChainBlock gb]
                obGB <- liftIO $ bootstrapSequencer gb
                backupBlocks
                putGenesisHash $ blockHash gb
                return (si, gb, obGB)
            MPBackup -> error "MPBackup called"
            --    gb <- backupMP
            --    setStateDBStateRoot $ blockDataStateRoot $ blockBlockData gb
            --    return (gb, undefined)
    [(genBId, _)] <- putBlocks [(SHA 0, 0)] [genesisBlock] False
    genAddrStates <- getAllAddressStates
    accountDiffs <- mapM eventualAccountState . Map.fromList $ map (\(_,a,s) -> (a,s)) genAddrStates
    let genesisChainId = Nothing -- TODO: It's possible that we would call this function for private chain creation
        diff = StateDiff {
        StateDiff.chainId   = genesisChainId,
        blockNumber         = 0,
        StateDiff.blockHash = blockHash genesisBlock,
        createdAccounts     = accountDiffs,
        deletedAccounts     = Map.empty,
        updatedAccounts     = Map.empty
    }
    commitSqlDiffs diff (const "") (const "")
    let writeSource (account, CodeInfo _ name src) = case account of
            NonContract _ _ -> return ()
            ContractNoStorage addr _ _ -> updateSource genesisChainId addr name src
            ContractWithStorage addr _ _ _ -> updateSource genesisChainId addr name src

    forM_ srcInfo writeSource
    -- $logInfoS "Inserting genesis block into RedisDB"
    void . RBDB.withRedisBlockDB $ RBDB.forceBestBlockInfo
        (blockHash genesisBlock)
        (blockDataNumber . blockBlockData $ genesisBlock)
        (blockDataDifficulty . blockBlockData $ genesisBlock)
    liftIO (bootstrapIndexer genBId obGB)
    mErr <- liftIO . runKafkaConfigured "strato-init" $ do
      assertTopicCreation
      splitWriteStateDiffs [diff]
    case filterResponse <$> mErr of
       Right [] -> return ()
       Right errs -> error . show $ errs
       Left err -> error . show $ err

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
                putStrLn $ "will retry bootstrapIndex as I got a broker error: " ++ show (l :: KP.KafkaError)
                runner
            (Left l) -> do
                putStrLn $ "will retry bootstrapIndexer as I got a client error: " ++ show (l :: K.KafkaClientError)
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
    runLoggingT (runSequencerM dummySequencerCfg (bootstrap gb)) printLogMsg
