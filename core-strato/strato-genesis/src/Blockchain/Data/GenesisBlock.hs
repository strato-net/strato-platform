{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.Data.GenesisBlock (
  parseHex,
  initializeStateDB,
  chainInfoToGenesisState,
  genesisInfoToGenesisBlock,
  initializeChainDBs
) where

import           Control.Exception
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Crypto.Util                          (i2bs_unsized)
import qualified Data.ByteString.Lazy.Char8           as BLC
import           Data.Maybe                           (catMaybes, fromMaybe)
import           Data.List.Split                      (chunksOf)
import           Data.Time.Clock.POSIX
import           Numeric

import           Blockchain.Database.MerklePatricia

import qualified Blockchain.Data.Action               as A
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.GenesisInfo
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB      as Mem
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.EthConf                   (runKafkaConfigured)
import           Blockchain.Format
import           Blockchain.SHA

import           Blockchain.Strato.StateDiff          hiding (StateDiff (chainId, blockHash, stateRoot))
import qualified Blockchain.Strato.StateDiff          as StateDiff (StateDiff (chainId, blockHash, stateRoot))
import           Blockchain.Strato.StateDiff.Database
import           Blockchain.Strato.StateDiff.Kafka    (writeActionJSONToKafka, filterResponse)

import qualified Data.Map                             as Map

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

putAccount :: (HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
           => AccountInfo
           -> m ()
putAccount acc = case acc of
  NonContract address balance' ->
    putAddressState address blankAddressState{addressStateBalance=balance'}
  ContractNoStorage address balance' codeHash' -> do
    putAddressState address blankAddressState{addressStateBalance=balance',
                                              addressStateCodeHash=codeHash'}
  ContractWithStorage address balance' codeHash' slots -> do
    putAddressState address blankAddressState{addressStateBalance=balance',
                                              addressStateCodeHash=codeHash'}
    putStorageTrie address slots

initializeStateDB :: (HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
                  => [AccountInfo]
                  -> m ()
initializeStateDB addressInfo = do
    initializeBlankStateDB
    mapM_ putAccount addressInfo

initializeStateDBAndAccountInfos :: (HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
                                 => [AccountInfo]
                                 -> String
                                 -> m ()
initializeStateDBAndAccountInfos addressInfo genesisBlockName = do
    initializeStateDB addressInfo

    let accountInfoFilename = genesisBlockName ++ "AccountInfo"

    liftIO $ putStrLn $ "Attempting to read account info from file: " ++ accountInfoFilename

    accountInfoString <-
      liftIO $
      fmap (either (const ""::SomeException->BLC.ByteString) id) $ try $ BLC.readFile accountInfoFilename
    let accountinfo = BLC.lines accountInfoString

    let accountInfoBatches = chunksOf 10000 accountinfo

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

chainInfoToGenesisState :: (HasCodeDB m, HasHashDB m, Mem.HasMemAddressStateDB m, HasStateDB m, HasStorageDB m)
                          => ChainInfo
                          -> m StateRoot
chainInfoToGenesisState ci = do
    initializeCodeDB (codeInfo ci)
    initializeStateDB (accountInfo ci)
    stateRoot <$> getStateDB

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
                          -> [AccountInfo]
                          -> m ([(AccountInfo, CodeInfo)], Block)
genesisInfoToGenesisBlock gi gn as = do
    let codes = genesisInfoCodeInfo gi
    let accounts = genesisInfoAccountInfo gi
    initializeCodeDB codes
    initializeStateDBAndAccountInfos accounts gn
    db <- getStateDB
    let sourceInfo = zipSourceInfo (accounts ++ as) codes
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
            blockDataExtraData = i2bs_unsized $ genesisInfoExtraData gi,
            blockDataMixHash = genesisInfoMixHash gi,
            blockDataNonce = genesisInfoNonce gi
        },
        blockReceiptTransactions = [],
        blockBlockUncles         = []
    })

initializeChainDBs :: ( MonadResource m
                      , HasCodeDB m
                      , HasHashDB m
                      , Mem.HasMemAddressStateDB m
                      , RBDB.HasRedisBlockDB m
                      , HasSQLDB m
                      , HasStateDB m
                      , HasStorageDB m
                      )
                   => Ext.Word256
                   -> ChainInfo
                   -> StateRoot
                   -> m ()
initializeChainDBs chainId ChainInfo{..} sRoot = do
  genAddrStates <- getAllAddressStates
  accountDiffs <- mapM eventualAccountState . Map.fromList $ genAddrStates
  let diff = StateDiff {
      StateDiff.chainId   = Just chainId,
      blockNumber         = 0,
      StateDiff.blockHash = SHA 0,
      StateDiff.stateRoot = sRoot,
      createdAccounts     = accountDiffs,
      deletedAccounts     = Map.empty,
      updatedAccounts     = Map.empty
  }
  commitSqlDiffs diff
  let metadatas = Map.fromList $ flip map codeInfo $ \ci ->
        let cHash = hash $ codeInfoCode ci
            md    = Map.fromList [("src",codeInfoSource ci),("name",codeInfoName ci)]
         in (cHash, md)
      getMetadata = flip Map.lookup metadatas
      toAction a d = A.Action
        { A.actionType = A.Create
        , A.actionBlockHash = SHA 0
        , A.actionBlockTimestamp = posixSecondsToUTCTime 0
        , A.actionBlockNumber = 0
        , A.actionTxHash = SHA chainId
        , A.actionTxChainId = Just chainId
        , A.actionTxSender = Ad.Address 0
        , A.actionAddress = a
        , A.actionCodeHash = codeHash d
        , A.actionStorage = Just . Map.map fromDiff $ storage d
        , A.actionMetadata = getMetadata (codeHash d)
        }
      fromDiff (Value v) = v
      squashMap f = map (uncurry f) . Map.toList
      actions = squashMap toAction accountDiffs
  mErr <- liftIO . runKafkaConfigured "strato-genesis" $ writeActionJSONToKafka actions
  case filterResponse <$> mErr of
    Right [] -> return ()
    Right errs -> error . show $ errs
    Left err -> error . show $ err
