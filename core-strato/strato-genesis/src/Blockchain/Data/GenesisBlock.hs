{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE MonoLocalBinds    #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.Data.GenesisBlock (
  parseHex,
  initializeStateDB,
  chainInfoToGenesisState,
  genesisInfoToGenesisBlock,
  initializeChainDBs
) where

import           Control.Exception
import           Control.Monad
import qualified Control.Monad.Change.Alter           as A
import           Control.Monad.Change.Modify
import           Control.Monad.IO.Class
import           Crypto.Util                          (i2bs_unsized)
import qualified Data.ByteString.Char8                as BC
import qualified Data.ByteString.Lazy.Char8           as BLC
import qualified Data.Map                             as Map
import           Data.Maybe                           (catMaybes)
import           Data.List.Split                      (chunksOf)
import qualified Data.Text                            as T
import           Data.Time.Clock.POSIX
import           Numeric

import           Blockchain.Database.MerklePatricia

import qualified Blockchain.Strato.Model.Action               as A
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
import           Blockchain.Output
import           Blockchain.SHA

import           Blockchain.Strato.StateDiff          hiding (StateDiff (chainId, blockHash, stateRoot))
import qualified Blockchain.Strato.StateDiff          as StateDiff (StateDiff (chainId, blockHash, stateRoot))
import           Blockchain.Strato.StateDiff.Database
import           Blockchain.Strato.StateDiff.Kafka    (writeActionJSONToKafka, filterResponse)

import qualified Blockchain.Strato.Model.Address      as Ad
import qualified Blockchain.Strato.Model.ExtendedWord as Ext

import           Text.Format

initializeBlankStateDB :: (Modifiable StateRoot m, (StateRoot `A.Alters` NodeData) m) => m ()
initializeBlankStateDB = initializeBlank >> setStateDBStateRoot emptyTriePtr

putStorageTrie :: ( MonadLogger m
                  , HasHashDB m
                  , Mem.HasMemAddressStateDB m
                  , HasStateDB m
                  , HasStorageDB m
                  , HasMemStorageDB m
                  , (Ad.Address `A.Alters` AddressState) m
                  ) =>
                  Ad.Address -> [(Ext.Word256, Ext.Word256)] -> m ()
putStorageTrie address slots = do
    mapM_ (uncurry $ putStorageKeyVal' address) slots
    flushMemStorageDB
    Mem.flushMemAddressStateDB

putAccount :: ( MonadLogger m
              , HasHashDB m
              , Mem.HasMemAddressStateDB m
              , HasStateDB m
              , HasStorageDB m
              , HasMemStorageDB m
              , (Ad.Address `A.Alters` AddressState) m
              )
           => AccountInfo
           -> m ()
putAccount acc = case acc of
  NonContract address balance' ->
    A.insert A.Proxy address blankAddressState{addressStateBalance=balance'}
  ContractNoStorage address balance' codeHash' -> do
    A.insert A.Proxy address blankAddressState{ addressStateBalance=balance'
                                              , addressStateCodeHash=codeHash'
                                              }
  ContractWithStorage address balance' codeHash' slots -> do
    A.insert A.Proxy address blankAddressState{ addressStateBalance=balance'
                                              , addressStateCodeHash=codeHash'
                                              }
    putStorageTrie address slots

initializeStateDB :: ( MonadLogger m
                     , HasHashDB m
                     , Mem.HasMemAddressStateDB m
                     , HasStateDB m
                     , HasStorageDB m
                     , HasMemStorageDB m
                     , (Ad.Address `A.Alters` AddressState) m
                     )
                  => [AccountInfo]
                  -> m ()
initializeStateDB addressInfo = do
    initializeBlankStateDB
    mapM_ putAccount addressInfo
    Mem.flushMemAddressStateDB

initializeStateDBAndAccountInfos :: ( MonadLogger m
                                    , HasHashDB m
                                    , Mem.HasMemAddressStateDB m
                                    , HasStorageDB m
                                    , HasMemStorageDB m
                                    , Modifiable StateRoot m
                                    , (Ad.Address `A.Alters` AddressState) m
                                    , (StateRoot `A.Alters` NodeData) m
                                    , MonadIO m
                                    )
                                 => [AccountInfo]
                                 -> String
                                 -> m ()
initializeStateDBAndAccountInfos addressInfo genesisBlockName = do
    initializeStateDB addressInfo

    let accountInfoFilename = genesisBlockName ++ "AccountInfo"

    $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
      "Attempting to read account info from file: " ++ accountInfoFilename

    accountInfoBatches <- fmap (chunksOf 10000 . BLC.lines) $
      liftIO $
      fmap (either (const ""::SomeException->BLC.ByteString) id) $ try $ BLC.readFile accountInfoFilename

    forM_ (zip [(1::Integer)..] accountInfoBatches) $ \(batchCount, batch) -> do
      forM_ batch $ \theLine -> do
        case words $ BLC.unpack theLine of
         [] -> return ()
         ["s", a, k, v]  -> do
           let address = Ad.Address $ parseHex a
           putStorageKeyVal' address (parseHex k) (parseHex v)
         ["a", a, b]  -> do
           let address = Ad.Address $ parseHex a
           $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
             "adding account: " ++ format address
           A.insert A.Proxy address blankAddressState{addressStateBalance= read b}
         ["a", a, b, c]  -> do
           let address = Ad.Address $ parseHex a
           $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
             "adding account: " ++ format address
           A.insert A.Proxy address blankAddressState{addressStateBalance=read b,  addressStateCodeHash=EVMCode $ SHA $ parseHex c}
         _ -> error $ "wrong format for accountInfo, line is: " ++ BLC.unpack theLine

      $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
        "flushing batch: " ++ show batchCount
      flushMemStorageDB
      Mem.flushMemAddressStateDB

    forM_ addressInfo $ \account -> do
      $logInfoS "initializeStateDBAndAccountInfos" . T.pack $ show account
      putAccount account
    Mem.flushMemAddressStateDB


parseHex::(Num a, Eq a)=>String->a
parseHex theString =
  case readHex theString of
   [(value, "")] -> value
   _ -> error $ "parseHex: error parsing string: " ++ theString

initializeCodeDB :: HasCodeDB m => String -> [CodeInfo] -> m ()
initializeCodeDB "EVM" x = do
  mapM_ (addCode EVM . (\(CodeInfo bin _ _) -> bin)) x
initializeCodeDB "SolidVM" x = do
  mapM_ (addCode SolidVM . (\(CodeInfo _ src _) -> BC.pack $ T.unpack src)) x
initializeCodeDB invalidType _ = error $ "error, bad VM type: " ++ invalidType

chainInfoToGenesisState :: ( MonadLogger m
                           , HasCodeDB m
                           , HasHashDB m
                           , Mem.HasMemAddressStateDB m
                           , HasStateDB m
                           , HasStorageDB m
                           , HasMemStorageDB m
                           , (Ad.Address `A.Alters` AddressState) m
                           ) =>
                           String -> ChainInfo -> m StateRoot
chainInfoToGenesisState vmType ci = do
    initializeCodeDB vmType (codeInfo $ chainInfo ci)
    
    initializeStateDB (accountInfo $ chainInfo ci)
    get (Proxy @StateRoot)

zipSourceInfo :: [AccountInfo] -> [CodeInfo] -> [(AccountInfo, CodeInfo)]
zipSourceInfo accounts codes =
  let hashPair c@(CodeInfo bs _ _) = (hash bs, c)
      codeMap = Map.fromList . map hashPair $ codes
      findCodeFor :: AccountInfo -> Maybe (AccountInfo, CodeInfo)
      findCodeFor (NonContract _ _) = Nothing
      findCodeFor acc@(ContractNoStorage _ _ (EVMCode hsh)) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractNoStorage _ _ (SolidVMCode _ hsh)) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractWithStorage _ _ (EVMCode hsh) _) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractWithStorage _ _ (SolidVMCode _ hsh) _) = (acc,) <$> Map.lookup hsh codeMap
  in catMaybes . map findCodeFor $ accounts

genesisInfoToGenesisBlock :: ( MonadLogger m
                             , HasCodeDB m
                             , HasHashDB m
                             , Mem.HasMemAddressStateDB m
                             , HasStateDB m
                             , HasStorageDB m
                             , HasMemStorageDB m
                             , (Ad.Address `A.Alters` AddressState) m
                             , MonadIO m
                             )
                          => GenesisInfo
                          -> String
                          -> [AccountInfo]
                          -> m ([(AccountInfo, CodeInfo)], Block)
genesisInfoToGenesisBlock gi gn as = do
    let codes = genesisInfoCodeInfo gi
    let accounts = genesisInfoAccountInfo gi
    initializeCodeDB "EVM" codes
    initializeStateDBAndAccountInfos accounts gn
    sr <- get (Proxy @StateRoot)
    let sourceInfo = zipSourceInfo (accounts ++ as) codes
    return (sourceInfo, Block {
        blockBlockData = BlockData {
            blockDataParentHash = genesisInfoParentHash gi,
            blockDataUnclesHash = genesisInfoUnclesHash gi,
            blockDataCoinbase = genesisInfoCoinbase gi,
            blockDataStateRoot = sr,
            blockDataTransactionsRoot = genesisInfoTransactionRoot gi,
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

initializeChainDBs :: ( HasCodeDB (t m)
                      , HasHashDB (t m)
                      , WrapsSQLDB t m
                      , HasStateDB (t m)
                      , MonadIO (t m)
                      )
                   => Ext.Word256
                   -> ChainInfo
                   -> StateRoot
                   -> t m ()
initializeChainDBs chainId (ChainInfo UnsignedChainInfo{..} _) sRoot = do
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
  runWithSQL $ commitSqlDiffs diff
  let metadatas = Map.fromList $ flip map codeInfo $ \ci ->
        let cHash = hash $ codeInfoCode ci
            md    = Map.fromList [("src",codeInfoSource ci),("name",codeInfoName ci)]
         in (cHash, md)
      getMetadata = fmap (`Map.union` chainMetadata) . flip Map.lookup metadatas
      toAction a d = A.Action
        { A._actionBlockHash = creationBlock
        , A._actionBlockTimestamp = posixSecondsToUTCTime 0
        , A._actionBlockNumber = 0
        , A._actionTransactionHash = SHA chainId
        , A._actionTransactionChainId = Just chainId
        , A._actionTransactionSender = Ad.Address 0
        , A._actionData = Map.singleton a $
                           A.ActionData
                             (codeHash d)
                             vmType
                             (case storage d of
                                EVMDiff m -> A.ActionEVMDiff $ Map.map fromDiff m
                                SolidVMDiff m -> A.ActionSolidVMDiff $ Map.map fromDiff m)
                             [A.emptyCallData]
        , A._actionMetadata = getMetadata ch
        }
        where
             ch =
               case codeHash d of
                 EVMCode ch' -> ch'
                 SolidVMCode _ ch' -> ch'
             vmType = case codeHash d of
                 EVMCode _ -> EVM
                 SolidVMCode _ _ -> SolidVM
      fromDiff (Value v) = v
      squashMap f = map (uncurry f) . Map.toList
      actions = squashMap toAction accountDiffs
  mErr <- liftIO . runKafkaConfigured "strato-genesis" $ writeActionJSONToKafka actions
  case filterResponse <$> mErr of
    Right [] -> return ()
    Right errs -> error . show $ errs
    Left err -> error . show $ err
