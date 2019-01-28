{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.DB.ChainDB (
    HasChainDB(..)
  , bootstrapChainDB
  , putBlockHeaderInChainDB
  , getChainRoot
  , getGenesisStateRoot
  , putChainGenesisInfo
  , withBlockchain
  ) where

import           Control.Monad                        (join, when)
import           Control.Monad.Trans.Resource

import           Data.Maybe                           (isNothing)
import qualified Data.NibbleString                    as N
import           Data.Traversable                     (for)

import qualified Blockchain.Database.MerklePatricia   as MP
import           Blockchain.Data.RLP
import           Blockchain.Format

import           Blockchain.DB.StateDB
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import           Blockchain.Strato.Model.SHA          (SHA(..))

import qualified Database.LevelDB                     as DB

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
| OEGenesis message.                                                            |
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

class Monad m => HasChainDB m where
  getBlockHashRoot    :: m MP.StateRoot
  putBlockHashRoot    :: MP.StateRoot -> m ()
  getGenesisRoot      :: m MP.StateRoot
  putGenesisRoot      :: MP.StateRoot -> m ()

getLDB :: HasStateDB m => m DB.DB
getLDB = MP.ldb <$> getStateDB

word256ToMPKey :: Word256 -> N.NibbleString
word256ToMPKey = N.EvenNibbleString . word256ToBytes

getkv :: (RLPSerializable a, MonadResource m) => MP.MPDB -> N.NibbleString -> m (Maybe a)
getkv db = fmap (fmap rlpDecode) . MP.getKeyVal db

putkv :: (RLPSerializable a, MonadResource m) => MP.MPDB -> N.NibbleString -> a -> m MP.StateRoot
putkv db k = (fmap MP.stateRoot) . MP.putKeyVal db k . rlpEncode

bootstrapChainDB :: (HasStateDB m, HasChainDB m) => SHA -> m ()
bootstrapChainDB genesisHash = putChainBlockHashInfo genesisHash (SHA 0) MP.emptyTriePtr

putBlockHeaderInChainDB :: (BlockHeaderLike h, HasStateDB m, HasChainDB m) => h -> m ()
putBlockHeaderInChainDB b = do
  let p = blockHeaderParentHash b
      h = blockHeaderHash b
  mExistingChainRoot <- getChainRoot h     -- if we've seen this block before,
  when (isNothing mExistingChainRoot) $ do -- its chain root will already exist
    mChainRoot <- getChainRoot p
    case mChainRoot of
      Nothing -> error $ "putBlockHeaderInChainDB: No parent block with hash " ++ format p ++ " found"
      Just chainRoot -> putChainBlockHashInfo h p chainRoot

getChainRoot :: (HasStateDB m, HasChainDB m) => SHA -> m (Maybe MP.StateRoot)
getChainRoot = fmap (fmap snd) . getChainBlockHashInfo

getChainBlockHashInfo :: (HasStateDB m, HasChainDB m) => SHA -> m (Maybe (SHA, MP.StateRoot))
getChainBlockHashInfo (SHA h) = do
  bhdb <- MP.MPDB <$> getLDB <*> getBlockHashRoot
  getkv bhdb (word256ToMPKey h)

putChainBlockHashInfo :: (HasStateDB m, HasChainDB m) => SHA -> SHA -> MP.StateRoot -> m ()
putChainBlockHashInfo (SHA h) parentHash sr = do
  bhdb <- MP.MPDB <$> getLDB <*> getBlockHashRoot
  newBlockHashRoot <- putkv bhdb (word256ToMPKey h) (parentHash, sr)
  putBlockHashRoot newBlockHashRoot

getGenesisStateRoot :: (HasStateDB m, HasChainDB m) => Word256 -> m (Maybe MP.StateRoot)
getGenesisStateRoot = fmap (fmap snd) . getChainGenesisInfo

getChainGenesisInfo :: (HasStateDB m, HasChainDB m) => Word256 -> m (Maybe (SHA, MP.StateRoot))
getChainGenesisInfo cid = do
  gdb <- MP.MPDB <$> getLDB <*> getGenesisRoot
  getkv gdb (word256ToMPKey cid)

putChainGenesisInfo :: (HasStateDB m, HasChainDB m) => Word256 -> SHA -> MP.StateRoot -> m ()
putChainGenesisInfo chainId creationBlock stateRoot = do
  gdb <- MP.MPDB <$> getLDB <*> getGenesisRoot
  newGenesisRoot <- putkv gdb (word256ToMPKey chainId) (creationBlock, stateRoot)
  putGenesisRoot newGenesisRoot

getChainStateRoot :: (HasStateDB m, HasChainDB m) => Word256 -> SHA -> m (Maybe MP.StateRoot)
getChainStateRoot chainId bHash = do
  mChainRoot <- getChainBlockHashInfo bHash
  fmap join . for mChainRoot $ \(parentHash, chainRoot) -> do
    cdb <- flip MP.MPDB chainRoot <$> getLDB
    mStateRoot <- getkv cdb (word256ToMPKey chainId)
    case mStateRoot of
      Just (_ :: Word256, stateRoot) -> return $ Just stateRoot
      Nothing -> do
        mGenStateRoot <- getChainGenesisInfo chainId
        fmap join . for mGenStateRoot $ \(creationBlock, genStateRoot) -> do
          mStateRoot' <- if parentHash == creationBlock
            then return $ Just genStateRoot
            else getChainStateRoot chainId parentHash
          for mStateRoot' $ \stateRoot -> do
            putChainStateRoot chainId bHash stateRoot
            return stateRoot

putChainStateRoot :: (HasStateDB m, HasChainDB m) => Word256 -> SHA -> MP.StateRoot -> m ()
putChainStateRoot chainId bHash stateRoot = do
  mChainRoot <- getChainBlockHashInfo bHash
  case mChainRoot of
    Nothing -> error $ "putChainStateRoot: Attempting to set chain root for block hash " ++ format bHash ++ ", but it doesn't exist"
    Just (parentHash, chainRoot) -> do
      cdb <- flip MP.MPDB chainRoot <$> getLDB
      newChainRoot <- putkv cdb (word256ToMPKey chainId) (chainId, stateRoot)
      putChainBlockHashInfo bHash parentHash newChainRoot

withBlockchain :: (HasStateDB m, HasChainDB m) => SHA -> Maybe Word256 -> m a -> m a
withBlockchain bh cid f = do
  case cid of
    Nothing -> f
    Just chainId -> do
      mStateRoot <- getChainStateRoot chainId bh
      case mStateRoot of
        Nothing -> error $ "withBlockchain: Couldn't find state root for chain " ++ format chainId
        Just stateRoot -> do
          existingStateRoot <- getStateRoot
          setStateDBStateRoot stateRoot
          a <- f
          newStateRoot <- getStateRoot
          putChainStateRoot chainId bh newStateRoot
          setStateDBStateRoot existingStateRoot
          return a
