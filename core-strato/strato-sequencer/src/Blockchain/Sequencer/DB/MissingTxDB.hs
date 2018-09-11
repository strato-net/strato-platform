
module Blockchain.Sequencer.DB.MissingTxDB where

import           Blockchain.SHA

import qualified Data.Set                     as S

import           Blockchain.Sequencer.DB.PrivateHashDB

getMissingTxsDB :: HasPrivateHashDB m => m (S.Set SHA)
getMissingTxsDB = missingTxs <$> getPrivateHashDB

putMissingTxsDB :: HasPrivateHashDB m => S.Set SHA -> m ()
putMissingTxsDB txs = getPrivateHashDB >>= \db -> putPrivateHashDB db{ missingTxs = txs }

isMissingTX :: HasPrivateHashDB m => SHA -> m Bool
isMissingTX tx = S.member tx <$> getMissingTxsDB

insertMissingTx :: HasPrivateHashDB m => SHA -> m ()
insertMissingTx tx = getMissingTxsDB >>= putMissingTxsDB . S.insert tx

removeMissingTx :: HasPrivateHashDB m => SHA -> m ()
removeMissingTx tx = getMissingTxsDB >>= putMissingTxsDB . S.delete tx
