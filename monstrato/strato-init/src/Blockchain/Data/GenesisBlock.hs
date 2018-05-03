{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.Data.GenesisBlock (
  initializeGenesisBlock,
  initializeStateDB,
  BackupType(..)
) where

import           Control.Exception
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import qualified Data.ByteString.Char8                as C8
import qualified Data.ByteString.Lazy.Char8           as BLC
import qualified Data.JsonStream.Parser               as JS
import           Data.Maybe                           (catMaybes)
import           Data.List.Split                      (chunksOf)
import           Numeric

import           Blockchain.Database.MerklePatricia

import           Blockchain.BackupBlocks
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.Extra
import           Blockchain.Data.GenesisInfo
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.Format
import           Blockchain.SHA
import           Blockchain.Stream.VMEvent

import           Blockchain.Strato.StateDiff          hiding (StateDiff (blockHash))
import qualified Blockchain.Strato.StateDiff          as StateDiff (StateDiff (blockHash))
import           Blockchain.Strato.StateDiff.Database
import           Blockchain.Strato.StateDiff.Kafka    (filterResponse, splitWriteStateDiffs, assertTopicCreation)

import           Blockchain.Constants                 (dbDir, sequencerDependentBlockDBPath)
import           Blockchain.Output                    (printLogMsg)
import           Blockchain.Sequencer                 (bootstrap)
import qualified Blockchain.Sequencer.Constants       as SeqConstants
import           Blockchain.Sequencer.Event           (OutputBlock)
import           Blockchain.Sequencer.Monad
import           Control.Monad.Logger                 (runLoggingT)
import qualified Network.Kafka.Protocol               as KP

import qualified Data.Map                             as Map

import           Blockchain.EthConf                   (lookupConsumerGroup, runKafkaConfigured)
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.IContext   as IContext
import qualified Blockchain.Strato.Indexer.Kafka      as IdxKafka
import qualified Blockchain.Strato.Indexer.Model      as IdxModel
import qualified Blockchain.Strato.Model.Address      as Ad
import qualified Blockchain.Strato.Model.ExtendedWord as Ext
import qualified Blockchain.Strato.RedisBlockDB       as RBDB
import qualified Database.Persist.Postgresql          as SQL
import           Blockchain.MilenaTools               (commitSingleOffset)

initializeBlankStateDB :: HasStateDB m => m ()
initializeBlankStateDB = do
    db <- getStateDB
    liftIO . runResourceT $ initializeBlank db
    setStateDBStateRoot emptyTriePtr

putStorageTrie :: (HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m) =>
                  Ad.Address -> [(Ext.Word256, Ext.Word256)] -> m ()
putStorageTrie address slots = do
    let slotss = chunksOf 10000 slots
    forM_ slotss (\ss ->  do
      mapM_ (\(k, v) -> putStorageKeyVal' address k v) ss
      flushMemStorageDB
      Mem.flushMemAddressStateDB)

initializeStateDB :: (HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
                  => [AccountInfo]
                  -> String
                  -> m ()
initializeStateDB addressInfo genesisBlockName = do
    initializeBlankStateDB
    let putAccount acc = case acc of
                              NonContract address balance' ->
                                putAddressState address blankAddressState{addressStateBalance=balance'}
                              ContractNoStorage address balance' codeHash' -> do
                                putAddressState address blankAddressState{addressStateBalance=balance',
                                                                          addressStateCodeHash=codeHash'}
                              ContractWithStorage address balance' codeHash' slots -> do
                                putAddressState address blankAddressState{addressStateBalance=balance',
                                                                          addressStateCodeHash=codeHash'}
                                putStorageTrie address slots
    mapM_ putAccount addressInfo

    let accountInfoFilename = genesisBlockName ++ "AccountInfo"

    liftIO $ putStrLn $ "Attempting to read account info from file: " ++ accountInfoFilename
    
    accountInfoString <-
      liftIO $
      fmap (either (const ""::SomeException->BLC.ByteString) id) $ try $ BLC.readFile accountInfoFilename
    let accountInfo = BLC.lines accountInfoString

    let accountInfoBatches = chunksOf 10000 accountInfo

    forM_ (zip [(1::Integer)..] accountInfoBatches) $ \(batchCount, batch) -> do
      forM_ batch $ \theLine -> do
        case words $ BLC.unpack theLine of
         [] -> return ()
         ["s", a, k, v]  -> do
           let address = Ad.Address $ parseHex a
           putStorageKeyVal' address (parseHex k) (parseHex v)
         ["a", a, b]  -> do
           let address = Ad.Address $ parseHex a
           liftIO $ putStrLn $ "adding account: " ++ format address
           putAddressState address blankAddressState{addressStateBalance= read b}
         ["a", a, b, c]  -> do
           let address = Ad.Address $ parseHex a
           liftIO $ putStrLn $ "adding account: " ++ format address
           putAddressState address blankAddressState{addressStateBalance=read b,  addressStateCodeHash=SHA $ parseHex c}
         _ -> error $ "wrong format for accountInfo, line is: " ++ BLC.unpack theLine

      liftIO $ putStrLn $ "flushing batch: " ++ show batchCount
      flushMemStorageDB
      Mem.flushMemAddressStateDB
    
    forM_ addressInfo $ \account -> do
      liftIO $ print account
      putAccount account


parseHex::(Num a, Eq a)=>String->a
parseHex theString =
  case readHex theString of
   [(value, "")] -> value
   _ -> error $ "parseHex: error parsing string: " ++ theString

initializeCodeDB :: (HasCodeDB m, MonadResource m) => [CodeInfo] -> m ()
initializeCodeDB = mapM_ (addCode . (\(CodeInfo bin _ _) -> bin))

zipSourceInfo :: [AccountInfo] -> [CodeInfo] -> [(AccountInfo, CodeInfo)]
zipSourceInfo accounts codes =
  let hashPair c@(CodeInfo bs _ _) = (hash bs, c)
      codeMap = Map.fromList . map hashPair $ codes
      findCodeFor :: AccountInfo -> Maybe (AccountInfo, CodeInfo)
      findCodeFor (NonContract _ _) = Nothing
      findCodeFor acc@(ContractNoStorage _ _ hsh) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractWithStorage _ _ hsh _) = (acc,) <$> Map.lookup hsh codeMap
  in catMaybes . map findCodeFor $ accounts

genesisInfoToGenesisBlock :: (HasCodeDB m, HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
                          => GenesisInfo
                          -> String
                          -> m ([(AccountInfo, CodeInfo)], Block)
genesisInfoToGenesisBlock gi gn = do
    let codes = genesisInfoCodeInfo gi
    let accounts = genesisInfoAccountInfo gi
    let sourceInfo = zipSourceInfo accounts codes
    initializeCodeDB codes
    initializeStateDB accounts gn
    db <- getStateDB
    return (sourceInfo, Block {
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
            blockDataNonce = genesisInfoNonce gi,
            blockDataChainId = genesisInfoChainId gi
        },
        blockReceiptTransactions = [],
        blockBlockUncles         = []
    })

getGenesisBlockAndPopulateInitialMPs :: (MonadIO m, HasCodeDB m, HasHashDB m, Mem.HasMemAddressStateDB m,
                                         HasStateDB m, HasStorageDB m)
                                     => String
                                     -> m ([(AccountInfo, CodeInfo)], Block)
getGenesisBlockAndPopulateInitialMPs genesisBlockName = do
    theJSONString <- liftIO . BLC.readFile $ genesisBlockName ++ "Genesis.json"
    let [theJSON] = JS.parseLazyByteString genesisParser theJSONString
    genesisInfoToGenesisBlock theJSON genesisBlockName

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
    accountDiffs <- mapM eventualAccountState $ Map.fromList genAddrStates
    let diff = StateDiff {
        blockNumber         = 0,
        StateDiff.blockHash = blockHash genesisBlock,
        createdAccounts     = accountDiffs,
        deletedAccounts     = Map.empty,
        updatedAccounts     = Map.empty
    }
    commitSqlDiffs diff (const (return "")) (const (return ""))
    let writeSource (account, CodeInfo _ name src) = case account of
            NonContract _ _ -> return ()
            ContractNoStorage addr _ _ -> updateSource addr name src
            ContractWithStorage addr _ _ _ -> updateSource addr name src

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
    runLoggingT (runSequencerM dummySequencerCfg (bootstrap gb)) printLogMsg
