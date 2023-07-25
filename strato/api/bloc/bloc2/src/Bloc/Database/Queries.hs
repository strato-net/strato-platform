{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE Arrows                #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE BangPatterns          #-}

module Bloc.Database.Queries
  ( sourceToContractDetails
  , getContractDetailsForContract
  , getContractDetailsByCodeHash
  , evmContractSolidVMError
  ) where

import           Blockchain.Data.AddressStateDB  (AddressState, unsafeResolveCodePtrSelect)
import           Control.DeepSeq
import qualified Control.Monad.Change.Alter      as A
import           Control.Monad.Trans.Class       (lift)
import           Control.Monad.Trans.Except
import qualified Data.Map.Strict                 as Map
import           Data.Text                       (Text)
import qualified Data.Text                       as Text
import qualified Data.Text.Encoding              as Text
import           Text.Format
import           UnliftIO

import           Blockchain.SolidVM.CodeCollectionDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Data.Source.Annotation
import           Data.Source.Map
import           SolidVM.Model.CodeCollection

import           SQLM

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

getContractDetailsByCodeHash :: ( A.Selectable Account AddressState m
                                , (Keccak256 `A.Selectable` SourceMap) m
                                )
                             => CodePtr -> m (Either Text (CodePtr, Contract))
getContractDetailsByCodeHash codePtr = do
  runExceptT $ do
    mDetails <- lift (unsafeResolveCodePtrSelect codePtr) >>= \mcp -> flip traverse mcp $ \codeHash -> do
      (name, ch) <- case codeHash of
        EVMCode _ -> throwE $ "EVM contracts no longer supported"
        SolidVMCode name ch -> pure (Text.pack name, ch)
        CodeAtAccount acct _ -> throwE $ "Could not resolve code at account " <> Text.pack (show acct)
      srcMap <- lift (A.select (A.Proxy @SourceMap) ch) >>= \case
        Nothing -> throwE $ "Could not find source code for code hash " <> Text.pack (format ch)
        Just s -> pure s
      let nameStr = Text.unpack name
      ~(cHash, cc) <- either (throwE . Text.pack . show) pure $ sourceToContractDetails srcMap
      case Map.lookup nameStr $ _contracts cc of
          Nothing -> throwE $ "Could not find contract " <> name <> " in code collection " <> Text.pack (format ch)
          Just d -> pure (SolidVMCode nameStr cHash, d)
    let !mDetails' = force mDetails
    case mDetails' of
      Nothing -> throwE $ "Could not resolve code pointer " <> Text.pack (format codePtr)
      Just details -> pure details

evmContractSolidVMError :: Text
evmContractSolidVMError = Text.concat
  [ "Upload Contract (EVM): The given contracts were previously uploaded for "
  , "SolidVM. Please retry your request specifying SolidVM as the VM type. "
  , "If you are intending to use EVM, please modify your contracts and try again."
  ]

getContractDetailsForContract :: MonadIO m
                              => SourceMap -> Maybe Text -> m (Maybe (CodePtr, Contract))
getContractDetailsForContract src mContract = do
  eCodeCollection <- if hasAnyNonEmptySources src
                       then pure $ sourceToContractDetails src
                       else throwIO . UserError $ "No source code given for contract"
  case eCodeCollection of
    Left annotations -> throwIO . UserError . Text.pack $ "Detected errors during compilation: " ++ show annotations
    Right (ch, CodeCollection{..}) -> case mContract of
      Nothing -> case Map.elems _contracts of
        [] -> pure Nothing
        [x] -> pure $ Just (SolidVMCode (_contractName x) ch, x)
        _ -> throwIO $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
      Just c -> pure . fmap (SolidVMCode (Text.unpack c) ch,) $ Map.lookup (Text.unpack c) _contracts

sourceToContractDetails :: SourceMap -> Either [SourceAnnotation Text] (Keccak256, CodeCollection)
sourceToContractDetails = createMetadataNoCompile

-- SolidVM only
createMetadataNoCompile :: SourceMap -> Either [SourceAnnotation Text] (Keccak256, CodeCollection)
createMetadataNoCompile sourceList =
  let compiledSource = compileSourceWithAnnotations True (Map.fromList $ unSourceMap sourceList)
      srcHash = hash . Text.encodeUtf8 $ serializeSourceMap sourceList
   in (srcHash,) <$> compiledSource