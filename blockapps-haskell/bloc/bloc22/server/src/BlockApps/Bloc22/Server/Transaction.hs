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
import           Crypto.Secp256k1                  (getMsg)
import           Data.Aeson                        hiding (Array, String)
--import           Data.Aeson.Types
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString.Base16            as Base16
import           Data.LargeWord
import qualified Data.Map.Strict                   as Map
import           Data.Maybe
import           Data.RLP
import           Data.Text                         (Text)
import qualified Data.Text.Encoding                as Text
import           Data.Word
import           GHC.Generics
-- import           Network.HTTP.Simple

import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Users
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.Contract()
import           BlockApps.Strato.Types            hiding (Transaction (..))

postBlocTransaction :: Maybe Text -> Maybe ChainId -> Bool -> PostBlocTransactionRequest -> Bloc [BlocTransactionResult]
postBlocTransaction mUserName chainId resolve (PostBlocTransactionRequest txs' txParams) = do
  case mUserName of
    Nothing -> error "Did not find X-USER-UNIQUE-NAME in the header"
    Just _ -> fmap join . forM (partitionWith fst txs') $ \(ttype, txs) -> case ttype of
      TRANSFER -> case txs of
        [] -> return []
        [x] -> do
          p <- fromTransfer $ snd x
          let btp = TransferParameters
                      (Address 0) -- TODO(dustin): Get real address
                      (transferpayloadToAddress p)
                      (transferpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) . postUsersSend' btp $ error "postBlocTransaction.postUsersSend': Not implemented"
        xs -> do
          p <- mapM (fromTransfer . snd) xs
          let btlp = TransferListParameters
                      (Address 0) -- TODO(dustin): Get real address
                      (map (\(TransferPayload t v) -> SendTransaction t v txParams) p)
                      chainId
                      resolve
          postUsersSendList' btlp $ error "postBlocTransaction.postUsersSendList': Not implemented"
      CONTRACT -> case txs of
        [] -> return []
        [x] -> do
          p <- fromContract $ snd x
          let bcp = ContractParameters
                      (Address 0) -- TODO(dustin): Get real address
                      (contractpayloadSrc p)
                      (contractpayloadContract p)
                      (contractpayloadArgs p)
                      (contractpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) . postUsersContract' bcp $ error "postBlocTransaction.postUsersContract': Not implemented"
        xs -> do
          p <- mapM (fromContract . snd) xs
          let bclp = ContractListParameters
                      (Address 0) -- TODO(dustin): Get real address
                      (map (\(ContractPayload _ c a v) -> UploadListContract (fromJust c) (fromMaybe Map.empty a) txParams v) p)
                      chainId
                      resolve
          postUsersUploadList' bclp $ error "postBlocTransaction.postUsersUploadList': Not implemented"
      FUNCTION -> case txs of
        [] -> return []
        [x] -> do
          p <- fromFunction $ snd x
          let bfp = FunctionParameters
                      (Address 0) -- TODO(dustin): Get real address
                      ((\(ContractName c) -> c) $ functionpayloadContractName p)
                      (functionpayloadContractAddress p)
                      (functionpayloadMethod p)
                      (functionpayloadArgs p)
                      (functionpayloadValue p)
                      txParams
                      chainId
                      resolve
          fmap (:[]) . postUsersContractMethod' bfp $ error "postBlocTransaction.postUsersContractMethod': Not implemented"
        xs -> do
          p <- mapM (fromFunction . snd) xs
          let bflp = FunctionListParameters
                      (Address 0) -- TODO(dustin): Get real address
                      (map (\(FunctionPayload (ContractName n) a m r v) -> MethodCall n a m r (fromMaybe (Strung 0) v) txParams) p)
                      chainId
                      resolve
          postUsersContractMethodList' bflp $ error "postBlocTransaction.postUsersContractMethodList': Not implemented"
  where fromTransfer = \case
          BlocTransfer t -> return t
          _ -> throwError $ UserError "Could not decode transfer arguments from body"
        fromContract = \case
          BlocContract c -> return c
          _ -> throwError $ UserError "Could not decode contract arguments from body"
        fromFunction = \case
          BlocFunction f -> return f
          _ -> throwError $ UserError "Could not decode function arguments from body"

prepareTx' :: Text -> TransactionHeader -> Bloc PostTransaction
prepareTx' userName txHeader = prepareSignedTx' userName (transactionheaderFromAddr txHeader) $ prepareUnsignedTx txHeader

prepareSignedTx'
  :: Text
  -> Address
  -> UnsignedTransaction
  -> Bloc PostTransaction
prepareSignedTx' userName addr unsignedTx = do
  tx <- signTransaction' userName unsignedTx
  let kecc = keccak256 (rlpSerialize tx)
      r = transactionR tx
      s = transactionS tx
      v = transactionV tx
      Gas gasLimit = transactionGasLimit tx
      Wei gasPrice = transactionGasPrice tx
      Nonce nonce' = transactionNonce tx
      Wei value = transactionValue tx
      code = Text.decodeUtf8 $ Base16.encode $ transactionInitOrData tx
      toAddr = transactionTo tx
      chainId = transactionChainId tx
  return $ PostTransaction
    { posttransactionHash = kecc
    , posttransactionGasLimit = fromIntegral gasLimit
    , posttransactionCodeOrData = code
    , posttransactionGasPrice = fromIntegral gasPrice
    , posttransactionTo = toAddr
    , posttransactionFrom = addr
    , posttransactionValue = Strung $ fromIntegral value
    , posttransactionR = Hex $ fromIntegral r
    , posttransactionS = Hex $ fromIntegral s
    , posttransactionV = Hex v
    , posttransactionNonce = fromIntegral nonce'
    , posttransactionChainId = chainId
    }

signTransaction' :: Text -> UnsignedTransaction -> Bloc Transaction
signTransaction' userName UnsignedTransaction{..} = do
  sig <- getRSV userName msgHash
  return $ Transaction
    { transactionNonce = unsignedTransactionNonce
    , transactionGasPrice = unsignedTransactionGasPrice
    , transactionGasLimit = unsignedTransactionGasLimit
    , transactionTo = unsignedTransactionTo
    , transactionValue = unsignedTransactionValue
    , transactionV = v sig
    , transactionR = unHex $ r sig
    , transactionS = unHex $ s sig
    , transactionInitOrData = unsignedTransactionInitOrData
    , transactionChainId = unsignedTransactionChainId
    }
  where
    msgHash = getMsg . rlpMsg . Array
      $ [ rlpEncode unsignedTransactionNonce
        , rlpEncode unsignedTransactionGasPrice
        , rlpEncode unsignedTransactionGasLimit
        , rlpEncode unsignedTransactionTo
        , rlpEncode unsignedTransactionValue
        , rlpEncode unsignedTransactionInitOrData
        ] ++ (maybeToList $ fmap rlpEncode unsignedTransactionChainId)

getRSV :: Text -> ByteString -> Bloc SignatureDetails
getRSV _ _ = return $ SignatureDetails (Hex 0) (Hex 0) 0 -- do -- TODO: Actually call signature route
  -- let request = setRequestHeader "X-USER-UNIQUE-NAME" [Text.encodeUtf8 userName]
  --             $ setRequestBodyJSON msgHash
  --             $ "POST http://vault-wrapper:8000/strato/v2.3/signature"
  -- getResponseBody <$> httpJSON request

data SignatureDetails = SignatureDetails
  { r :: Hex Word256
  , s :: Hex Word256
  , v :: Word8
  } deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails

