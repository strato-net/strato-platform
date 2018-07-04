
module Blockchain.Sequencer.DB.SeenHashDB where

import           Blockchain.SHA

import           Data.Bimap                   (Bimap)
import qualified Data.Bimap                   as B

import           Blockchain.Sequencer.DB.PrivateHashDB

getSeenHashDB :: HashPrivateHashDB m => m (Bimap SHA SHA)
getSeenHashDB = seenHashes <$> getPrivateHashDB

putSeenHashDB :: HashPrivateHashDB m => Bimap SHA SHA -> m ()
putSeenHashDB bm = getPrivateHashDB >>= \db -> putPrivateHashDB db{ seenHashes = bm }

lookupSeenTxHash :: HashPrivateHashDB m => SHA -> m (Maybe SHA)
lookupSeenTxHash th = do
  db <- getSeenHashDB
  if B.member th db
    then Just <$> B.lookup th db -- Data.Bimap calls `fail` if element is not in map
    else return Nothing

lookupSeenChainHash :: HashPrivateHashDB m => SHA -> m (Maybe SHA)
lookupSeenChainHash ch = do
  db <- getSeenHashDB
  if B.memberR ch db
    then Just <$> B.lookupR ch db -- Data.Bimap calls `fail` if element is not in map
    else return Nothing

insertSeenTxHash :: HashPrivateHashDB m => SHA -> SHA -> m ()
insertSeenTxHash th ch = getSeenHashDB >>= putSeenHashDB . B.insert th ch
