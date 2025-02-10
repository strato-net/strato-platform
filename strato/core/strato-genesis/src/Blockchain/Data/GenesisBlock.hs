{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Data.GenesisBlock
  ( parseHex,
    initializeStateDB,
    genesisInfoToGenesisBlock,
  )
where

import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.DB.RawStorageDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.GenesisInfo
import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia
import Blockchain.Strato.Model.Address hiding (parseHex)
import qualified Blockchain.Strato.Model.Address as Ad
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Arrow ((***))
import Control.Exception
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Change.Modify
import Control.Monad.IO.Class
import Crypto.Util (i2bs_unsized)
import Data.ByteString as BS hiding (map, zip)
import qualified Data.ByteString.Lazy.Char8 as BLC
import Data.List.Split (chunksOf)
import qualified Data.Map as Map
import Data.Maybe (catMaybes)
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Numeric
import Text.Format

initializeBlankStateDB ::
  ( (Maybe Word256 `A.Alters` StateRoot) m,
    (StateRoot `A.Alters` NodeData) m
  ) =>
  m ()
initializeBlankStateDB = initializeBlank >> setStateDBStateRoot Nothing emptyTriePtr

putStorageTrie ::
  ( MonadLogger m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasRawStorageDB m,
    HasMemRawStorageDB m,
    (Address `A.Alters` AddressState) m
  ) =>
  Address ->
  [(BS.ByteString, BS.ByteString)] ->
  m ()
putStorageTrie account slots = do
  mapM_ (\slot -> putRawStorageKeyVal' (account, fst slot) (snd slot)) slots
  flushMemStorageDB
  Mem.flushMemAddressStateDB

putAccount ::
  ( MonadLogger m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    (Address `A.Alters` AddressState) m
  ) =>
  AccountInfo ->
  m ()
putAccount acc = case acc of
  NonContract address balance' ->
    A.insert A.Proxy address blankAddressState {addressStateBalance = balance'}
  ContractNoStorage address balance' codeHash' -> do
    A.insert
      A.Proxy
      address
      blankAddressState
        { addressStateBalance = balance',
          addressStateCodeHash = codeHash'
        }
  ContractWithStorage address balance' codeHash' slots -> do
    A.insert
      A.Proxy
      address
      blankAddressState
        { addressStateBalance = balance',
          addressStateCodeHash = codeHash'
        }
    putStorageTrie address $ map (word256ToBytes *** (rlpSerialize . rlpEncode)) slots
  SolidVMContractWithStorage address balance' codeHash' slots -> do
    A.insert
      A.Proxy
      address
      blankAddressState
        { addressStateBalance = balance',
          addressStateCodeHash = codeHash'
        }
    putStorageTrie address slots

initializeStateDB ::
  ( MonadLogger m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    (Address `A.Alters` AddressState) m
  ) =>
  [AccountInfo] ->
  m ()
initializeStateDB addressInfo = do
  initializeBlankStateDB
  mapM_ putAccount addressInfo
  Mem.flushMemAddressStateDB

initializeStateDBAndAccountInfos ::
  ( MonadLogger m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    (Maybe Word256 `A.Alters` StateRoot) m,
    (Address `A.Alters` AddressState) m,
    (StateRoot `A.Alters` NodeData) m,
    MonadIO m
  ) =>
  [AccountInfo] ->
  String ->
  m ()
initializeStateDBAndAccountInfos addressInfo genesisBlockName = do
  initializeStateDB addressInfo

  let accountInfoFilename = genesisBlockName ++ "AccountInfo"

  $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
    "Attempting to read account info from file: " ++ accountInfoFilename

  accountInfoBatches <-
    fmap (chunksOf 10000 . BLC.lines) $
      liftIO $
        fmap (either (const "" :: SomeException -> BLC.ByteString) id) $ try $ BLC.readFile accountInfoFilename

  forM_ (zip [(1 :: Integer) ..] accountInfoBatches) $ \(batchCount, batch) -> do
    forM_ batch $ \theLine -> do
      case words $ BLC.unpack theLine of
        [] -> return ()
        ["s", a, k, v] -> do
          let address = Ad.Address $ parseHex a
          putStorageKeyVal' address (parseHex k) (parseHex v)
        ["a", a, b] -> do
          let address = Ad.Address $ parseHex a
          $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
            "adding account: " ++ format address
          A.insert A.Proxy address blankAddressState {addressStateBalance = read b}
        ["a", a, b, c] -> do
          let address = Ad.Address $ parseHex a
          $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
            "adding address: " ++ format address
          A.insert A.Proxy address blankAddressState {addressStateBalance = read b, addressStateCodeHash = ExternallyOwned $ unsafeCreateKeccak256FromWord256 $ parseHex c}
        _ -> error $ "wrong format for accountInfo, line is: " ++ BLC.unpack theLine

    $logInfoS "initializeStateDBAndAccountInfos" . T.pack $
      "flushing batch: " ++ show batchCount
    flushMemStorageDB
    Mem.flushMemAddressStateDB

  forM_ addressInfo $ \account -> do
    $logInfoS "initializeStateDBAndAccountInfos" . T.pack $ format account
    putAccount account
  Mem.flushMemAddressStateDB

parseHex :: (Num a, Eq a) => String -> a
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

zipSourceInfo :: [AccountInfo] -> [CodeInfo] -> [(AccountInfo, CodeInfo)]
zipSourceInfo accounts codes =
  let hashPair c@(CodeInfo bs _ _) = (hash bs, c)
      codeMap = Map.fromList . map hashPair $ codes
      findCodeFor :: AccountInfo -> Maybe (AccountInfo, CodeInfo)
      findCodeFor (NonContract _ _) = Nothing
      findCodeFor acc@(ContractNoStorage _ _ (ExternallyOwned hsh)) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractNoStorage _ _ (SolidVMCode _ hsh)) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor (ContractNoStorage _ _ (CodeAtAccount _ _)) = Nothing -- this is only for the main chain genesis block, so we'll stipulate that it cannot contain references by address
      findCodeFor acc@(ContractWithStorage _ _ (ExternallyOwned hsh) _) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(ContractWithStorage _ _ (SolidVMCode _ hsh) _) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor (ContractWithStorage _ _ (CodeAtAccount _ _) _) = Nothing
      findCodeFor acc@(SolidVMContractWithStorage _ _ (ExternallyOwned hsh) _) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor acc@(SolidVMContractWithStorage _ _ (SolidVMCode _ hsh) _) = (acc,) <$> Map.lookup hsh codeMap
      findCodeFor (SolidVMContractWithStorage _ _ (CodeAtAccount _ _) _) = Nothing
   in catMaybes $ map findCodeFor accounts

genesisInfoToGenesisBlock ::
  ( MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    (Address `A.Alters` AddressState) m,
    MonadIO m
  ) =>
  GenesisInfo ->
  String ->
  [AccountInfo] ->
  m ([(AccountInfo, CodeInfo)], Block)
genesisInfoToGenesisBlock gi gn as = do
  let codes = genesisInfoCodeInfo gi
  let accounts = genesisInfoAccountInfo gi
  initializeCodeDB "SolidVM" codes
  initializeStateDBAndAccountInfos accounts gn
  sr <- A.lookupWithDefault (Proxy @StateRoot) (Nothing :: Maybe Word256)
  let sourceInfo = zipSourceInfo (accounts ++ as) codes
      bData =
        BlockHeader
          { parentHash = genesisInfoParentHash gi,
            ommersHash = genesisInfoUnclesHash gi,
            beneficiary = genesisInfoCoinbase gi,
            stateRoot = sr,
            transactionsRoot = genesisInfoTransactionRoot gi,
            receiptsRoot = genesisInfoReceiptsRoot gi,
            logsBloom = genesisInfoLogBloom gi,
            difficulty = genesisInfoDifficulty gi,
            number = genesisInfoNumber gi,
            gasLimit = genesisInfoGasLimit gi,
            gasUsed = genesisInfoGasUsed gi,
            timestamp = genesisInfoTimestamp gi,
            extraData = i2bs_unsized $ genesisInfoExtraData gi,
            mixHash = genesisInfoMixHash gi,
            nonce = genesisInfoNonce gi
          }
  return
    ( sourceInfo,
      Block
        { blockBlockData = bData,
          blockReceiptTransactions = [],
          blockBlockUncles = []
        }
    )
