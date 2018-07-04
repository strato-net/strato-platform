
module Blockchain.Sequencer.DB.DependentTxDB where

import           Blockchain.SHA

import           Data.Maybe                   (fromMaybe)
import qualified Data.Set                     as S

import           Blockchain.Sequencer.DB.PrivateHashDB

getDependentTxDB :: HasPrivateHashDB m => m (Map SHA (S.Set SHA))
getDependentTxDB = dependentTxDB <$> getPrivateHashDB

putDependentTxDB :: HasPrivateHashDB m => Map SHA (S.Set SHA) -> m ()
putDependentTxDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ dependentTxDB = m }

lookupDependentTxs :: HasPrivateHashDB m => SHA -> m (S.Set SHA)
lookupDependentTxs bHash = fromMaybe S.empty . M.lookup bHash <$> getDependentTxDB

insertDependentTx :: HasPrivateHashDB m => SHA -> SHA -> m ()
insertDependentTx bHash tHash = do
  m <- getDependentTxDB
  case M.lookup bHash m of
    Nothing -> putDependentTxDB (M.insert bHash (S.singleton tHash) m)
    Just ths -> putDependentTxDB (M.insert bHash (S.insert tHash ths) m)

insertDependentTxs :: HasPrivateHashDB m => SHA -> S.Set SHA -> m ()
insertDependentTxs bHash ths = getDependentTxDB >>= putDependentTxDB . M.insert bHash ths

clearDependentTxs :: HasPrivateHashDB m => SHA -> m ()
clearDependentTxs bHash = getDependentTxDB >>= putDependentTxDB . M.delete bHash
