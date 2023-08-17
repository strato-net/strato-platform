{-# OPTIONS -fno-warn-missing-methods #-}
{-# OPTIONS -fno-warn-orphans         #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Data.ChainInfoDB where

-- import           Control.Monad                      (when)

import BlockApps.Logging
import Blockchain.DB.SQLDB
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import Blockchain.TypeLits
import Control.Arrow ((***))
import qualified Data.Map as M (fromList, toList)
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import Database.Persist hiding (get)

getChainInfo :: HasSQLDB m => Maybe T.Text -> ChainId -> m (Maybe (NamedTuple "id" "info" ChainId ChainInfo))
getChainInfo mLabel (ChainId chainId) = do
  sqlQuery $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      case mLabel of
        Nothing -> E.where_ (cRef E.^. ChainInfoRefChainId E.==. E.val chainId)
        Just label ->
          E.where_
            ( (cRef E.^. ChainInfoRefChainLabel) E.==. E.val (T.unpack label)
                E.&&. cRef E.^. ChainInfoRefChainId E.==. E.val chainId
            )
      return cRef
    case entChainInfos of
      [] -> return Nothing
      (cInfo : _) -> do
        let chainInfoRefId = entityKey cInfo
        let ChainInfoRef {..} = entityVal cInfo
        members <- E.select . E.from $ \mRef -> do
          E.where_ (mRef E.^. ChainMemberParsedRefChainInfoId E.==. E.val chainInfoRefId)
          return mRef
        --accts <- E.select . E.from $ \abRef -> do
        --E.where_ (abRef E.^. ChainAccountBalanceRefChainInfoId E.==. E.val chainInfoRefId)
        --return abRef
        parents <- E.select . E.from $ \mRef -> do
          E.where_ (mRef E.^. ParentChainRefChainInfoId E.==. E.val chainInfoRefId)
          return mRef
        aInfos <- E.select . E.from $ \aiRef -> do
          E.where_ (aiRef E.^. AccountInfoRefChainInfoId E.==. E.val chainInfoRefId)
          return aiRef
        cInfos <- E.select . E.from $ \ciRef -> do
          E.where_ (ciRef E.^. CodeInfoRefChainInfoId E.==. E.val chainInfoRefId)
          return ciRef
        mds <- E.select . E.from $ \cmdRef -> do
          E.where_ (cmdRef E.^. ChainMetadataRefChainInfoId E.==. E.val chainInfoRefId)
          return cmdRef
        return . Just . NamedTuple @"id" @"info" $
          ( ChainId chainId,
            ChainInfo
              ( UnsignedChainInfo
                  (T.pack chainInfoRefChainLabel)
                  (map ai aInfos)
                  (map ci cInfos)
                  (ChainMembers $ S.fromList (map cm members))
                  --  (M.fromList (map makePairs members))
                  (M.fromList $ (\(ParentChainRef _ n i) -> (T.pack n, i)) . entityVal <$> parents)
                  chainInfoRefCreationBlock
                  chainInfoRefChainNonce
                  (M.fromList $ map md mds)
              )
              ( ChainSignature
                  (fromInteger chainInfoRefR)
                  (fromInteger chainInfoRefS)
                  chainInfoRefV
              )
          )
        where
          cm = \cmInfo ->
            let ChainMemberParsedRef {..} = entityVal cmInfo
             in chainMemberParsedRefChainMember

          ai = \aInfo ->
            let AccountInfoRef {..} = entityVal aInfo
                acc
                  | isNothing accountInfoRefCodeHash =
                    NonContract
                      accountInfoRefAddress
                      accountInfoRefBalance
                  | isNothing accountInfoRefMap =
                    ContractNoStorage
                      accountInfoRefAddress
                      accountInfoRefBalance
                      (fromJust accountInfoRefCodeHash)
                  | otherwise =
                    SolidVMContractWithStorage
                      accountInfoRefAddress
                      accountInfoRefBalance
                      (fromJust accountInfoRefCodeHash)
                      (fromJust accountInfoRefMap)
             in acc
          ci = \codeInfo ->
            let CodeInfoRef {..} = entityVal codeInfo
             in CodeInfo
                  codeInfoRefEvmByteCode
                  (T.pack codeInfoRefContractCode)
                  (fmap T.pack codeInfoRefContractName)
          md = \metadata ->
            let ChainMetadataRef {..} = entityVal metadata
             in (T.pack chainMetadataRefKey, T.pack chainMetadataRefValue)

getChainInfosByLabel :: HasSQLDB m => T.Text -> m [(Maybe (NamedTuple "id" "info" ChainId ChainInfo))]
getChainInfosByLabel label = do
  sqlQuery $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      E.where_ (cRef E.^. ChainInfoRefChainLabel E.==. E.val (T.unpack label))
      return cRef
    case entChainInfos of
      [] -> return [Nothing]
      (x : xs) -> sequence $ map mkMNamedTuple (x : xs)
        where
          mkMNamedTuple = \cInf -> do
            let chainInfoRefId = entityKey cInf
            let ChainInfoRef {..} = entityVal cInf
            members <- E.select . E.from $ \mRef -> do
              E.where_ (mRef E.^. ChainMemberParsedRefChainInfoId E.==. E.val chainInfoRefId)
              return mRef
            parents <- E.select . E.from $ \mRef -> do
              E.where_ (mRef E.^. ParentChainRefChainInfoId E.==. E.val chainInfoRefId)
              return mRef
            aInfos <- E.select . E.from $ \aiRef -> do
              E.where_ (aiRef E.^. AccountInfoRefChainInfoId E.==. E.val chainInfoRefId)
              return aiRef
            cInfos <- E.select . E.from $ \ciRef -> do
              E.where_ (ciRef E.^. CodeInfoRefChainInfoId E.==. E.val chainInfoRefId)
              return ciRef
            mds <- E.select . E.from $ \cmdRef -> do
              E.where_ (cmdRef E.^. ChainMetadataRefChainInfoId E.==. E.val chainInfoRefId)
              return cmdRef
            return . Just . NamedTuple @"id" @"info" $
              ( ChainId chainInfoRefChainId,
                ChainInfo
                  ( UnsignedChainInfo
                      (T.pack chainInfoRefChainLabel)
                      (map ai aInfos)
                      (map ci cInfos)
                      (ChainMembers $ S.fromList (map cm members))
                      --  (M.fromList (map makePairs members))
                      (M.fromList $ (\(ParentChainRef _ n i) -> (T.pack n, i)) . entityVal <$> parents)
                      chainInfoRefCreationBlock
                      chainInfoRefChainNonce
                      (M.fromList $ map md mds)
                  )
                  ( ChainSignature
                      (fromInteger chainInfoRefR)
                      (fromInteger chainInfoRefS)
                      chainInfoRefV
                  )
              )

          cm = \cmInfo ->
            let ChainMemberParsedRef {..} = entityVal cmInfo
             in chainMemberParsedRefChainMember

          ai = \aInfo ->
            let AccountInfoRef {..} = entityVal aInfo
                acc
                  | isNothing accountInfoRefCodeHash =
                    NonContract
                      accountInfoRefAddress
                      accountInfoRefBalance
                  | isNothing accountInfoRefMap =
                    ContractNoStorage
                      accountInfoRefAddress
                      accountInfoRefBalance
                      (fromJust accountInfoRefCodeHash)
                  | otherwise =
                    SolidVMContractWithStorage
                      accountInfoRefAddress
                      accountInfoRefBalance
                      (fromJust accountInfoRefCodeHash)
                      (fromJust accountInfoRefMap)
             in acc
          ci = \codeInfo ->
            let CodeInfoRef {..} = entityVal codeInfo
             in CodeInfo
                  codeInfoRefEvmByteCode
                  (T.pack codeInfoRefContractCode)
                  (fmap T.pack codeInfoRefContractName)
          md = \metadata ->
            let ChainMetadataRef {..} = entityVal metadata
             in (T.pack chainMetadataRefKey, T.pack chainMetadataRefValue)

getChainInfos :: HasSQLDB m => [ChainId] -> Maybe T.Text -> Integer -> Integer -> m (NamedMap "id" "info" ChainId ChainInfo)
getChainInfos chainIds mLabel limit offset = do
  chainInfos <- case (chainIds, mLabel) of
    ([], Just label) -> getChainInfosByLabel label
    _ -> do
      cids <- case chainIds of
        [] -> sqlQuery $ do
          chains <- E.select . E.from $ \cRef -> do
            E.offset $ fromInteger offset
            E.limit $ fromInteger limit
            return cRef
          case chains of
            [] -> return []
            cs -> return $ map (ChainId . chainInfoRefChainId . E.entityVal) cs
        cIds -> return cIds
      mapM (getChainInfo mLabel) cids
  let cInfos = sequence $ filter isJust chainInfos
  case cInfos of
    Nothing -> return []
    Just cis -> return cis

putChainInfo :: HasSQLDB m => ChainId -> ChainInfo -> m (Key ChainInfoRef)
putChainInfo (ChainId chainId) (ChainInfo UnsignedChainInfo {..} ChainSignature {..}) = do
  sqlQuery $ do
    let chainInfoRef =
          ChainInfoRef
            chainId
            (T.unpack chainLabel)
            creationBlock
            chainNonce
            (toInteger chainR)
            (toInteger chainS)
            chainV
    cirId <- E.insert chainInfoRef
    insertMany_ $ map (parseAInfo cirId) accountInfo
    insertMany_ $ map (parseCInfo cirId) codeInfo
    insertMany_ $ map (parseMember cirId) (S.toList (unChainMembers members))
    insertMany_ $ map (uncurry $ parseParents cirId) (M.toList parentChains)
    insertMany_ $ map (parseMetadata cirId) (M.toList chainMetadata)
    return cirId
  where
    parseAInfo chid aInfo =
      case aInfo of
        NonContract a i -> AccountInfoRef chid a i Nothing Nothing
        ContractNoStorage a i h -> AccountInfoRef chid a i (Just h) Nothing
        ContractWithStorage a i h tup -> AccountInfoRef chid a i (Just h) (Just $ map (word256ToBytes *** (rlpSerialize . rlpEncode)) tup)
        SolidVMContractWithStorage a i h tup -> AccountInfoRef chid a i (Just h) (Just tup)
    parseCInfo ch (CodeInfo bc cc cn) =
      CodeInfoRef ch bc (T.unpack cc) (fmap T.unpack cn)
    parseMember chi cmps =
      ChainMemberParsedRef chi cmps
    parseParents chi name cid =
      ParentChainRef chi (T.unpack name) cid
    parseMetadata chi (k, v) =
      ChainMetadataRef chi (T.unpack k) (T.unpack v)

addParent :: HasSQLDB m => Word256 -> T.Text -> Word256 -> m ()
addParent chainId parentName parentChainId = do
  sqlQuery $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      E.where_ (cRef E.^. ChainInfoRefChainId E.==. E.val chainId)
      return cRef
    case entChainInfos of
      [] -> return ()
      (cInfo : _) -> do
        let chainInfoRefId = entityKey cInfo
        insertMany_ [ParentChainRef chainInfoRefId (T.unpack parentName) parentChainId]

addMember :: HasSQLDB m => Word256 -> ChainMemberParsedSet -> m ()
addMember chainId cmps = do
  sqlQuery $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      E.where_ (cRef E.^. ChainInfoRefChainId E.==. E.val chainId)
      return cRef
    case entChainInfos of
      [] -> return ()
      (cInfo : _) -> do
        let chainInfoRefId = entityKey cInfo
        insertMany_ [ChainMemberParsedRef chainInfoRefId cmps]

removeMember :: HasSQLDB m => Word256 -> ChainMemberParsedSet -> m ()
removeMember chainId cmps = do
  sqlQuery $ do
    entChainInfos <- E.select . E.from $ \cRef -> do
      E.where_ (cRef E.^. ChainInfoRefChainId E.==. E.val chainId)
      return cRef
    case entChainInfos of
      [] -> return ()
      (cInfo : _) -> do
        let chainInfoRefId = entityKey cInfo
        insertMany_ [ChainMemberParsedRef chainInfoRefId cmps]

terminateChain :: MonadLogger m => Word256 -> m ()
terminateChain _ = $logWarnS "ChainInfoDB" "TODO(dustin): terminate chains"
