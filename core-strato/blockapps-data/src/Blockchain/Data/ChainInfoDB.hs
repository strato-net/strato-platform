
module Blockchain.Data.ChainInfoDB where

import           Control.Arrow                      (&&&)
import qualified Database.Esqueleto                 as E
import           Database.Persist                   hiding (get)
import qualified Database.Persist.Postgresql        as SQL

import           Blockchain.Data.ChainInfo          (ChainInfo)

import           Blockchain.DB.SQLDB

import           Blockchain.Data.DataDefs
import           Control.Monad.Trans.Resource

getChainInfo :: (HasSQLDB m) => Word256 -> m (Maybe ChainInfo)
getChainInfo chainId = do
  db <- getSQLDB
  runResourceT . flip SQL.runSqlPool db $ do
    cInfo <- E.select . E.from $ \cRef -> do
      E.where_ (ciRef E.^. ChainInfoChainId E.==. E.val h)
    case entChainInfos of
      []  -> return Nothing
      (cInfo@(ChainInfoRef{..}):_) -> runResourceT . flip SQL.runSqlPool db $ do
          members <- E.select . E.from $ \mRef -> do
            E.where_ (mRef E.^. ChainMemberRefChainId E.==. cInfo E.^. ChainInfoRefId)
          accts <- E.select . E.from $ \abRef -> do
            E.where_ (abRef E.^. ChainAccountBalanceRefChainId E.==. cInfo E.^. ChainInfoRefId)
          -- aInfos <- E.select . E.from $ \aiRef -> do
          --   E.where_ (abRef E.^. AccountInfoRefChainId E.==. cInfo E.^. ChainInfoRefId)
          -- cInfos <- E.select . E.from $ \ciRef -> do
          --   E.where_ (abRef E.^. CodeInfoRefChainId E.==. cInfo E.^. ChainInfoRefId)
          return . Just $ ChainInfo chainLabel addRule removeRule (map name members) (map (address &&& balance) accts)
