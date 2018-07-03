
module Blockchain.Sequencer.DB.PrivateTxDB where

import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import           Blockchain.SHA
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M

import           Blockchain.Sequencer.DB.PrivateHashDB
import           Blockchain.Strato.Model.Class

getTxHashMap :: HasPrivateHashDB m => m (Map SHA Transaction)
getTxHashMap = txHashMap <$> getPrivateHashDB

putTxHashMap :: HasPrivateHashDB m => Map SHA Transaction -> m ()
putTxHashMap m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ txHashMap = m }

lookupTransaction :: HasPrivateHashDB m => SHA -> m (Maybe Transaction)
lookupTransaction h = M.lookup h <$> getTxHashMap

insertTransaction :: HasPrivateHashDB m => Transaction -> m ()
insertTransaction tx = getTxHashMap >>= putTxHashMap . M.insert (txHash tx) tx

insertPrivateHash :: HasPrivateHashDB m => Transaction -> m (SHA, SHA)
insertPrivateHash tx = case txChainId tx of
  Nothing -> error "insertPrivateHash: Trying to insert a public transaction"
  Just chainId -> do
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
