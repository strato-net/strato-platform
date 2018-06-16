{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.Data.GenesisBlock (
  genesisInfoToGenesisBlock,
  initializeGenesisBlockFromInfo,
  initializeStateDB,
) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource

import           Blockchain.Database.MerklePatricia

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.GenesisInfo
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.SHA

import           Blockchain.Strato.StateDiff          hiding (StateDiff (chainId, blockHash))
import qualified Blockchain.Strato.StateDiff          as StateDiff (StateDiff (chainId, blockHash))
import           Blockchain.Strato.StateDiff.Database
import           Blockchain.Strato.StateDiff.Kafka    (filterResponse, splitWriteStateDiffs)

import qualified Data.Map                             as Map

import           Blockchain.EthConf                   (runKafkaConfigured)
import qualified Blockchain.Strato.Model.Address      as Ad
import qualified Blockchain.Strato.Model.ExtendedWord as Ext
import qualified Blockchain.Strato.RedisBlockDB       as RBDB

initializeBlankStateDB :: HasStateDB m => m ()
initializeBlankStateDB = do
    db <- getStateDB
    liftIO . runResourceT $ initializeBlank db
    setStateDBStateRoot emptyTriePtr

putStorageTrie :: (HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m) =>
                  Ad.Address -> [(Ext.Word256, Ext.Word256)] -> m ()
putStorageTrie address slots = do
    mapM_ (\(k, v) -> putStorageKeyVal' address k v) slots
    flushMemStorageDB
    Mem.flushMemAddressStateDB

initializeStateDB :: (HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
                  => [AccountInfo]
                  -> m ()
initializeStateDB addressInfo = do
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

initializeCodeDB :: (HasCodeDB m, MonadResource m) => [CodeInfo] -> m ()
initializeCodeDB = mapM_ (addCode . (\(CodeInfo bin _ _) -> bin))

genesisInfoToGenesisBlock :: (HasCodeDB m, HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
                          => GenesisInfo
                          -> m ([(AccountInfo, CodeInfo)], Block)
genesisInfoToGenesisBlock gi = do
    let codes = genesisInfoCodeInfo gi
    let accounts = genesisInfoAccountInfo gi
    let sourceInfo = case codes of
                    [] -> []
                    [c] -> zip accounts (repeat c)
                    _ -> error "not equipped to seed for multiple contract types"
    initializeCodeDB codes
    initializeStateDB accounts
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

initializeGenesisBlockFromInfo :: ( MonadResource m
                                  , HasCodeDB m
                                  , HasHashDB m
                                  , Mem.HasMemAddressStateDB m
                                  , RBDB.HasRedisBlockDB m
                                  , HasSQLDB m
                                  , HasStateDB m
                                  , HasStorageDB m
                                  )
                               => GenesisInfo
                               -> m Block
initializeGenesisBlockFromInfo genesisInfo = do
    (srcInfo, genesisBlock) <- genesisInfoToGenesisBlock genesisInfo
    _ <- putBlocks [(SHA 0, 0)] [genesisBlock] False
    let genesisChainId = genesisInfoChainId genesisInfo
    genAddrStates <- getAllAddressStates
    accountDiffs <- mapM eventualAccountState . Map.fromList $ genAddrStates
    let diff = StateDiff {
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
    mErr <- liftIO . runKafkaConfigured "strato-init" $ do
      splitWriteStateDiffs [diff]
    case filterResponse <$> mErr of
       Right [] -> return genesisBlock
       Right errs -> error . show $ errs
       Left err -> error . show $ err
