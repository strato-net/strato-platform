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
import qualified Data.Text                         as Text

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
import           Strato.Strato23.Client
import           Strato.Strato23.API.Types

postBlocTransaction :: Maybe Text -> Maybe Text -> Maybe ChainId -> Bool -> PostBlocTransactionRequest -> Bloc [BlocTransactionResult]
postBlocTransaction mUserName mUserId chainId resolve (PostBlocTransactionRequest mAddr txs' txParams) = do
  case (mUserName, mUserId) of
    (Nothing, _) -> error "Did not find X-USER-UNIQUE-NAME in the header"
    (Just _, Nothing) -> error "Did not find X-USER-ID in the header"
    (Just userName, Just userId) -> do
      addr <- case mAddr of
        Nothing -> fmap unStatusAndAddress . blocVaultWrapper $ getKey userName userId Nothing
        Just addr' -> return addr'
      fmap join . forM (partitionWith transactionType txs') $ \(ttype, txs) -> case ttype of
        TRANSFER -> case txs of
          [] -> return []
          [x] -> do
            p <- fromTransfer x
            let btp = TransferParameters
                        addr
                        (transferpayloadToAddress p)
                        (transferpayloadValue p)
                        txParams
                        (transferpayloadMetadata p)
                        chainId
                        resolve
            fmap (:[]) $ postUsersSend' btp (callSignature userName userId)
          xs -> do
            p <- mapM fromTransfer xs
            let btlp = TransferListParameters
                        addr
                        (map (\(TransferPayload t v m) -> SendTransaction t v txParams m) p)
                        chainId
                        resolve
            postUsersSendList' btlp (callSignature userName userId)
        CONTRACT -> case txs of
          [] -> return []
          [x] -> do
            p <- fromContract x
            let md = contractpayloadMetadata p
                bcp = ContractParameters
                        addr
                        (contractpayloadSrc p)
                        (contractpayloadContract p)
                        (contractpayloadArgs p)
                        (contractpayloadValue p)
                        txParams
                        (contractpayloadMetadata p)
                        chainId
                        resolve
                poster = case Map.lookup "VM" =<< md of
                            Nothing -> postUsersContractEVM'
                            Just "EVM" -> postUsersContractEVM'
                            Just "SolidVM" -> postUsersContractSolidVM'
                            Just vm -> \_ _ -> throwError $ UserError $ Text.pack
                                             $ "Invalid value for VM choice: " ++ show vm
            fmap (:[]) $ poster bcp (callSignature userName userId)
          xs -> do
            p <- mapM fromContract xs
            let bclp = ContractListParameters
                        addr
                        (map (\(ContractPayload _ c a v m) -> UploadListContract (fromJust c) (fromMaybe Map.empty a) txParams v m) p)
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
                        (functionpayloadMetadata p)
                        chainId
                        resolve
            fmap (:[]) $ postUsersContractMethod' bfp (callSignature userName userId)
          xs -> do
            p <- mapM fromFunction xs
            let bflp = FunctionListParameters
                        addr
                        (map (\(FunctionPayload (ContractName n) a m r v md) -> MethodCall n a m r (fromMaybe (Strung 0) v) txParams md) p)
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
  SignatureDetails{..} <- blocVaultWrapper $ postSignature userName userId (UserData $ Hex msgHash)
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
    Nothing
