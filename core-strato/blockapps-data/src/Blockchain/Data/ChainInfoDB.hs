{-# LANGUAGE RecordWildCards #-}

module Blockchain.Data.ChainInfoDB where

import           Control.Arrow                      ((&&&))
import qualified Database.Esqueleto                 as E
import           Database.Persist                   hiding (get)
import qualified Database.Persist.Postgresql        as SQL

import qualified Blockchain.Data.ChainInfo          as C
import           Blockchain.ExtWord                 (Word256)

import           Blockchain.DB.SQLDB

import           Blockchain.Data.DataDefs
import           Control.Monad.Trans.Resource

getChainInfo :: (HasSQLDB m) => Word256 -> m (Maybe C.ChainInfo)
getChainInfo chainId = do
  db <- getSQLDB
  runResourceT . flip SQL.runSqlPool db $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      E.where_ (cRef E.^. ChainInfoRefChainId E.==. E.val chainId)
      return cRef
    case entChainInfos of
      []  -> return Nothing
      (cInfo:_) -> do
          let chainInfoRefId = entityKey cInfo
          let ChainInfoRef{..} = entityVal cInfo
          members <- E.select . E.from $ \mRef -> do
            E.where_ (mRef E.^. ChainMemberRefChainInfoId E.==. E.val chainInfoRefId)
            return mRef
          accts <- E.select . E.from $ \abRef -> do
            E.where_ (abRef E.^. ChainAccountBalanceRefChainInfoId E.==. E.val chainInfoRefId)
            return abRef
          -- aInfos <- E.select . E.from $ \aiRef -> do
          --   E.where_ (abRef E.^. AccountInfoRefChainId E.==. E.val chainInfoRefId)
          -- cInfos <- E.select . E.from $ \ciRef -> do
          --   E.where_ (abRef E.^. CodeInfoRefChainId E.==. E.val chainInfoRefId)
          return . Just $ C.ChainInfo
                            chainInfoRefChainLabel
                            chainInfoRefAddRule
                            chainInfoRefRemoveRule
                            (map name members)
                            (map anb accts)
          where name = chainMemberRefName . entityVal
                anb  = (address &&& balance) . entityVal
                address = chainAccountBalanceRefAddress
                balance = chainAccountBalanceRefBalance
