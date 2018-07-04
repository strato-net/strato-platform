
module Blockchain.Sequencer.DB.GetTransactionsDB where

import           Blockchain.SHA
import qualified Data.Set                     as S

class Monad m => HasGetTransactionsDB m where
    getGetTransactionsDB :: m (S.Set SHA)
    putGetTransactionsDB :: (S.Set SHA) -> m ()

insertGetTransactionsDB :: HasGetTransactionsDB m => SHA -> m ()
insertGetTransactionsDB tx = getGetTransactionsDB >>= putGetTransactionsDB . S.insert tx

clearGetTransactionsDB :: HasGetTransactionsDB m => m ()
clearGetTransactionsDB = putGetTransactionsDB S.empty
