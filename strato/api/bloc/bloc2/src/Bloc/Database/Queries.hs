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
    getContractDetailsForContract,
    getContractDetailsByCodeHash,
    getCodeCollectionByCodePtr,
    evmContractSolidVMError,
  )
where

import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB (AddressState, unsafeResolveCodePtr)
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Trans.Class (lift)
import Control.Monad.Trans.Except
import qualified Data.Map.Strict as Map
import Data.Source.Annotation
import Data.Source.Map
import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import SQLM
import SolidVM.Model.CodeCollection
import Text.Format
import UnliftIO

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

getContractDetailsByCodeHash ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Account AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  CodePtr ->
  m (Either Text (CodePtr, Contract))
getContractDetailsByCodeHash codePtr = runExceptT $ do
  nameStr <- case codePtr of
    SolidVMCode n _ -> pure n
    CodeAtAccount _ n -> pure n
    _ -> throwE "EVM contracts no longer supported"
  (cHash, cc) <- getCodeHashAndCollection codePtr
  details <- case Map.lookup nameStr $ _contracts cc of
    Nothing -> throwE $ "Could not find contract " <> (Text.pack nameStr) <> " in code collection " <> Text.pack (format codePtr)
    Just d -> pure (SolidVMCode nameStr cHash, d)
  pure $ force details

getCodeCollectionByCodePtr ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Account AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  CodePtr ->
  m (Either Text CodeCollection)
getCodeCollectionByCodePtr = runExceptT . fmap snd . getCodeHashAndCollection

getCodeHashAndCollection ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Account AddressState m,
    (Keccak256 `A.Selectable` SourceMap) m
  ) =>
  CodePtr ->
  ExceptT Text m (Keccak256, CodeCollection)
getCodeHashAndCollection codePtr =
  lift (unsafeResolveCodePtr codePtr) >>= \case
    Nothing -> throwE . Text.pack $ "Could not resolve code pointer: " ++ show codePtr
    Just codeHash -> do
      ch <- case codeHash of
        ExternallyOwned _ -> throwE $ "EVM contracts no longer supported"
        SolidVMCode _ ch -> pure ch
        CodeAtAccount acct _ -> throwE $ "Could not resolve code at account " <> Text.pack (show acct)
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
    A.Selectable Account AddressState m
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
    A.Selectable Account AddressState m
  ) =>
  SourceMap ->
  m (Either [SourceAnnotation Text] (Keccak256, CodeCollection))
sourceToContractDetails = createMetadataNoCompile

-- SolidVM only
createMetadataNoCompile ::
  ( MonadIO m,
    HasCodeDB m,
    A.Selectable Account AddressState m
  ) =>
  SourceMap ->
  m (Either [SourceAnnotation Text] (Keccak256, CodeCollection))
createMetadataNoCompile sourceList = do
  compiledSource <- compileSourceWithAnnotations True (Map.fromList $ unSourceMap sourceList)
  let srcHash = hash . Text.encodeUtf8 $ serializeSourceMap sourceList
  pure $ (srcHash,) <$> compiledSource
