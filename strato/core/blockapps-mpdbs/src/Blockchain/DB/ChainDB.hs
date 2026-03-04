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

import BlockApps.Logging
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToByteString)
import Control.DeepSeq
import Control.Monad (join)
import Control.Monad.Change.Alter hiding (lookup)
import Control.Monad.Change.Modify
import Data.Maybe (fromMaybe)
import qualified Data.NibbleString as N
import Data.Traversable (for)
import GHC.Generics
import Text.Format

{-
|-------------------------------------------------------------------------------|
|                          The Chain State Root DB                              |
|-------------------------------------------------------------------------------|
| When using Proof of Work as a consensus algorithm,                            |
| we must be able to run blocks from arbitrary state roots,                     |
| given that we have previously seen the state root.                            |
| State roots for the main chain are given in the block header,                 |
| but there is no such explication for private chains.                          |
| To mitigate this problem, we must be able to recall the state root            |
| for any chain id, for any block hash.                                         |
| To solve this, we'll use a hierarchical approach,                             |
| which leverages several MP tries to relate block hashes to state roots.       |
| First, each chain will have a state root, just like the main chain:           |
|                      state root                                               |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|                    account states                                             |
|                                                                               |
| Next, the chains' state roots will be stored in a trie, keyed by chain id:    |
|                      chain root                                               |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|                 (chain id, state root)                                        |
| Then, to keep track of chain roots across blocks, we'll store the chain roots |
| in a trie, keyed by block hash:                                               |
|                   block hash root                                             |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|         (block hash, (parent hash, chain root))                               |
| Finally, all known chains that haven't been transacted upon will be stored    |
| in a trie, keyed by chain id, with value being the chain's genesis state:     |
|                     genesis root                                              |
|                          /\                                                   |
|                         /  \                                                  |
|                        /\  /\                                                 |
|  (chain id, (creation block hash, genesis state root))                        |
| It's important to note that each block hash may have a unique chain root,     |
| but the genesis root only gets updated when the VM receives a new             |
| VmGenesis message.                                                            |
|                                                                               |
| When the VM receives a new block, it will insert it into the block hash       |
| trie, with the same chain root as its parent.                                 |
|                                                                               |
| When the VM runs private transactions in a block, it will load the            |
| chain's state root using the block's chain root. If the chain trie does       |
| not include the chain id, the chain's genesis state root will be loaded       |
| from the genesis trie, and be inserted into the chain trie. This will,        |
| in effect, change the the chain root, and the block hash root.                |
|-------------------------------------------------------------------------------|
-}

newtype BlockHashRoot = BlockHashRoot {unBlockHashRoot :: MP.StateRoot}
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

word256ToMPKey :: Maybe Word256 -> N.NibbleString
word256ToMPKey Nothing = N.EvenNibbleString ""
word256ToMPKey (Just cid) = N.EvenNibbleString $ word256ToBytes cid

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
bootstrapChainDB genesisHash startingStateRoot = do
  putChainRoot genesisHash MP.emptyTriePtr
  putChainStateRoot Nothing genesisHash startingStateRoot

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
  putChainRoot h =<< fromMaybe MP.emptyTriePtr <$> getChainRoot p

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
  mExistingChainRoot <- getChainRoot oldH
  case mExistingChainRoot of
    Nothing -> putBlockHeaderInChainDB oldBD >> migrateBlockHeader oldBD newH
    Just cr -> putChainRoot newH cr

getChainRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  m (Maybe MP.StateRoot)
getChainRoot h = do
  bhr <- unBlockHashRoot <$> get Proxy
  getkv bhr (N.EvenNibbleString $ keccak256ToByteString h)

putChainRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  MP.StateRoot ->
  m ()
putChainRoot h sr = do
  bhr <- unBlockHashRoot <$> get Proxy
  newBlockHashRoot <- putkv bhr (N.EvenNibbleString $ keccak256ToByteString h) sr
  put Proxy $ BlockHashRoot newBlockHashRoot

getChainStateRoot ::
  ( MonadLogger m,
    Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  m (Maybe MP.StateRoot)
getChainStateRoot chainId bh = do
    mChainRoot <- getChainRoot bh
    fmap join . for mChainRoot $ \chainRoot ->
      getkv chainRoot (word256ToMPKey chainId)

putChainStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  MP.StateRoot ->
  m ()
putChainStateRoot chainId bHash stateRoot = do
  mChainRoot <- getChainRoot bHash
  case mChainRoot of
    Nothing -> pure ()
    Just chainRoot -> do
      newChainRoot <- putkv chainRoot (word256ToMPKey chainId) stateRoot
      putChainRoot bHash newChainRoot

deleteChainStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  m ()
deleteChainStateRoot chainId bHash = do
  mChainRoot <- getChainRoot bHash
  case mChainRoot of
    Nothing -> pure ()
    Just chainRoot -> do
      newChainRoot <- MP.deleteKey chainRoot (word256ToMPKey chainId)
      putChainRoot bHash newChainRoot
