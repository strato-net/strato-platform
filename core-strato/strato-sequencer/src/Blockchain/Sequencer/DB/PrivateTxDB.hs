
module Blockchain.Sequencer.DB.PrivateTxDB where

import           Blockchain.Data.RLP
import           Blockchain.SHA
import           Control.Monad.IO.Class
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Prometheus

import           Blockchain.Sequencer.DB.ChainHashDB
import           Blockchain.Sequencer.DB.Metrics
import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Class

getTxHashMap :: HasPrivateHashDB m => m (Map SHA OutputTx)
getTxHashMap = txHashMap <$> getPrivateHashDB

putTxHashMap :: HasPrivateHashDB m => Map SHA OutputTx -> m ()
putTxHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txHashMap = m }

lookupTransaction :: HasPrivateHashDB m => SHA -> m (Maybe OutputTx)
lookupTransaction h = M.lookup h <$> getTxHashMap

insertTransaction :: HasPrivateHashDB m => OutputTx -> m ()
insertTransaction tx = getTxHashMap >>= putTxHashMap . M.insert (txHash tx) tx

insertPrivateHash :: HasPrivateHashDB m => OutputTx -> m (SHA, SHA)
insertPrivateHash tx = case txChainId tx of
  Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
  Just chainId -> do
    liftIO $ withLabel "insert_privatetx_hash" incCounter txMetrics
    let r = txSigR tx
        s = txSigS tx
        h = txHash tx
        rs = hash . rlpSerialize $ RLPArray [rlpEncode r, rlpEncode s]
        sr = hash . rlpSerialize $ RLPArray [rlpEncode s, rlpEncode r]
    insertTransaction tx
    insertChainHash rs chainId
    insertChainHash sr chainId
    chainHash <- getChainHash chainId
    insertChainBufferEntry chainId rs
    insertChainBufferEntry chainId sr
    return (h, chainHash)
