{-# OPTIONS -fno-warn-missing-methods #-}
{-# OPTIONS -fno-warn-orphans         #-}
{-# LANGUAGE DataKinds                #-}
{-# LANGUAGE FlexibleInstances        #-}
{-# LANGUAGE RecordWildCards          #-}
{-# LANGUAGE ScopedTypeVariables      #-}

module Blockchain.Data.ChainInfoDB where

import           Control.Arrow                      ((&&&))
import           Control.Monad.Trans.Resource
import           Data.Map                           as M
import           Data.Maybe

import qualified Database.Esqueleto                 as E
import           Database.Persist                   hiding (get)
import qualified Database.Persist.Postgresql        as SQL

import           Blockchain.Data.ChainInfo
import           Blockchain.ExtWord                 (Word256)
import           Blockchain.TypeLits
import           Blockchain.DB.SQLDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode

getChainInfo :: (HasSQLDB m) => Word256 -> m (Maybe (NamedTuple "id" Word256 "info" ChainInfo))
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
          --accts <- E.select . E.from $ \abRef -> do
            --E.where_ (abRef E.^. ChainAccountBalanceRefChainInfoId E.==. E.val chainInfoRefId)
            --return abRef
          aInfos <- E.select . E.from $ \aiRef -> do
            E.where_ (aiRef E.^. AccountInfoRefChainInfoId E.==. E.val chainInfoRefId)
            return aiRef
          cInfos <- E.select . E.from $ \ciRef -> do
            E.where_ (ciRef E.^. CodeInfoRefChainInfoId E.==. E.val chainInfoRefId)
            return ciRef
          return . Just . fromTuple $ (chainId,
                                       ChainInfo
                                         chainInfoRefChainLabel
                                         (Prelude.map ai aInfos)
                                         (Prelude.map ci cInfos)
                                         (M.fromList (Prelude.map makePairs members)))
          where makePairs = (chainMemberRefAddress &&& (readEnode . chainMemberRefName)) . entityVal
                ai = \aInfo ->
                        if (accountInfoRefCodeHash $ entityVal aInfo) == Nothing
                          then NonContract ((accountInfoRefAddress $ entityVal aInfo)) (accountInfoRefBalance $ entityVal aInfo)
                          else if (accountInfoRefMap $ entityVal aInfo) == Nothing
                            then ContractNoStorage (accountInfoRefAddress $ entityVal aInfo) (accountInfoRefBalance $ entityVal aInfo)
                                 (fromJust (accountInfoRefCodeHash $ entityVal aInfo))
                            else ContractWithStorage (accountInfoRefAddress $ entityVal aInfo) (accountInfoRefBalance $ entityVal aInfo)
                               (fromJust (accountInfoRefCodeHash $ entityVal aInfo)) (fromJust (accountInfoRefMap $ entityVal aInfo))
                ci = \codeInfo ->
                        CodeInfo (codeInfoRefEvmByteCode $ entityVal codeInfo) (codeInfoRefContractCode $ entityVal codeInfo) 
                          (codeInfoRefContractName $ entityVal codeInfo)

getChainInfos :: (HasSQLDB m) => [Word256] -> m (NamedMap "id" Word256 "info" ChainInfo)
getChainInfos chainIds = do
  cids <- case chainIds of
              [] -> do
                  db <- getSQLDB
                  runResourceT . flip SQL.runSqlPool db $ do
                      chains <- E.select . E.from $ \cRef -> do
                          return cRef
                      case chains of
                          [] -> return []
                          cs -> return $ Prelude.map (chainInfoRefChainId . E.entityVal) cs
              cIds -> return cIds
  chainInfos <- mapM getChainInfo cids
  let cInfos = sequence $ Prelude.filter isJust chainInfos
  case cInfos of
      Nothing -> return []
      Just cis -> return cis

putChainInfo :: (HasSQLDB m) => Word256 -> ChainInfo -> m (Key ChainInfoRef)
putChainInfo chainId ChainInfo{..} = do
  db <- getSQLDB
  runResourceT . flip SQL.runSqlPool db $ do
    let chainInfoRef = ChainInfoRef chainId chainLabel
    cirId <- E.insert chainInfoRef
    insertMany_ $ Prelude.map (parseAInfo cirId) acctInfo
    insertMany_ $ Prelude.map (parseCInfo cirId) codeInfo
    insertMany_ $ Prelude.map (parseMember cirId) (M.toList members)
    return cirId
      where
        parseAInfo chid aInfo = 
          case aInfo of
            NonContract a i -> AccountInfoRef chid a i Nothing Nothing
            ContractNoStorage a i h -> AccountInfoRef chid a i (Just h) Nothing
            ContractWithStorage a i h tup -> AccountInfoRef chid a i (Just h) (Just tup)
        parseCInfo ch (CodeInfo bc cc cn)  = 
          CodeInfoRef ch bc cc cn
        parseMember chi (ad, en) = 
          ChainMemberRef chi (showEnode en) ad

instance KnownSymbol "id" where
instance KnownSymbol "info" where
