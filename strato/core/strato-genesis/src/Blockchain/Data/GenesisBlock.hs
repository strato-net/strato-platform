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
import Blockchain.DB.SolidStorageDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.GenesisInfo (GenesisInfo)
import qualified Blockchain.Data.GenesisInfo as GI
import Blockchain.Database.MerklePatricia
import Blockchain.Strato.Model.Address hiding (parseHex)
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Validator
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Change.Modify
import Crypto.Util (i2bs_unsized)
import qualified Data.Text.Encoding as T
import Numeric
import SolidVM.Model.Storable

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
  [(StoragePath, BasicValue)] ->
  m ()
putStorageTrie account slots = do
  mapM_ (\(theKey, theValue) -> putSolidStorageKeyVal' account theKey theValue) slots
  flushMemStorageTxDBToBlockDB
  flushMemStorageDB
  Mem.flushMemAddressStateTxToBlockDB
  Mem.flushMemAddressStateDB

putAccount ::
  ( MonadLogger m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemRawStorageDB m,
    (Address `A.Alters` AddressState) m
  ) =>
  GI.AddressInfo ->
  m ()
putAccount acc = case acc of
  GI.NonContract address balance' ->
    A.insert A.Proxy address blankAddressState {addressStateBalance = balance'}
  GI.ContractNoStorage address balance' codeHash' -> do
    A.insert
      A.Proxy
      address
      blankAddressState
        { addressStateBalance = balance',
          addressStateCodeHash = codeHash'
        }
  GI.SolidVMContractWithStorage address balance' codeHash' slots -> do
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
  [GI.AddressInfo] ->
  m ()
initializeStateDB addressInfo = do
  initializeBlankStateDB
  mapM_ putAccount addressInfo
  Mem.flushMemAddressStateTxToBlockDB
  Mem.flushMemAddressStateDB

parseHex :: (Num a, Eq a) => String -> a
parseHex theString =
  case readHex theString of
    [(value, "")] -> value
    _ -> error $ "parseHex: error parsing string: " ++ theString

initializeCodeDB :: HasCodeDB m => String -> [GI.CodeInfo] -> m ()
--initializeCodeDB "EVM" x = do
--  mapM_ (addCode . (\(CodeInfo bin _ _) -> bin)) x
initializeCodeDB "SolidVM" x = do
  mapM_ (addCode . (\(GI.CodeInfo src _) -> T.encodeUtf8 src)) x
initializeCodeDB invalidType _ = error $ "error, bad VM type: " ++ invalidType

genesisInfoToGenesisBlock ::
  ( MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    (Address `A.Alters` AddressState) m
  ) =>
  [Validator] ->
  GenesisInfo ->
  m Block
genesisInfoToGenesisBlock validators gi = do
  let codes = GI.codeInfo gi
  let accounts = GI.addressInfo gi
  initializeCodeDB "SolidVM" codes
  initializeStateDB accounts
  sr <- A.lookupWithDefault (Proxy @StateRoot) (Nothing :: Maybe Word256)
  let bData =
        BlockHeaderV2
          { parentHash = GI.parentHash gi,
            stateRoot = sr,
            transactionsRoot = GI.transactionsRoot gi,
            receiptsRoot = GI.receiptsRoot gi,
            logsBloom = GI.logBloom gi,
            number = GI.number gi,
            timestamp = GI.timestamp gi,
            extraData = i2bs_unsized $ GI.extraData gi,
            currentValidators=validators,
            newValidators=[],
            removedValidators=[],
            proposalSignature=Nothing,
            signatures=[]
          }
  return
      Block
        { blockBlockData = bData,
          blockReceiptTransactions = [],
          blockBlockUncles = []
        }
