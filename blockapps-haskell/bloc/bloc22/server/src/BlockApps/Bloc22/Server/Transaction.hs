{-# LANGUAGE Arrows              #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections       #-}
{-# LANGUAGE TypeApplications    #-}

module BlockApps.Bloc22.Server.Transaction where

import           Control.Monad
import           Control.Monad.Except
import           Control.Monad.Log
import qualified Data.Aeson                        as Aeson
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString                   as ByteString
import qualified Data.ByteString.Lazy              as BL
import qualified Data.ByteString.Base16            as Base16
import           Data.Int                          (Int32)
import qualified Data.Map.Strict                   as Map
import qualified Data.Map.Ordered                  as OMap
import           Data.Monoid
import           Data.RLP
import           Data.Text                         (Text)
import qualified Data.Text                         as Text
import qualified Data.Text.Encoding                as Text
import           Opaleye                           hiding (not, null, index)

import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.Users
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Solidity.Contract()
import qualified BlockApps.Solidity.Contract       as C
import           BlockApps.Solidity.Struct
import           BlockApps.Solidity.Type
import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Client
import           BlockApps.Strato.Types            hiding (Transaction (..))
import           BlockApps.XAbiConverter

postBlocTransaction :: Maybe Text -> Maybe ChainId -> Bool -> PostBlocTransactionRequest -> Bloc BlocTransactionResult
postBlocTransaction mUserName chainId resolve (PostBlocTransactionRequest txType payload txParams) = do
  case mUserName of 
    Nothing -> error "Did not find X-USER-UNIQUE-NAME in the header"
    Just userName -> do  
      case txType of
        CONTRACT -> postContract userName chainId resolve txParams payload
        TRANSFER -> postTransfer userName chainId resolve txParams payload
        FUNCTION -> error "Unimplemented"

postContract :: Text -> Maybe ChainId -> Bool -> Maybe TxParams -> BlocTransactionPayload -> Bloc BlocTransactionResult
postContract userName chainId resolve mTxParams payload = blocTransaction $ do
  case payload of
      ContractPayload{..} -> do
        txParams <- getAccountTxParams (Address 0x00) chainId mTxParams
        idsAndDetails <- compileContract contractpayloadSrc
        logWith logNotice ("constructor arguments: " <> Text.pack (show contractpayloadArgs))
        (cmId,ContractDetails{..}) <-
          case contractpayloadContract of
            Nothing ->
              case Map.toList idsAndDetails of
                [] -> throwError $ UserError "You need to supply at least one contract in the source"
                [(_, x)] -> return x
                _ -> throwError $ UserError "When you upload multiple contracts, you need to specify which contract should be uploaded to the chain in the 'contract' key of the given data"
            Just contract ->
              blocMaybe "Could not find global contract metadataId" $
              Map.lookup contract idsAndDetails
        let
          (bin,leftOver) = Base16.decode $ Text.encodeUtf8 contractdetailsBin
        unless (ByteString.null leftOver) $ throwError $ AnError "Couldn't decode binary"
        mFunctionId <- getConstructorId cmId
        argsBin <- buildArgumentByteString (fmap (fmap argValueToText) contractpayloadArgs) mFunctionId
        tx <- prepareTx' userName $
          TransactionHeader
            Nothing
            (Address 0x00)
            txParams
            (Wei (fromIntegral (maybe 0 unStrung contractpayloadValue)))
            (bin <> argsBin)
            0
            chainId
        logWith logNotice ("tx is: " <> Text.pack (show tx))
        hash <- blocStrato $ postTx tx
        void . blocModify $ \conn -> runInsertMany conn hashNameTable [
          ( Nothing
          , constant hash
          , constant cmId
          , constant (1 :: Int32)
          , constant contractdetailsName
          )]
        getBlocTransactionResult' chainId hash resolve
      _ -> error "invalid payload for contract"

postTransfer :: Text -> Maybe ChainId -> Bool -> Maybe TxParams -> BlocTransactionPayload -> Bloc BlocTransactionResult
postTransfer userName chainId resolve mTxParams payload = do
  case payload of 
    TransferPayload{..} -> do
      txParams <- getAccountTxParams (Address 0x00) chainId mTxParams
      tx <- prepareTx' userName $
        TransactionHeader
          (Just transferpayloadToAddress)
          (Address 0x00)
          txParams
          (Wei (fromIntegral $ unStrung transferpayloadValue))
          ByteString.empty
          0
          chainId
      hash <- blocStrato $ postTx tx
      void . blocModify $ \conn -> runInsertMany conn hashNameTable [
        ( Nothing
        , constant hash
        , constant (0 :: Int32)
        , constant (0 :: Int32)
        , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode tx)
        )]
      getBlocTransactionResult' chainId hash resolve
    _ -> error "invalid payload for transfer"

postFunctionCall :: Text -> Maybe ChainId -> Bool -> Maybe TxParams -> BlocTransactionPayload -> Bloc BlocTransactionResult
postFunctionCall userName chainId resolve mTxParams payload = do
  case payload of
    FunctionPayload (ContractName contractName) contractAddr funcName args value  -> do
      txParams <- getAccountTxParams (Address 0x00) chainId mTxParams
      cmId <- getContractsMetaDataIdExhaustive contractName contractAddr chainId

      contract' <- getContractContractByMetadataId cmId

      let maybeFunc = OMap.lookup funcName (fields $ C.mainStruct contract')
      sel <-
        case maybeFunc of
         Just (_, TypeFunction selector _ _) -> return selector
         _ -> throwError . UserError $ "Contract doesn't have a method named '" <> funcName <> "'"
      functionId <- getFunctionId cmId funcName
      argsBin <- buildArgumentByteString (Just (fmap argValueToText args)) (Just functionId)
      tx <- prepareTx' userName $
        TransactionHeader
          (Just contractAddr)
          (Address 0x00)
          txParams
          (Wei (maybe 0 (fromIntegral . unStrung) value))
          ((sel::ByteString) <> (argsBin::ByteString))
          0
          chainId
      logWith logNotice ("tx is: " <> Text.pack (show tx))
      hash <- blocStrato $ postTx tx
      void . blocModify $ \conn -> runInsertMany conn hashNameTable [
        ( Nothing
        , constant hash
        , constant cmId
        , constant (2 :: Int32)
        , constant funcName
        )]
      getBlocTransactionResult' chainId hash resolve
    _ -> error "invalid payload for function call"

prepareTx' :: Text -> TransactionHeader -> Bloc PostTransaction
prepareTx' userName txHeader = do
  return . prepareSignedTx' userName (transactionheaderFromAddr txHeader) $ prepareUnsignedTx txHeader 

prepareSignedTx'
  :: Text
  -> Address
  -> UnsignedTransaction
  -> PostTransaction
prepareSignedTx' userName addr unsignedTx = PostTransaction
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
  where
    tx = signTransaction' userName unsignedTx
    kecc = keccak256 (rlpSerialize tx)
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

signTransaction' :: Text -> UnsignedTransaction -> Transaction
signTransaction' userName UnsignedTransaction{..} = Transaction
  { transactionNonce = unsignedTransactionNonce
  , transactionGasPrice = unsignedTransactionGasPrice
  , transactionGasLimit = unsignedTransactionGasLimit
  , transactionTo = unsignedTransactionTo
  , transactionValue = unsignedTransactionValue
  , transactionV = v
  , transactionR = r
  , transactionS = s
  , transactionInitOrData = unsignedTransactionInitOrData
  , transactionChainId = unsignedTransactionChainId
  }
  where
    --TODO call /signature to get r, s, v values
    r = 0xa90ee66c8faf6ce19a5e0496fc809cc1d6984d8636afc9c8a8b2ac381cabc014
    s = 0x5a5e4ac0d5b1d8cde2662075ee00ecd2da47faae2729252c92237057c6e5b32a
    v = 0x1c
