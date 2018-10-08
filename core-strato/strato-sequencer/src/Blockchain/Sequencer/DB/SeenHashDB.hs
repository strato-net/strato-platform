
module Blockchain.Sequencer.DB.SeenHashDB where

import           Blockchain.SHA

import           Control.Monad.IO.Class
import           Data.Bimap                   (Bimap)
import qualified Data.Bimap                   as B
import           Prometheus

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.DB.Metrics

getSeenHashDB :: HasPrivateHashDB m => m (Bimap SHA SHA)
getSeenHashDB = seenHashes <$> getPrivateHashDB

putSeenHashDB :: HasPrivateHashDB m => Bimap SHA SHA -> m ()
putSeenHashDB bm = getPrivateHashDB >>= \db -> putPrivateHashDB db{ seenHashes = bm }

lookupSeenTxHash :: HasPrivateHashDB m => SHA -> m (Maybe SHA)
lookupSeenTxHash th = do
  db <- getSeenHashDB
  if B.member th db
    then Just <$> B.lookup th db -- Data.Bimap calls `fail` if element is not in map
    else return Nothing

lookupSeenChainHash :: HasPrivateHashDB m => SHA -> m (Maybe SHA)
lookupSeenChainHash ch = do
  db <- getSeenHashDB
  if B.memberR ch db
    then Just <$> B.lookupR ch db -- Data.Bimap calls `fail` if element is not in map
    else return Nothing

insertSeenTxHash :: HasPrivateHashDB m => SHA -> SHA -> m ()
insertSeenTxHash th ch = do
  liftIO $ withLabel "seen_tx_hash" incCounter txMetrics
  getSeenHashDB >>= putSeenHashDB . B.insert th ch
