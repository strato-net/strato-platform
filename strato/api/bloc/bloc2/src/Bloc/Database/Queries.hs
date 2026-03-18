{-# LANGUAGE Arrows #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.Database.Queries
  ( sourceToContractDetails,
    getContractByAddress,
    getContractWithCodeCollectionByAddress,
    getContractByAccountsFilterParams,
    getContractDetailsForContract,
    getContractDetailsByCodeHash,
    getCodeCollectionByCodePtr,
    getContractWithCodeCollectionByCodePtr,
    evmContractSolidVMError,
  )
where

import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB (AddressState)
import Blockchain.Data.AddressStateRef
import Blockchain.Data.DataDefs (AddressStateRef(..))
import Blockchain.Model.JsonBlock
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Control.Lens ((^.), (&), (?~))
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import Data.Foldable (foldl')
import qualified Data.Map.Strict as Map
import Data.Maybe (catMaybes, fromMaybe, listToMaybe)
import Data.Source.Annotation
import Data.Source.Map
import qualified Data.Set as S
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Handlers.AccountInfo
import Handlers.Storage
import SQLM
import SolidVM.Model.CodeCollection
import SolidVM.Model.Storable
import Text.Format
import UnliftIO

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

getContractByAddress ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m
  ) =>
  Address ->
  Maybe Text ->
  m (Maybe Contract)
getContractByAddress a mFuncName = getContractByAccountsFilterParams
  (accountsFilterParams & qaAddress ?~ a)
  mFuncName

-- | Get contract and code collection by address (for file-level struct access)
-- Also resolves proxy contracts by looking up their logicContract
getContractWithCodeCollectionByAddress ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m
  ) =>
  Address ->
  Text ->
  m (Maybe (Contract, CodeCollection))
getContractWithCodeCollectionByAddress a fn = runMaybeT $ do
  (AddressStateRef' r _) <- MaybeT . fmap listToMaybe $ getAccount'
    $ accountsFilterParams & qaAddress ?~ a
  codePtr <- MaybeT . pure $ addressStateRefCodePtr r
  -- Check if this is a proxy contract and resolve the logic contract's functions
  let proxyContractNames = ["Proxy", "UserRegistry", "User"]
      proxyFunctionNames = ["setLogicContract", "transferOwnership", "renounceOwnership"]
      userRegistryFunctionNames = ["createUser", "createUserFor", "deriveUserAddress", "canCreateUser", "initializeUser"]
      userFunctionNames = ["addUserAddress", "revokeUserAddress", "revokeAllUserAddresses", "createContract", "createSaltedContract", "callContract"]
      allFunctionNames = [proxyFunctionNames, proxyFunctionNames ++ userRegistryFunctionNames, proxyFunctionNames ++ userFunctionNames]
      funcSet = S.fromList . concat $ zipWith (map . (,)) proxyContractNames allFunctionNames
      getLogicCodePtr = do
        (StorageAddress _ v _) <- MaybeT
          . fmap listToMaybe
          . getStorage'
          $ storageFilterParams
              { qsAddress = Just a
              , qsKey = Just "logicContract"
              }
        logicAddr <- MaybeT . pure $ case v of
          BAddress address' -> Just address'
          _ -> Nothing
        (AddressStateRef' l _) <- MaybeT
          . fmap listToMaybe
          . getAccount'
          $ accountsFilterParams & qaAddress ?~ logicAddr
        MaybeT . pure $ addressStateRefCodePtr l
  case addressStateRefContractName r of
    -- Proxy contract, calling a logic contract function: load only logic CC
    Just name | name `elem` proxyContractNames && not (S.member (name, fn) funcSet) -> do
      mLogicCodePtr <- lift . runMaybeT $ getLogicCodePtr
      MaybeT $ either (const Nothing) Just <$> getContractWithCodeCollectionByCodePtr (fromMaybe codePtr mLogicCodePtr)
    -- Not a proxy, or calling a proxy-native function: load only proxy CC
    _ -> MaybeT $ either (const Nothing) Just <$> getContractWithCodeCollectionByCodePtr codePtr

getContractByAccountsFilterParams ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m,
    A.Selectable AccountsFilterParams [AddressStateRef] m,
    A.Selectable StorageFilterParams [StorageAddress] m
  ) =>
  AccountsFilterParams ->
  Maybe Text ->
  m (Maybe Contract)
getContractByAccountsFilterParams aParams mFuncName = runMaybeT $ do
  (AddressStateRef' r _) <- MaybeT . fmap listToMaybe $ getAccount' aParams
  let proxyContractNames = ["Proxy", "UserRegistry", "User"]
      proxyFunctionNames = ["setLogicContract", "transferOwnership", "renounceOwnership"]
      userRegistryFunctionNames = ["createUser", "createUserFor", "deriveUserAddress", "canCreateUser", "initializeUser"]
      userFunctionNames = ["addUserAddress", "revokeUserAddress", "revokeAllUserAddresses", "createContract", "createSaltedContract", "callContract"]
      allFunctionNames = [proxyFunctionNames, proxyFunctionNames ++ userRegistryFunctionNames, proxyFunctionNames ++ userFunctionNames]
      funcSet = S.fromList . concat $ zipWith (map . (,)) proxyContractNames allFunctionNames
      getLogicCodePtr = do
        a <- MaybeT . pure $ aParams ^. qaAddress
        (StorageAddress _ v _) <- MaybeT
          . fmap listToMaybe
          . getStorage'
          $ storageFilterParams
              { qsAddress = Just a
              , qsKey = Just "logicContract"
              }
        logicContract <- MaybeT . pure $ case v of
          BAddress address' -> Just address'
          _ -> Nothing
        (AddressStateRef' l _) <- MaybeT
          . fmap listToMaybe
          . getAccount'
          $ accountsFilterParams
            & qaAddress ?~ logicContract
        MaybeT . pure $ addressStateRefCodePtr l
  codePtr <- MaybeT . pure $ addressStateRefCodePtr r
  case (addressStateRefContractName r, mFuncName) of
    -- Proxy contract, calling a logic contract function: load only logic contract
    (Just name, Just fn) | name `elem` proxyContractNames && not (S.member (name, fn) funcSet) -> do
      mLogicCodePtr <- lift . runMaybeT $ getLogicCodePtr
      MaybeT $ do
        eContract <- getContractDetailsByCodeHash $ fromMaybe codePtr mLogicCodePtr
        pure $ either (const Nothing) (Just . snd) eContract
    -- Proxy contract, no function specified: load both and merge
    (Just name, Nothing) | name `elem` proxyContractNames -> do
      mLogicCodePtr <- lift . runMaybeT $ getLogicCodePtr
      MaybeT $ do
        let codePtrs = codePtr : maybe [] (:[]) mLogicCodePtr
        eContracts <- traverse getContractDetailsByCodeHash codePtrs
        case catMaybes $ either (const Nothing) (Just . snd) <$> eContracts of
          [] -> pure Nothing
          (c:cs) -> pure . Just $ foldl' (<>) c cs
    -- Not a proxy, or calling a proxy-native function: load only proxy contract
    _ -> MaybeT $ do
      eContract <- getContractDetailsByCodeHash codePtr
      pure $ either (const Nothing) (Just . snd) eContract

getContractDetailsByCodeHash ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  CodePtr ->
  m (Either Text (CodePtr, Contract))
getContractDetailsByCodeHash codePtr = runExceptT $ do
  nameStr <- case codePtr of
    SolidVMCode n _ -> pure n
    _ -> throwE "EVM contracts no longer supported"
  (cHash, cc) <- getCodeHashAndCollection codePtr
  details <- case Map.lookup nameStr $ _contracts cc of
    Nothing -> throwE $ "Could not find contract " <> (Text.pack nameStr) <> " in code collection " <> Text.pack (format codePtr)
    Just d -> pure (SolidVMCode nameStr cHash, d)
  pure $ force details

getCodeCollectionByCodePtr ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  CodePtr ->
  m (Either Text CodeCollection)
getCodeCollectionByCodePtr = runExceptT . fmap snd . getCodeHashAndCollection

-- | Get both the contract and code collection (for file-level struct access)
getContractWithCodeCollectionByCodePtr ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  CodePtr ->
  m (Either Text (Contract, CodeCollection))
getContractWithCodeCollectionByCodePtr codePtr = runExceptT $ do
  nameStr <- case codePtr of
    SolidVMCode n _ -> pure n
    _ -> throwE "EVM contracts no longer supported"
  (_, cc) <- getCodeHashAndCollection codePtr
  contract <- case Map.lookup nameStr $ _contracts cc of
    Nothing -> throwE $ "Could not find contract " <> (Text.pack nameStr) <> " in code collection " <> Text.pack (format codePtr)
    Just d -> pure d
  pure $ force (contract, cc)

getCodeHashAndCollection ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  CodePtr ->
  ExceptT Text m (Keccak256, CodeCollection)
getCodeHashAndCollection codePtr = do
      ch <- case codePtr of
        ExternallyOwned _ -> throwE $ "EVM contracts no longer supported"
        SolidVMCode _ ch -> pure ch
      srcMap <-
        lift (A.select (A.Proxy @SourceMap) ch) >>= \case
          Nothing -> throwE $ "Could not find source code for code hash " <> Text.pack (format ch)
          Just s -> pure s
      either (throwE . Text.pack . show) pure =<< lift (sourceToContractDetails srcMap)

evmContractSolidVMError :: Text
evmContractSolidVMError =
  Text.concat
    [ "Upload Contract (EVM): The given contracts were previously uploaded for ",
      "SolidVM. Please retry your request specifying SolidVM as the VM type. ",
      "If you are intending to use EVM, please modify your contracts and try again."
    ]

getContractDetailsForContract ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  SourceMap ->
  Maybe Text ->
  m (Maybe (CodePtr, Contract))
getContractDetailsForContract src mContract = do
  eCodeCollection <-
    if hasAnyNonEmptySources src
      then sourceToContractDetails src
      else throwIO . UserError $ "No source code given for contract"
  case eCodeCollection of
    Left annotations -> throwIO . UserError . Text.pack $ "Detected errors during compilation: " ++ show annotations
    Right (ch, CodeCollection {..}) -> case mContract of
      Nothing -> case Map.elems _contracts of
        [] -> pure Nothing
        [x] -> pure $ Just (SolidVMCode (_contractName x) ch, x)
        _ -> throwIO $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
      Just c -> pure . fmap (SolidVMCode (Text.unpack c) ch,) $ Map.lookup (Text.unpack c) _contracts

sourceToContractDetails ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  SourceMap ->
  m (Either [SourceAnnotation Text] (Keccak256, CodeCollection))
sourceToContractDetails = createMetadataNoCompile

-- SolidVM only
createMetadataNoCompile ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Address AddressState m
  ) =>
  SourceMap ->
  m (Either [SourceAnnotation Text] (Keccak256, CodeCollection))
createMetadataNoCompile sourceList = do
  let isRunningTests = False
  compiledSource <- compileSourceWithAnnotations isRunningTests True (Map.fromList $ unSourceMap sourceList)
  let srcHash = hash . Text.encodeUtf8 $ serializeSourceMap sourceList
  pure $ (srcHash,) <$> compiledSource
