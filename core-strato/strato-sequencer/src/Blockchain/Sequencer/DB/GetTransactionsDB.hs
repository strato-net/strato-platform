
module Blockchain.Sequencer.DB.GetTransactionsDB where

import           Blockchain.SHA

import qualified Data.Set                     as S

import           Blockchain.Sequencer.DB.PrivateHashDB

class MonadResource m => HasGetTransactionsDB m where
    getGetTransactionsDB :: m (S.Set SHA)
    putGetTransactionsDB :: (S.Set SHA) -> m ()

insertGetTransactionsDB :: SHA -> m ()
insertGetTransactionsDB tx = getMissingTxsDB >>= putMissingTxsDB . S.insert tx

clearGetTransactionsDB :: m ()
clearGetTransactionsDB = putMissingTxsDB S.empty
