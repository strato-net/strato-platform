
module Blockchain.Sequencer.DB.PrivateHashDB where

import           Blockchain.ExtWord           (Word256)
import           Blockchain.Data.Transaction
import           Blockchain.SHA
import           Control.Monad.Catch
import           Control.Monad.Trans.Resource

import           Data.Bimap                   (Bimap)
import qualified Data.Bimap                   as B
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (fromMaybe)
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

import           Blockchain.Sequencer.DB.PrivateHashDB

getMissingChainsDB :: HasPrivateHashDB m => m (Map Word256 [SHA])
getMissingChainsDB = missingChainDB <$> getPrivateHashDB

putMissingChainsDB :: HasPrivateHashDB m => Map Word256 [SHA] -> m ()
putMissingChainsDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ missingChainDB = m }

lookupMissingChainTxs :: HasPrivateHashDB m => Word256 -> m [SHA]
lookupMissingChainTxs chainId = fromMaybe [] . M.lookup chainId <$> getMissingChainsDB

insertMissingChainTx :: HasPrivateHashDB m => Word256 -> SHA -> m ()
insertMissingChainTx chainId th = do
  m <- getMissingChainsDB
  case M.lookup chainId m of
    Nothing -> putMissingChainsDB (M.insert chainId [th] m)
    Just ths -> putMissingChainsDB (M.insert chainId (th:ths) m)

insertMissingChainTxs :: HasPrivateHashDB m => Word256 -> [SHA] -> m ()
insertMissingChainTxs chainId ths = getMissingChainsDB >>= putMissingChainsDB . M.insert chainId ths

clearMissingChainTxs :: HasPrivateHashDB m => Word256 -> m ()
clearMissingChainTxs chainId = getMissingChainsDB >>= putMissingChainsDB . M.delete chainId
