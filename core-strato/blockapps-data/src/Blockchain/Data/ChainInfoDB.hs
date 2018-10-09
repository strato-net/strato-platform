{-# OPTIONS -fno-warn-missing-methods #-}
{-# OPTIONS -fno-warn-orphans         #-}
{-# LANGUAGE DataKinds                #-}
{-# LANGUAGE FlexibleInstances        #-}
{-# LANGUAGE OverloadedStrings        #-}
{-# LANGUAGE RecordWildCards          #-}
{-# LANGUAGE ScopedTypeVariables      #-}

module Blockchain.Data.ChainInfoDB where

import           Control.Arrow                      ((&&&))
import           Control.Monad                      (when)
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import qualified Data.Map                           as M        (fromList, toList)
import           Data.Maybe
import qualified Data.Text                          as T

import qualified Database.Esqueleto                 as E
import           Database.Persist                               hiding (get)
import qualified Database.Persist.Postgresql        as SQL

import           Blockchain.Data.ChainInfo
import           Blockchain.ExtWord                 (Word256)
import           Blockchain.TypeLits
import           Blockchain.DB.SQLDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Strato.Model.Address

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
                                         (map ai aInfos)
                                         (map ci cInfos)
                                         (M.fromList (map makePairs members)))
          where makePairs = (chainMemberRefAddress &&& (readEnode . chainMemberRefName)) . entityVal
                ai = \aInfo ->
                        let AccountInfoRef{..} = entityVal aInfo
                            acc | isNothing accountInfoRefCodeHash
                                    = NonContract
                                        accountInfoRefAddress
                                        accountInfoRefBalance
                                | isNothing accountInfoRefMap
                                    = ContractNoStorage
                                        accountInfoRefAddress
                                        accountInfoRefBalance
                                        (fromJust accountInfoRefCodeHash)
                                | otherwise
                                    = ContractWithStorage
                                        accountInfoRefAddress
                                        accountInfoRefBalance
                                        (fromJust accountInfoRefCodeHash)
                                        (fromJust accountInfoRefMap)
                         in acc
                ci = \codeInfo ->
                        let CodeInfoRef{..} = entityVal codeInfo
                         in CodeInfo
                              codeInfoRefEvmByteCode
                              (T.pack codeInfoRefContractCode)
                              (T.pack codeInfoRefContractName)

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
                          cs -> return $ map (chainInfoRefChainId . E.entityVal) cs
              cIds -> return cIds
  chainInfos <- mapM getChainInfo cids
  let cInfos = sequence $ filter isJust chainInfos
  case cInfos of
      Nothing -> return []
      Just cis -> return cis

putChainInfo :: (HasSQLDB m) => Word256 -> ChainInfo -> m (Key ChainInfoRef)
putChainInfo chainId ChainInfo{..} = do
  db <- getSQLDB
  runResourceT . flip SQL.runSqlPool db $ do
    let chainInfoRef = ChainInfoRef chainId chainLabel
    cirId <- E.insert chainInfoRef
    insertMany_ $ map (parseAInfo cirId) accountInfo
    insertMany_ $ map (parseCInfo cirId) codeInfo
    insertMany_ $ map (parseMember cirId) (M.toList members)
    return cirId
      where
        parseAInfo chid aInfo =
          case aInfo of
            NonContract a i -> AccountInfoRef chid a i Nothing Nothing
            ContractNoStorage a i h -> AccountInfoRef chid a i (Just h) Nothing
            ContractWithStorage a i h tup -> AccountInfoRef chid a i (Just h) (Just tup)
        parseCInfo ch (CodeInfo bc cc cn)  =
          CodeInfoRef ch bc (T.unpack cc) (T.unpack cn)
        parseMember chi (ad, en) =
          ChainMemberRef chi (showEnode en) ad

addMember :: (HasSQLDB m) => Word256 -> Address -> String -> m ()
addMember chainId address enode = do
  db <- getSQLDB
  runResourceT . flip SQL.runSqlPool db $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      E.where_ (cRef E.^. ChainInfoRefChainId E.==. E.val chainId)
      return cRef
    case entChainInfos of
      []  -> return ()
      (cInfo:_) -> do
          let chainInfoRefId = entityKey cInfo
          let ChainInfoRef{..} = entityVal cInfo
          members <- E.select . E.from $ \mRef -> do
            E.where_ (mRef E.^. ChainMemberRefChainInfoId E.==. E.val chainInfoRefId)
            return mRef
          when (null $ filter ((== address) . chainMemberRefAddress . E.entityVal) members) $ do
            insertMany_ [ChainMemberRef chainInfoRefId enode address]

removeMember :: (HasSQLDB m) => Word256 -> Address -> m ()
removeMember chainId address = do
  db <- getSQLDB
  runResourceT . flip SQL.runSqlPool db $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      E.where_ (cRef E.^. ChainInfoRefChainId E.==. E.val chainId)
      return cRef
    case entChainInfos of
      []  -> return ()
      (cInfo:_) -> do
          let chainInfoRefId = entityKey cInfo
          let ChainInfoRef{..} = entityVal cInfo
          member <- E.select . E.from $ \mRef -> do
            E.where_ ((mRef E.^. ChainMemberRefChainInfoId E.==. E.val chainInfoRefId)
                      E.&&. (mRef E.^. ChainMemberRefAddress E.==. E.val address))
            return mRef
          when (not $ null member) $ do
            delete . entityKey $ head member

terminateChain :: (MonadLogger m, HasSQLDB m) => Word256 -> m ()
terminateChain _ = $logWarnS "ChainInfoDB" "TODO(dustin): terminate chains"

instance KnownSymbol "id" where
instance KnownSymbol "info" where
