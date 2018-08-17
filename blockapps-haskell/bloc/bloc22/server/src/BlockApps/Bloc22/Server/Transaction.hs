{-# LANGUAGE Arrows              #-}
{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Transaction where

import           Control.Monad
import           Control.Monad.Except
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.Text                         (Text)

import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Users
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract()
import           BlockApps.SolidityVarReader       (byteStringToWord256) -- TODO: Find a better module for this function
import           BlockApps.Strato.Types            hiding (Transaction (..))
import           BlockApps.VaultWrapper.Client
import           BlockApps.VaultWrapper.Types

postBlocTransaction :: Maybe Text -> Maybe Text -> Maybe ChainId -> Bool -> PostBlocTransactionRequest -> Bloc [BlocTransactionResult]
postBlocTransaction mUserName mUserId chainId resolve (PostBlocTransactionRequest addr txs' txParams) = do
  case (mUserName, mUserId) of
    (Nothing, _) -> error "Did not find X-USER-UNIQUE-NAME in the header"
    (Just _, Nothing) -> error "Did not find X-USER-ID in the header"
    (Just userName, Just userId) -> fmap join . forM (partitionWith transactionType txs') $ \(ttype, txs) -> case ttype of
      TRANSFER -> case txs of
        [] -> return []
        [x] -> do
          p <- fromTransfer x
          let btp = TransferParameters
                      addr
                      (transferpayloadToAddress p)
                      (transferpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) $ postUsersSend' btp (callSignature userName userId)
        xs -> do
          p <- mapM fromTransfer xs
          let btlp = TransferListParameters
                      addr
                      (map (\(TransferPayload t v) -> SendTransaction t v txParams) p)
                      chainId
                      resolve
          postUsersSendList' btlp (callSignature userName userId)
      CONTRACT -> case txs of
        [] -> return []
        [x] -> do
          p <- fromContract x
          let bcp = ContractParameters
                      addr
                      (contractpayloadSrc p)
                      (contractpayloadContract p)
                      (contractpayloadArgs p)
                      (contractpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) $ postUsersContract' bcp (callSignature userName userId)
        xs -> do
          p <- mapM fromContract xs
          let bclp = ContractListParameters
                      addr
                      (map (\(ContractPayload _ c a v) -> UploadListContract (fromJust c) (fromMaybe Map.empty a) txParams v) p)
                      chainId
                      resolve
          postUsersUploadList' bclp (callSignature userName userId)
      FUNCTION -> case txs of
        [] -> return []
        [x] -> do
          p <- fromFunction x
          let bfp = FunctionParameters
                      addr
                      ((\(ContractName c) -> c) $ functionpayloadContractName p)
                      (functionpayloadContractAddress p)
                      (functionpayloadMethod p)
                      (functionpayloadArgs p)
                      (functionpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) $ postUsersContractMethod' bfp (callSignature userName userId)
        xs -> do
          p <- mapM fromFunction xs
          let bflp = FunctionListParameters
                      addr
                      (map (\(FunctionPayload (ContractName n) a m r v) -> MethodCall n a m r (fromMaybe (Strung 0) v) txParams) p)
                      chainId
                      resolve
          postUsersContractMethodList' bflp (callSignature userName userId)
  where fromTransfer = \case
          BlocTransfer t -> return t
          _ -> throwError $ UserError "Could not decode transfer arguments from body"
        fromContract = \case
          BlocContract c -> return c
          _ -> throwError $ UserError "Could not decode contract arguments from body"
        fromFunction = \case
          BlocFunction f -> return f
          _ -> throwError $ UserError "Could not decode function arguments from body"

callSignature :: Text -> Text -> UnsignedTransaction -> Bloc Transaction
callSignature userName userId unsigned@UnsignedTransaction{..} = do
  let msgHash = byteStringToWord256 $ rlpHash unsigned
  SignatureDetails{..} <- blocVaultWrapper $ postSignature (Just userName) (Just userId) (userData msgHash)
  return $ Transaction
    unsignedTransactionNonce
    unsignedTransactionGasPrice
    unsignedTransactionGasLimit
    unsignedTransactionTo
    unsignedTransactionValue
    unsignedTransactionInitOrData
    unsignedTransactionChainId
    (unHex v)
    (unHex r)
    (unHex s)
