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
import           Data.Aeson                        hiding (Array, String)
import           Data.LargeWord
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.Text                         (Text)
import qualified Data.Text.Encoding                as Text
import           Data.Word
import           GHC.Generics
import           Network.HTTP.Simple

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

postBlocTransaction :: Maybe Text -> Maybe ChainId -> Bool -> PostBlocTransactionRequest -> Bloc [BlocTransactionResult]
postBlocTransaction mUserName chainId resolve (PostBlocTransactionRequest addr txs' txParams) = do
  case mUserName of
    Nothing -> error "Did not find X-USER-UNIQUE-NAME in the header"
    Just userName -> fmap join . forM (partitionWith fst txs') $ \(ttype, txs) -> case ttype of
      TRANSFER -> case txs of
        [] -> return []
        [x] -> do
          p <- fromTransfer $ snd x
          let btp = TransferParameters
                      addr
                      (transferpayloadTo p)
                      (transferpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) $ postUsersSend' btp (callSignature userName)
        xs -> do
          p <- mapM (fromTransfer . snd) xs
          let btlp = TransferListParameters
                      addr
                      (map (\(TransferPayload t v) -> SendTransaction t v txParams) p)
                      chainId
                      resolve
          postUsersSendList' btlp (callSignature userName)
      CONTRACT -> case txs of
        [] -> return []
        [x] -> do
          p <- fromContract $ snd x
          let bcp = ContractParameters
                      addr
                      (contractpayloadSrc p)
                      (contractpayloadContract p)
                      (contractpayloadArgs p)
                      (contractpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) $ postUsersContract' bcp (callSignature userName)
        xs -> do
          p <- mapM (fromContract . snd) xs
          let bclp = ContractListParameters
                      addr
                      (map (\(ContractPayload _ c a v) -> UploadListContract (fromJust c) (fromMaybe Map.empty a) txParams v) p)
                      chainId
                      resolve
          postUsersUploadList' bclp (callSignature userName)
      FUNCTION -> case txs of
        [] -> return []
        [x] -> do
          p <- fromFunction $ snd x
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
          fmap (:[]) $ postUsersContractMethod' bfp (callSignature userName)
        xs -> do
          p <- mapM (fromFunction . snd) xs
          let bflp = FunctionListParameters
                      addr
                      (map (\(FunctionPayload (ContractName n) a m r v) -> MethodCall n a m r (fromMaybe (Strung 0) v) txParams) p)
                      chainId
                      resolve
          postUsersContractMethodList' bflp (callSignature userName)
  where fromTransfer = \case
          BlocTransfer t -> return t
          _ -> throwError $ UserError "Could not decode transfer arguments from body"
        fromContract = \case
          BlocContract c -> return c
          _ -> throwError $ UserError "Could not decode contract arguments from body"
        fromFunction = \case
          BlocFunction f -> return f
          _ -> throwError $ UserError "Could not decode function arguments from body"

callSignature :: Text -> UnsignedTransaction -> Bloc Transaction
callSignature userName unsigned@UnsignedTransaction{..} = do
  let msgHash = byteStringToWord256 $ rlpHash unsigned
  SignatureDetails{..} <- getRSV userName msgHash
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

getRSV :: Text -> Word256 -> Bloc SignatureDetails
getRSV userName msgHash' = do
  let request = setRequestHeader "X-USER-UNIQUE-NAME" [Text.encodeUtf8 userName]
              $ setRequestBodyJSON (UserData (Hex msgHash'))
              $ "POST http://vault-wrapper:8000/strato/v2.3/signature" -- TODO(dustin): Establish a vault-wrapper API type and call this endpoint
  getResponseBody <$> httpJSON request

data SignatureDetails = SignatureDetails
  { r :: Hex Word256
  , s :: Hex Word256
  , v :: Hex Word8
  } deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails

data UserData = UserData {
  msgHash :: Hex Word256
} deriving (Eq, Show, Generic)

instance ToJSON UserData
instance FromJSON UserData
