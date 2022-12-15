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
import           Data.Maybe                           (catMaybes, fromMaybe)
import           Data.List.Split                      (chunksOf)
import qualified Data.Text                            as T
import qualified Data.Text.Encoding                   as T
import           Data.Time.Clock.POSIX
import qualified Data.Sequence                        as S
import           Numeric

import           BlockApps.Logging

import           Blockchain.Database.MerklePatricia

import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.Block
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.GenesisInfo
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB      as Mem
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action             as A
import           Blockchain.Stream.VMEvent

import           Blockchain.Strato.StateDiff          hiding (StateDiff (chainId, blockHash, stateRoot))
import qualified Blockchain.Strato.StateDiff          as StateDiff (StateDiff (chainId, blockHash, stateRoot))
import           Blockchain.Strato.StateDiff.Database

import           Blockchain.Strato.Model.Account
import qualified Blockchain.Strato.Model.Address      as Ad
import           Blockchain.Strato.Model.ExtendedWord

import           Text.Format

initializeBlankStateDB :: ( (Maybe Word256 `A.Alters` StateRoot) m
                          , (StateRoot `A.Alters` NodeData) m
                          )
                       => Maybe Word256 -> m ()
initializeBlankStateDB chainId = initializeBlank >> setStateDBStateRoot chainId emptyTriePtr

putStorageTrie :: ( MonadLogger m
                  , HasHashDB m
                  , Mem.HasMemAddressStateDB m
                  , HasStateDB m
                  , HasStorageDB m
                  , HasMemStorageDB m
                  , (Account `A.Alters` AddressState) m
                  ) =>
                  Account -> [(Word256, Word256)] -> m ()
putStorageTrie account slots = do
    mapM_ (uncurry $ putStorageKeyVal' account) slots
    flushMemStorageDB
    Mem.flushMemAddressStateDB

putAccount :: ( MonadLogger m
              , HasHashDB m
              , Mem.HasMemAddressStateDB m
              , HasStateDB m
              , HasStorageDB m
              , HasMemStorageDB m
              , (Account `A.Alters` AddressState) m
              )
           => Maybe Word256 
           -> AccountInfo
           -> m ()
putAccount chainId acc = case acc of
  NonContract address balance' ->
    A.insert A.Proxy (Account address chainId) blankAddressState{addressStateBalance=balance'}
  ContractNoStorage address balance' codeHash' -> do
    A.insert A.Proxy (Account address chainId) blankAddressState{ addressStateBalance=balance'
                                              , addressStateCodeHash=codeHash'
                                              }
  ContractWithStorage address balance' codeHash' slots -> do
    let acct = Account address chainId
    A.insert A.Proxy acct blankAddressState{ addressStateBalance=balance'
                                           , addressStateCodeHash=codeHash'
                                           }
    putStorageTrie acct slots

initializeStateDB :: ( MonadLogger m
                     , HasHashDB m
                     , Mem.HasMemAddressStateDB m
                     , HasStateDB m
                     , HasStorageDB m
                     , HasMemStorageDB m
                     , (Account `A.Alters` AddressState) m
                     )
                  => Maybe Word256
                  -> [AccountInfo]
                  -> m ()
initializeStateDB chainId addressInfo = do
    initializeBlankStateDB chainId
    mapM_ (putAccount chainId) addressInfo
    Mem.flushMemAddressStateDB

initializeStateDBAndAccountInfos :: ( MonadLogger m
                                    , HasHashDB m
                                    , Mem.HasMemAddressStateDB m
                                    , HasStorageDB m
                                    , HasMemStorageDB m
                                    , (Maybe Word256 `A.Alters` StateRoot) m
                                    , (Account `A.Alters` AddressState) m
                                    , (StateRoot `A.Alters` NodeData) m
                                    , MonadIO m
                                    )
                                 => Maybe Word256
                                 -> [AccountInfo]
                                 -> String
                                 -> m ()
initializeStateDBAndAccountInfos chainId addressInfo genesisBlockName = do
    initializeStateDB chainId addressInfo

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
           let account = Account (Ad.Address $ parseHex a) chainId
           putStorageKeyVal' account (parseHex k) (parseHex v)
         ["a", a, b]  -> do
           let account = Account (Ad.Address $ parseHex a) chainId
           $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
             "adding account: " ++ format account
           A.insert A.Proxy account blankAddressState{addressStateBalance= read b}
         ["a", a, b, c]  -> do
           let account = Account (Ad.Address $ parseHex a) chainId
           $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
             "adding account: " ++ format account
           A.insert A.Proxy account blankAddressState{addressStateBalance=read b,  addressStateCodeHash=EVMCode $ unsafeCreateKeccak256FromWord256 $ parseHex c}
         _ -> error $ "wrong format for accountInfo, line is: " ++ BLC.unpack theLine

      $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
        "flushing batch: " ++ show batchCount
      flushMemStorageDB
      Mem.flushMemAddressStateDB

    forM_ addressInfo $ \account -> do
      $logInfoS "initializeStateDBAndAccountInfos" . T.pack $ show account
      putAccount chainId account
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
  mapM_ (addCode SolidVM . (\(CodeInfo _ src _) -> T.encodeUtf8 src)) x
initializeCodeDB invalidType _ = error $ "error, bad VM type: " ++ invalidType

chainInfoToGenesisState :: ( MonadLogger m
                           , HasCodeDB m
                           , HasHashDB m
                           , Mem.HasMemAddressStateDB m
                           , HasStateDB m
                           , HasStorageDB m
                           , HasMemStorageDB m
                           , (Account `A.Alters` AddressState) m
                           ) =>
                           String -> Maybe Word256 -> ChainInfo -> m StateRoot
chainInfoToGenesisState vmType chainId ci = do
    initializeCodeDB vmType (codeInfo $ chainInfo ci)
    
    initializeStateDB chainId (accountInfo $ chainInfo ci)
    A.lookupWithDefault (Proxy @StateRoot) chainId

zipSourceInfo :: [AccountInfo] -> [CodeInfo] -> [(AccountInfo, CodeInfo)]
zipSourceInfo accounts codes =
  let hashPair c@(CodeInfo bs _ _) = (hash bs, c)
      codeMap = Map.fromList . map hashPair $ codes
      findCodeFor :: AccountInfo -> Maybe (AccountInfo, CodeInfo)
      findCodeFor (NonContract _ _) = Nothing
      findCodeFor acc@(ContractNoStorage _ _ (EVMCode hsh)) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractNoStorage _ _ (SolidVMCode _ hsh)) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor (ContractNoStorage _ _ (CodeAtAccount _ _)) = Nothing -- this is only for the main chain genesis block, so we'll stipulate that it cannot contain references by address
      findCodeFor acc@(ContractWithStorage _ _ (EVMCode hsh) _) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractWithStorage _ _ (SolidVMCode _ hsh) _) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor (ContractWithStorage _ _ (CodeAtAccount _ _) _) = Nothing
  in catMaybes $ map findCodeFor accounts

genesisInfoToGenesisBlock :: ( MonadLogger m
                             , HasCodeDB m
                             , HasHashDB m
                             , Mem.HasMemAddressStateDB m
                             , HasStateDB m
                             , HasStorageDB m
                             , HasMemStorageDB m
                             , (Account `A.Alters` AddressState) m
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
    initializeStateDBAndAccountInfos (Nothing :: Maybe Word256) accounts gn
    sr <- A.lookupWithDefault (Proxy @StateRoot) (Nothing :: Maybe Word256)
    let sourceInfo = zipSourceInfo (accounts ++ as) codes
        bData = BlockData {
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
          }
    return (sourceInfo, Block {
        blockBlockData = bData,
        blockReceiptTransactions = [],
        blockBlockUncles         = []
    })

initializeChainDBs :: ( MonadLogger m
                      , HasCodeDB m
                      , HasHashDB m
                      , HasSQLDB m
                      , HasStateDB m
                      , (Account `A.Alters` AddressState) m
                      , A.Selectable Word256 ParentChainIds m
                      )
                   => Maybe Word256
                   -> ChainInfo
                   -> m ()
initializeChainDBs chainId (ChainInfo UnsignedChainInfo{..} _) = do
  sRoot <- A.lookupWithDefault (A.Proxy @StateRoot) chainId
  genAddrStates <- getAllAddressStates chainId
  accountDiffs <- mapM eventualAccountState . Map.fromList $ genAddrStates
  let diff = StateDiff {
      StateDiff.chainId   = chainId,
      blockNumber         = 0,
      StateDiff.blockHash = unsafeCreateKeccak256FromWord256 0,
      StateDiff.stateRoot = sRoot,
      createdAccounts     = accountDiffs,
      deletedAccounts     = Map.empty,
      updatedAccounts     = Map.empty
  }
  commitSqlDiffs diff

  forM_ [ (src, name) | CodeInfo{codeInfoSource=src, codeInfoName=name} <- codeInfo] $ \(src, name) ->
    produceVMEvents [CodeCollectionAdded src (SolidVMCode (fromMaybe "" $ fmap T.unpack name) $ hash $ BC.pack $ T.unpack src) "" "" []]

  let metadatas = Map.fromList $ flip map codeInfo $ \ci ->
        let cHash = hash $ codeInfoCode ci
            md    = Map.fromList $ [("src",codeInfoSource ci)] ++
                                   case codeInfoName ci of
                                       Nothing -> []
                                       Just n -> [("name", n)]
         in (cHash, md)
      getMetadata mch = fmap (`Map.union` chainMetadata) $ flip Map.lookup metadatas =<< mch
      toAction a d = do
        vm <- codePtrToCodeKind chainId $ codeHash d
        pure A.Action
          { A._blockHash = creationBlock
          , A._blockTimestamp = posixSecondsToUTCTime 0
          , A._blockNumber = 0
          , A._transactionHash = unsafeCreateKeccak256FromWord256 $ fromMaybe 0 chainId
          , A._transactionChainId = chainId
          , A._transactionSender = Account (Ad.Address 0) chainId
          , A._actionData = Map.singleton a $
                             A.ActionData
                               (codeHash d)
                               ""
                               ""
                               vm
                               (case storage d of
                                  EVMDiff m -> A.EVMDiff $ Map.map fromDiff m
                                  SolidVMDiff m -> A.SolidVMDiff $ Map.map fromDiff m)
                               [A.Create]
          , A._metadata = getMetadata ch
          , A._events = S.empty
          }
        where
             ch =
               case codeHash d of
                 EVMCode ch' -> Just ch'
                 SolidVMCode _ ch' -> Just ch'
                 CodeAtAccount _ _ -> Nothing
      fromDiff (Value v) = v
      squashMap f = traverse (uncurry f) . Map.toList
  actions <- squashMap toAction accountDiffs
  _ <- produceVMEvents $ map NewAction actions

  return ()
