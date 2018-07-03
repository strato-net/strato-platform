
module Blockchain.Sequencer.DB.PrivateTxDB where

import           Blockchain.Data.Transaction
import           Blockchain.SHA
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M

import           Blockchain.Sequencer.DB.PrivateHashDB

getTxHashMap :: HasPrivateHashDB m => m (Map SHA Transaction)
getTxHashMap = txHashMap <$> getPrivateHashDB

putTxHashMap :: HasPrivateHashDB m => Map SHA Transaction -> m ()
putTxHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txHashMap = m }

lookupTransaction :: HasPrivateHashDB m => SHA -> m (Maybe Transaction)
lookupTransaction h = M.lookup h <$> getTxHashMap

insertTransaction :: HasPrivateHashDB m => Transaction -> m ()
insertTransaction tx = getTxHashMap >>= putTxHashMap . M.insert (txHash tx) tx
