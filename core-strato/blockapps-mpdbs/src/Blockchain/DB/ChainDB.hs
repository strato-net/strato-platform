{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TypeApplications           #-}
{-# LANGUAGE TypeOperators              #-}

module Blockchain.DB.ChainDB
  ( BlockHashRoot(..)
  , GenesisRoot(..)
  , BestBlockRoot(..)
  , bootstrapChainDB
  , putBlockHeaderInChainDB
  , getChainRoot
  , getChainStateRoot
  , getGenesisStateRoot
  , putChainGenesisInfo
  , getChainBestBlock
  , putChainBestBlock
  , withBlockchain
  ) where

import           Control.DeepSeq
import           Control.Monad                        (join, when)
import           Control.Monad.Change.Alter           hiding (lookup)
import           Control.Monad.Change.Modify

import           Data.Maybe                           (isNothing)
import qualified Data.NibbleString                    as N
import           Data.Traversable                     (for)

import qualified Blockchain.Database.MerklePatricia   as MP
import           Blockchain.Data.RLP

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import           Blockchain.Strato.Model.SHA          (SHA(..))

import           GHC.Generics
import           Text.Format



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

newtype BlockHashRoot = BlockHashRoot { unBlockHashRoot :: MP.StateRoot }
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

newtype GenesisRoot = GenesisRoot { unGenesisRoot :: MP.StateRoot }
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

newtype BestBlockRoot = BestBlockRoot { unBestBlockRoot :: MP.StateRoot }
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

word256ToMPKey :: Word256 -> N.NibbleString
word256ToMPKey = N.EvenNibbleString . word256ToBytes

getkv :: ( RLPSerializable a
         , (MP.StateRoot `Alters` MP.NodeData) m
         )
      => MP.StateRoot -> N.NibbleString -> m (Maybe a)
getkv sr = fmap (fmap rlpDecode) . MP.getKeyVal sr

putkv :: ( RLPSerializable a
         , (MP.StateRoot `Alters` MP.NodeData) m
         )
      => MP.StateRoot -> N.NibbleString -> a -> m MP.StateRoot
putkv sr k = MP.putKeyVal sr k . rlpEncode

bootstrapChainDB :: ( Modifiable BlockHashRoot m
                    , (MP.StateRoot `Alters` MP.NodeData) m
                    )
                 => SHA -> m ()
bootstrapChainDB genesisHash = putChainBlockHashInfo genesisHash (SHA 0) MP.emptyTriePtr

putBlockHeaderInChainDB :: ( BlockHeaderLike h
                           , Modifiable BlockHashRoot m
                           , (MP.StateRoot `Alters` MP.NodeData) m
                           )
                        => h -> m ()
putBlockHeaderInChainDB b = do
  let p = blockHeaderParentHash b
      h = blockHeaderHash b
  mExistingChainRoot <- getChainRoot h     -- if we've seen this block before,
  when (isNothing mExistingChainRoot) $ do -- its chain root will already exist
    putChainBlockHashInfo h p MP.emptyTriePtr

getChainRoot :: ( Modifiable BlockHashRoot m
                , (MP.StateRoot `Alters` MP.NodeData) m
                )
             => SHA -> m (Maybe MP.StateRoot)
getChainRoot = fmap (fmap snd) . getChainBlockHashInfo

getChainBlockHashInfo :: ( Modifiable BlockHashRoot m
                         , (MP.StateRoot `Alters` MP.NodeData) m
                         )
                      => SHA -> m (Maybe (SHA, MP.StateRoot))
getChainBlockHashInfo (SHA h) = do
  bhr <- unBlockHashRoot <$> get Proxy
  getkv bhr (word256ToMPKey h)

putChainBlockHashInfo :: ( Modifiable BlockHashRoot m
                         , (MP.StateRoot `Alters` MP.NodeData) m
                         )
                      => SHA -> SHA -> MP.StateRoot -> m ()
putChainBlockHashInfo (SHA h) parentHash sr = do
  bhr <- unBlockHashRoot <$> get Proxy
  newBlockHashRoot <- putkv bhr (word256ToMPKey h) (parentHash, sr)
  put Proxy $ BlockHashRoot newBlockHashRoot

getGenesisStateRoot :: ( Modifiable GenesisRoot m
                       , (MP.StateRoot `Alters` MP.NodeData) m
                       )
                    => Word256 -> m (Maybe MP.StateRoot)
getGenesisStateRoot = fmap (fmap snd) . getChainGenesisInfo

getChainGenesisInfo :: ( Modifiable GenesisRoot m
                       , (MP.StateRoot `Alters` MP.NodeData) m
                       )
                    => Word256 -> m (Maybe (SHA, MP.StateRoot))
getChainGenesisInfo cid = do
  gr <- unGenesisRoot <$> get Proxy
  getkv gr (word256ToMPKey cid)

putChainGenesisInfo :: ( Modifiable GenesisRoot m
                       , (MP.StateRoot `Alters` MP.NodeData) m
                       )
                    => Word256 -> SHA -> MP.StateRoot -> m ()
putChainGenesisInfo chainId creationBlock stateRoot = do
  gr <- unGenesisRoot <$> get Proxy
  newGenesisRoot <- putkv gr (word256ToMPKey chainId) (creationBlock, stateRoot)
  put Proxy $ GenesisRoot newGenesisRoot

getChainStateRoot :: ( Modifiable BlockHashRoot m
                     , Modifiable GenesisRoot m
                     , (MP.StateRoot `Alters` MP.NodeData) m
                     )
                  => Word256 -> SHA -> m (Maybe MP.StateRoot)
getChainStateRoot chainId bh = do
  mGenStateRoot <- getChainGenesisInfo chainId
  fmap join . for mGenStateRoot $ uncurry $ go bh
  where go bHash creationBlock genStateRoot = do
          mChainRoot <- getChainBlockHashInfo bHash
          fmap join . for mChainRoot $ \(parentHash, chainRoot) -> do
            mStateRoot <- getkv chainRoot (word256ToMPKey chainId)
            case mStateRoot of
              Just (_ :: Word256, stateRoot) -> return $ Just stateRoot
              Nothing -> do
                mStateRoot' <- if parentHash == creationBlock
                  then return $ Just genStateRoot
                  else go parentHash creationBlock genStateRoot
                for mStateRoot' $ \stateRoot -> do
                  putChainStateRoot chainId bHash stateRoot
                  return stateRoot

putChainStateRoot :: ( Modifiable BlockHashRoot m
                     , (MP.StateRoot `Alters` MP.NodeData) m
                     )
                  => Word256 -> SHA -> MP.StateRoot -> m ()
putChainStateRoot chainId bHash stateRoot = do
  mChainRoot <- getChainBlockHashInfo bHash
  case mChainRoot of
    Nothing -> error $ "putChainStateRoot: Attempting to set chain root for block hash " ++ format bHash ++ ", but it doesn't exist"
    Just (parentHash, chainRoot) -> do
      newChainRoot <- putkv chainRoot (word256ToMPKey chainId) (chainId, stateRoot)
      putChainBlockHashInfo bHash parentHash newChainRoot

getChainBestBlock :: ( Modifiable BestBlockRoot m
                     , (MP.StateRoot `Alters` MP.NodeData) m
                     )
                  => Word256 -> m (Maybe (SHA, Integer))
getChainBestBlock chainId = do
  bbr <- unBestBlockRoot <$> get Proxy
  getkv bbr (word256ToMPKey chainId)

putChainBestBlock :: ( Modifiable BestBlockRoot m
                     , (MP.StateRoot `Alters` MP.NodeData) m
                     )
                  => Word256 -> SHA -> Integer -> m ()
putChainBestBlock chainId bHash ordering = do
  bbr <- unBestBlockRoot <$> get Proxy
  newBestBlockRoot <- putkv bbr (word256ToMPKey chainId) (bHash, ordering)
  put Proxy $ BestBlockRoot newBestBlockRoot

withBlockchain :: ( Modifiable BlockHashRoot m
                  , Modifiable GenesisRoot m
                  , Modifiable MP.StateRoot m
                  , (MP.StateRoot `Alters` MP.NodeData) m
                  )
               => SHA -> Maybe Word256 -> m a -> m a
withBlockchain bh cid f = do
  case cid of
    Nothing -> f
    Just chainId -> do
      mStateRoot <- getChainStateRoot chainId bh
      case mStateRoot of
        Nothing -> error $ "withBlockchain: Couldn't find state root for chain " ++ format chainId
        Just stateRoot -> do
          existingStateRoot <- get (Proxy @MP.StateRoot)
          put (Proxy @MP.StateRoot) stateRoot
          a <- f
          newStateRoot <- get (Proxy @MP.StateRoot)
          putChainStateRoot chainId bh newStateRoot
          put (Proxy @MP.StateRoot) existingStateRoot
          return a
