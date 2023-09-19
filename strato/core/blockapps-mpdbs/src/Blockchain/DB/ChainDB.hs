{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.DB.ChainDB
  ( BlockHashRoot (..),
    GenesisRoot (..),
    BestBlockRoot (..),
    bootstrapChainDB,
    putBlockHeaderInChainDB,
    putBlockHashInChainDB,
    migrateBlockHeader,
    getChainRoot,
    getChainStateRoot,
    putChainStateRoot,
    deleteChainStateRoot,
    getGenesisStateRoot,
    getChainGenesisInfo,
    putChainGenesisInfo,
    deleteChainGenesisInfo,
    getChainBestBlock,
    putChainBestBlock,
    deleteChainBestBlock,
  )
where

import BlockApps.Logging
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToByteString, zeroHash)
import Control.DeepSeq
import Control.Monad (join)
import Control.Monad.Change.Alter hiding (lookup)
import Control.Monad.Change.Modify
import Data.Foldable (for_)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe, isNothing)
import qualified Data.NibbleString as N
import Data.Text (Text)
import qualified Data.Text as T
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

newtype GenesisRoot = GenesisRoot {unGenesisRoot :: MP.StateRoot}
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

newtype BestBlockRoot = BestBlockRoot {unBestBlockRoot :: MP.StateRoot}
  deriving (Eq, Ord, Show, Generic)
  deriving newtype (Format, NFData)

newtype GenesisData = GenesisData {unGenesisData :: (Keccak256, MP.StateRoot, Map Text Word256)}

instance RLPSerializable GenesisData where
  rlpEncode (GenesisData (cBlock, genSR, pChain)) = RLPArray [rlpEncode cBlock, rlpEncode genSR, rlpEncode pChain]
  rlpDecode (RLPArray [cBlock, genSR, pChain]) = GenesisData (rlpDecode cBlock, rlpDecode genSR, rlpDecode pChain)
  rlpDecode o = error ("Error in rlpDecode for GenesisData: bad RLPObject: " ++ show o)

newtype ChainStateInfo = ChainStateInfo (Maybe Word256, Maybe Keccak256, MP.StateRoot)

instance Format ChainStateInfo where
  format (ChainStateInfo x) = format x

instance RLPSerializable ChainStateInfo where
  rlpEncode (ChainStateInfo (cId, Just bHash, sRoot)) = RLPArray [rlpEncode cId, rlpEncode bHash, rlpEncode sRoot]
  rlpEncode (ChainStateInfo (cId, Nothing, sRoot)) = RLPArray [rlpEncode cId, rlpEncode sRoot]
  rlpDecode (RLPArray [cId, bHash, sRoot]) = ChainStateInfo (rlpDecode cId, Just (rlpDecode bHash), rlpDecode sRoot)
  rlpDecode (RLPArray [cId, sRoot]) = ChainStateInfo (rlpDecode cId, Nothing, rlpDecode sRoot)
  rlpDecode o = error ("Error in rlpDecode for ChainStateInfo: bad RLPObject: " ++ show o)

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
    Modifiable GenesisRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  [(Maybe Word256, MP.StateRoot)] ->
  m BlockHashRoot
bootstrapChainDB genesisHash startingStateRoots = do
  putChainBlockHashInfo genesisHash zeroHash MP.emptyTriePtr
  for_ startingStateRoots $ \(cId, sr) -> putChainGenesisInfo cId genesisHash sr M.empty
  for_ startingStateRoots $ \(cId, sr) -> putChainStateRoot cId genesisHash sr
  get (Proxy @BlockHashRoot)

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
  putChainBlockHashInfo h p =<< fromMaybe MP.emptyTriePtr <$> getChainRoot p

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
      oldP = blockHeaderParentHash oldBD
  mExistingChainRoot <- getChainRoot oldH
  case mExistingChainRoot of
    Nothing -> putBlockHeaderInChainDB oldBD >> migrateBlockHeader oldBD newH
    Just cr -> putChainBlockHashInfo newH oldP cr

getChainRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  m (Maybe MP.StateRoot)
getChainRoot = fmap (fmap snd) . getChainBlockHashInfo

getChainBlockHashInfo ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  m (Maybe (Keccak256, MP.StateRoot))
getChainBlockHashInfo h = do
  bhr <- unBlockHashRoot <$> get Proxy
  getkv bhr (N.EvenNibbleString $ keccak256ToByteString h)

putChainBlockHashInfo ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Keccak256 ->
  Keccak256 ->
  MP.StateRoot ->
  m ()
putChainBlockHashInfo h parentHash sr = do
  bhr <- unBlockHashRoot <$> get Proxy
  newBlockHashRoot <- putkv bhr (N.EvenNibbleString $ keccak256ToByteString h) (parentHash, sr)
  put Proxy $ BlockHashRoot newBlockHashRoot

getGenesisStateRoot ::
  ( Modifiable GenesisRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  m (Maybe MP.StateRoot)
getGenesisStateRoot = fmap (fmap (\(_, sr, _) -> sr)) . getChainGenesisInfo

getChainGenesisInfo ::
  ( Modifiable GenesisRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  m (Maybe (Keccak256, MP.StateRoot, Map Text Word256))
getChainGenesisInfo cid = do
  gr <- unGenesisRoot <$> get Proxy
  fmap unGenesisData <$> getkv gr (word256ToMPKey cid)

putChainGenesisInfo ::
  ( Modifiable GenesisRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  MP.StateRoot ->
  Map Text Word256 ->
  m ()
putChainGenesisInfo chainId creationBlock stateRoot parent = do
  gr <- unGenesisRoot <$> get Proxy
  newGenesisRoot <- putkv gr (word256ToMPKey chainId) $ GenesisData (creationBlock, stateRoot, parent)
  put Proxy $ GenesisRoot newGenesisRoot

deleteChainGenesisInfo ::
  ( Modifiable GenesisRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  m ()
deleteChainGenesisInfo chainId = do
  gr <- unGenesisRoot <$> get Proxy
  newGenesisRoot <- MP.deleteKey gr (word256ToMPKey chainId)
  put Proxy $ GenesisRoot newGenesisRoot

getChainStateRoot ::
  ( MonadLogger m,
    Modifiable BlockHashRoot m,
    Modifiable GenesisRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  m (Maybe MP.StateRoot)
getChainStateRoot chainId bh = do
  mGenStateRoot <- getChainGenesisInfo chainId
  $logDebugS "getChainStateRoot" . T.pack $ "Genesis state root for chain " ++ format chainId ++ ": " ++ format ((\(a, b, _) -> (a, b)) <$> mGenStateRoot)
  fmap join . for mGenStateRoot $ \(cb, gsr, _) -> go bh cb gsr
  where
    go bHash creationBlock genStateRoot = do
      mChainRoot <- getChainBlockHashInfo bHash
      $logDebugS "getChainStateRoot" . T.pack $ "Chain root for block " ++ format bHash ++ ": " ++ format mChainRoot
      fmap join . for mChainRoot $ \(parentHash, chainRoot) -> do
        mStateRoot <- getkv chainRoot (word256ToMPKey chainId)
        $logDebugS "getChainStateRoot" . T.pack $ "State root for chain " ++ format chainId ++ ": " ++ format mStateRoot
        case mStateRoot of
          Just (ChainStateInfo (_, Just bHash', stateRoot)) | isNothing chainId || bHash == bHash' -> return $ Just stateRoot
          Just (ChainStateInfo (_, Nothing, stateRoot)) -> return $ Just stateRoot
          _ -> do
            mStateRoot' <-
              if parentHash == creationBlock
                then return $ Just genStateRoot
                else go parentHash creationBlock genStateRoot
            for mStateRoot' $ \stateRoot -> do
              putChainStateRoot chainId bHash stateRoot
              return stateRoot

putChainStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  MP.StateRoot ->
  m ()
putChainStateRoot chainId bHash stateRoot = do
  mChainRoot <- getChainBlockHashInfo bHash
  case mChainRoot of
    Nothing -> pure ()
    Just (parentHash, chainRoot) -> do
      newChainRoot <- putkv chainRoot (word256ToMPKey chainId) $ ChainStateInfo (chainId, Just bHash, stateRoot)
      putChainBlockHashInfo bHash parentHash newChainRoot

deleteChainStateRoot ::
  ( Modifiable BlockHashRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  m ()
deleteChainStateRoot chainId bHash = do
  mChainRoot <- getChainBlockHashInfo bHash
  case mChainRoot of
    Nothing -> pure ()
    Just (parentHash, chainRoot) -> do
      newChainRoot <- MP.deleteKey chainRoot (word256ToMPKey chainId)
      putChainBlockHashInfo bHash parentHash newChainRoot

getChainBestBlock ::
  ( Modifiable BestBlockRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  m (Maybe (Keccak256, Integer))
getChainBestBlock chainId = do
  bbr <- unBestBlockRoot <$> get Proxy
  getkv bbr (word256ToMPKey chainId)

putChainBestBlock ::
  ( Modifiable BestBlockRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  Keccak256 ->
  Integer ->
  m ()
putChainBestBlock chainId bHash ordering = do
  bbr <- unBestBlockRoot <$> get Proxy
  newBestBlockRoot <- putkv bbr (word256ToMPKey chainId) (bHash, ordering)
  put Proxy $ BestBlockRoot newBestBlockRoot

deleteChainBestBlock ::
  ( Modifiable BestBlockRoot m,
    (MP.StateRoot `Alters` MP.NodeData) m
  ) =>
  Maybe Word256 ->
  m ()
deleteChainBestBlock chainId = do
  bbr <- unBestBlockRoot <$> get Proxy
  newBestBlockRoot <- MP.deleteKey bbr (word256ToMPKey chainId)
  put Proxy $ BestBlockRoot newBestBlockRoot
