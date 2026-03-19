{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.ChainDB
  ( BlockHashRoot (..),
    bootstrapChainDB,
    putBlockHeaderInChainDB,
    migrateBlockHeader,
    getChainStateRoot,
    putChainStateRoot,
    deleteChainStateRoot,
  )
where

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToByteString)
import Control.DeepSeq
import Control.Monad.Change.Alter hiding (lookup)
import Control.Monad.Change.Modify
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import GHC.Generics
import Text.Format

-- | Maps block hashes to state roots.
-- This is a single-tier trie: blockHash -> stateRoot
newtype BlockHashRoot = BlockHashRoot {unBlockHashRoot :: MP.StateRoot}
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

getkv ::
  ( RLPSerializable a,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  MP.StateRoot ->
  N.NibbleString ->
  m (Maybe a)
getkv sr = fmap (fmap rlpDecode) . MP.getKeyVal sr

putkv ::
  ( RLPSerializable a,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  MP.StateRoot ->
  N.NibbleString ->
  a ->
  m MP.StateRoot
putkv sr k = MP.putKeyVal sr k . rlpEncode

bootstrapChainDB ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  MP.StateRoot ->
  m ()
bootstrapChainDB genesisHash startingStateRoot =
  putStateRoot genesisHash startingStateRoot

putBlockHeaderInChainDB ::
  ( BlockHeaderLike h,
    Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  h ->
  m ()
putBlockHeaderInChainDB b = do
  let p = blockHeaderParentHash b
      h = blockHeaderHash b
  putBlockHashInChainDB p h

putBlockHashInChainDB ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  Keccak256 ->
  m ()
putBlockHashInChainDB p h =
  putStateRoot h =<< fromMaybe MP.emptyTriePtr <$> getStateRoot p

migrateBlockHeader ::
  ( BlockHeaderLike h,
    Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  h ->
  Keccak256 ->
  m ()
migrateBlockHeader oldBD newH = do
  let oldH = blockHeaderHash oldBD
  mExistingStateRoot <- getStateRoot oldH
  case mExistingStateRoot of
    Nothing -> putBlockHeaderInChainDB oldBD >> migrateBlockHeader oldBD newH
    Just sr -> putStateRoot newH sr

getStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  m (Maybe MP.StateRoot)
getStateRoot h = do
  bhr <- unBlockHashRoot <$> get Proxy
  getkv bhr (N.EvenNibbleString $ keccak256ToByteString h)

putStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  MP.StateRoot ->
  m ()
putStateRoot h sr = do
  bhr <- unBlockHashRoot <$> get Proxy
  newBlockHashRoot <- putkv bhr (N.EvenNibbleString $ keccak256ToByteString h) sr
  put Proxy $ BlockHashRoot newBlockHashRoot

deleteStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  m ()
deleteStateRoot h = do
  bhr <- unBlockHashRoot <$> get Proxy
  newBlockHashRoot <- MP.deleteKey bhr (N.EvenNibbleString $ keccak256ToByteString h)
  put Proxy $ BlockHashRoot newBlockHashRoot

-- External API: chainId parameter is ignored (mainchain only)

getChainStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  m (Maybe MP.StateRoot)
getChainStateRoot _chainId bh = getStateRoot bh

putChainStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  MP.StateRoot ->
  m ()
putChainStateRoot _chainId bHash stateRoot = putStateRoot bHash stateRoot

deleteChainStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  m ()
deleteChainStateRoot _chainId bHash = deleteStateRoot bHash
