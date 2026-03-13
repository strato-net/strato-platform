{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Data.GenesisBlock
  ( parseHex,
    initializeStateDB,
    genesisInfoToGenesisBlock,
    genesisInfoToBlock,
    populateMPTAndWriteGenesis,
    populateMPTFromGenesis
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
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Change.Alter (Alters)
import Control.Monad.Change.Modify
import Control.Monad.IO.Class
import Crypto.Util (i2bs_unsized)
import qualified Data.Aeson as JSON
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Numeric
import SolidVM.Model.Storable
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
  GenesisInfo ->
  m Block
genesisInfoToGenesisBlock gi = do
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
            currentValidators=GI.validators gi,
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

genesisInfoToBlock :: GenesisInfo -> Block
genesisInfoToBlock gi =
  Block
    { blockBlockData = BlockHeaderV2
        { parentHash = GI.parentHash gi
        , stateRoot = GI.stateRoot gi
        , transactionsRoot = GI.transactionsRoot gi
        , receiptsRoot = GI.receiptsRoot gi
        , logsBloom = GI.logBloom gi
        , number = GI.number gi
        , timestamp = GI.timestamp gi
        , extraData = i2bs_unsized $ GI.extraData gi
        , currentValidators = GI.validators gi
        , newValidators = []
        , removedValidators = []
        , proposalSignature = Nothing
        , signatures = []
        }
    , blockReceiptTransactions = []
    , blockBlockUncles = []
    }

-- | Populate the Merkle Patricia Trie and write genesis.json with computed stateRoot.
-- This is called by strato-setup (before docker containers are running).
-- Only requires LevelDB access, not Redis/Kafka/PostgreSQL.
populateMPTAndWriteGenesis ::
  ( HasCodeDB m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    MonadIO m,
    MonadLogger m,
    (Address `Alters` AddressState) m
  ) =>
  GenesisInfo ->
  m ()
populateMPTAndWriteGenesis genesisInfo = do
  $logInfoS "strato-setup" "Populating Merkle Patricia Trie from genesis allocations"
  genesisBlock <- genesisInfoToGenesisBlock genesisInfo
  let computedStateRoot = stateRoot $ blockBlockData genesisBlock
      updatedGenesisInfo = genesisInfo { GI.stateRoot = computedStateRoot }
  liftIO $ B.writeFile "genesis.json" . BL.toStrict $ JSON.encode updatedGenesisInfo
  $logInfoS "strato-setup" $ T.pack $ "Wrote genesis.json with stateRoot: " ++ format computedStateRoot
  $logInfoS "strato-setup" $ T.pack $ "  genesis hash: " ++ format (blockHash genesisBlock)

-- | Populate the MPT from a provided genesis.json (without modifying the file).
-- Used when strato-setup finds an existing genesis.json.
-- Assumes genesis.json was created with correct stateRoot (e.g., by genesis-builder).
populateMPTFromGenesis ::
  ( HasCodeDB m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    MonadLogger m,
    (Address `Alters` AddressState) m
  ) =>
  GenesisInfo ->
  m ()
populateMPTFromGenesis genesisInfo = do
  $logInfoS "strato-setup" "Populating Merkle Patricia Trie from provided genesis.json"
  genesisBlock <- genesisInfoToGenesisBlock genesisInfo
  let computedStateRoot = stateRoot $ blockBlockData genesisBlock
      expectedStateRoot = GI.stateRoot genesisInfo
  if computedStateRoot == expectedStateRoot
    then
      $logInfoS "strato-setup" $ T.pack $ "MPT populated, stateRoot verified: " ++ format computedStateRoot
    else
      $logErrorS "strato-setup" $ T.pack $
        "ERROR: Computed stateRoot " ++ format computedStateRoot ++
        " differs from genesis.json stateRoot " ++ format expectedStateRoot ++
        ". The genesis.json file may have been created incorrectly."
  $logInfoS "strato-setup" $ T.pack $ "Genesis hash: " ++ format (blockHash genesisBlock)

