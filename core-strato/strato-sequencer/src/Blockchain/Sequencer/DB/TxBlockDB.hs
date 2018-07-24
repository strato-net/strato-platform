
module Blockchain.Sequencer.DB.TxBlockDB where

import           Blockchain.SHA

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M

import           Blockchain.Sequencer.DB.PrivateHashDB

getTxBlockDB :: HasPrivateHashDB m => m (Map SHA SHA)
getTxBlockDB = txBlockDB <$> getPrivateHashDB

putTxBlockDB :: HasPrivateHashDB m => Map SHA SHA -> m ()
putTxBlockDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txBlockDB = m }

lookupTxBlocks :: HasPrivateHashDB m => SHA -> m (Maybe SHA)
lookupTxBlocks tHash = M.lookup tHash <$> getTxBlockDB

insertTxBlock :: HasPrivateHashDB m => SHA -> SHA -> m ()
insertTxBlock tHash bHash = getTxBlockDB >>= putTxBlockDB . M.insert tHash bHash

removeTxBlock :: HasPrivateHashDB m => SHA -> m ()
removeTxBlock tHash = getTxBlockDB >>= putTxBlockDB . M.delete tHash
