{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS  -fno-warn-orphans     #-}
module Blockchain.Data.Transaction (
  Transaction(..),
  isMessageTX,
  txAndTime2RawTX,
  tx2RawTXAndTime,
  rawTX2TX,
  insertTX,
  insertTX',
  insertTXIfNew,
  insertTXIfNew',
  createMessageTX,
  createChainMessageTX,
  createContractCreationTX,
  createChainContractCreationTX,
  isContractCreationTX,
  whoSignedThisTransaction,
  transactionHash,
  partialTransactionHash
  ) where

import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Reader
import qualified Data.ByteString                as B
import qualified Data.ByteString.Base16         as B16
import           Data.ByteString.Internal
import           Data.Map.Strict                (Map)
import qualified Data.Map.Strict                as M
import           Data.Maybe
import           Data.Text                      (Text)
import           Data.Time.Clock
import qualified Database.Persist.Postgresql    as SQL
import           Numeric

import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RawTransaction
import           Blockchain.Data.RLP
import           Blockchain.Data.TransactionDef
import           Blockchain.Data.TXOrigin
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.FastECRecover
import           Blockchain.SHA
import           Blockchain.Util

import           Blockchain.ExtendedECDSA
import           Network.Haskoin.Internals      hiding (Address, txHash, txSignature)

import           Control.DeepSeq
import           System.Clock

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.ExtendedWord (Word256)

instance TransactionLike Transaction where
    txHash        = \case
                       PrivateHashTX{..} -> SHA transactionTxHash
                       t -> hash . rlpSerialize $ rlpEncode t
    txPartialHash = \case
                       PrivateHashTX{..} -> SHA transactionTxHash
                       t -> hash . rlpSerialize $ partialRLPEncode t
    txChainHash   = \case
                       PrivateHashTX{..} -> SHA transactionChainHash
                       _ -> error "Transaction.txChainHash: Not a private transaction"
    txSigner      = \case
                       PrivateHashTX{} -> Just (Address 0) -- TODO: Should this be an error instead?
                       t -> whoSignedThisTransaction t
    txNonce       = \case
                       PrivateHashTX{} -> 0
                       t -> transactionNonce t
    txSignature   = \case
                       PrivateHashTX{..} -> (fromIntegral transactionTxHash, fromIntegral transactionChainHash, 0)
                       t -> (transactionR t, transactionS t, transactionV t)
    txValue       = \case
                       PrivateHashTX{} -> 0
                       t -> transactionValue t
    txGasPrice    = \case
                       PrivateHashTX{} -> 0
                       t -> transactionGasPrice t
    txGasLimit    = \case
                       PrivateHashTX{} -> 0
                       t -> transactionGasLimit t
    txChainId     = \case
                       PrivateHashTX{} -> Nothing
                       t -> transactionChainId t
    txMetadata    = \case
                       PrivateHashTX{} -> Nothing
                       t -> transactionMetadata t
    txAnchorChain = const Nothing -- raw transactions don't have an AnchorChain

    txType MessageTX{}          = Message
    txType ContractCreationTX{} = ContractCreation
    txType PrivateHashTX{}      = PrivateHash

    txDestination MessageTX{..}        = Just transactionTo
    txDestination ContractCreationTX{} = Nothing
    txDestination PrivateHashTX{}      = Nothing

    txCode MessageTX{}            = Nothing
    txCode ContractCreationTX{..} = Just transactionInit
    txCode PrivateHashTX{}        = Nothing

    txData MessageTX{..}        = Just transactionData
    txData ContractCreationTX{} = Nothing
    txData PrivateHashTX{}      = Nothing

    morphTx t = case type' of
        Message          -> MessageTX n gp gl dest val dat chainId r s v md
        ContractCreation -> ContractCreationTX n gp gl val code chainId r s v md
        PrivateHash      -> PrivateHashTX (fromInteger r) (fromInteger s)
        where type'     = txType t
              n         = txNonce t
              gp        = txGasPrice t
              gl        = txGasLimit t
              val       = txValue t
              dest      = fromJust (txDestination t)
              dat       = fromJust (txData t)
              code      = fromJust (txCode t)
              (r, s, v) = txSignature t
              chainId   = txChainId t
              md        = txMetadata t

rawTX2TX :: RawTransaction -> Transaction
rawTX2TX (RawTransaction _ _ nonce' gp gl (Just to') val dat cid r s v md _ _ _) =
  MessageTX nonce' gp gl to' val dat (toMaybe 0 cid) r s v (M.fromList <$> md)
rawTX2TX (RawTransaction _ _ 0 0 0 Nothing 0 init' 0 h ch 0 Nothing _ _ _) | init' == B.empty =
  PrivateHashTX (fromInteger h) (fromInteger ch)
rawTX2TX (RawTransaction _ _ nonce' gp gl Nothing val init' cid r s v md _ _ _) =
  ContractCreationTX nonce' gp gl val (Code init') (toMaybe 0 cid) r s v (M.fromList <$> md)

txAndTime2RawTX :: TXOrigin -> Transaction -> Integer -> UTCTime -> RawTransaction
txAndTime2RawTX origin tx blkNum time =
  case tx of
    (MessageTX nonce' gp gl to' val dat cid r s v md) ->
        RawTransaction time signer nonce' gp gl (Just to') val dat (fromMaybe 0 cid) r s v (M.toList <$> md) (fromIntegral blkNum) (txHash tx) origin
    (ContractCreationTX nonce' gp gl val (Code init') cid r s v md) ->
        RawTransaction time signer nonce' gp gl Nothing val init' (fromMaybe 0 cid) r s v (M.toList <$> md) (fromIntegral blkNum) (txHash tx) origin
    (PrivateHashTX h ch) ->
        RawTransaction time signer 0 0 0 Nothing 0 B.empty 0 (fromIntegral h) (fromIntegral ch) 0 Nothing (fromIntegral blkNum) (txHash tx) origin
  where
    signer = fromMaybe (Address (-1)) $ whoSignedThisTransaction tx

tx2RawTXAndTime :: (MonadIO m) => TXOrigin -> Transaction -> m RawTransaction
tx2RawTXAndTime origin tx = do
  time <- liftIO getCurrentTime
  return $ txAndTime2RawTX origin tx (-1) time

insertTXIfNew :: HasSQLDB m => TXOrigin -> Maybe Integer -> [Transaction] -> m Integer
insertTXIfNew = insertTX Fail

insertTX :: HasSQLDB m => DebugMode -> TXOrigin -> Maybe Integer -> [Transaction] -> m Integer
insertTX mode origin blockNum txs = do
  time <- liftIO getCurrentTime
  beforeECRecover <- liftIO $ getTime Realtime
  let rawTXs =
        map (\tx -> txAndTime2RawTX origin tx (fromMaybe (-1) blockNum) time) txs
  afterECRecover <- rawTXs `deepseq` liftIO (getTime Realtime)
  insertRawTX mode rawTXs
  return $ toNanoSecs $ afterECRecover - beforeECRecover

insertTXIfNew' :: MonadUnliftIO m =>
                  TXOrigin -> Maybe Integer -> [Transaction] -> ReaderT SQL.SqlBackend m ()
insertTXIfNew' = insertTX' Fail

insertTX' :: MonadUnliftIO m =>
             DebugMode -> TXOrigin -> Maybe Integer -> [Transaction] -> ReaderT SQL.SqlBackend m ()
insertTX' mode origin blockNum txs = do
  time <- liftIO getCurrentTime
  let rawTXs =
        map (\tx -> txAndTime2RawTX origin tx (fromMaybe (-1) blockNum) time) txs
  insertRawTX' mode rawTXs

addLeadingZerosTo64::String->String
addLeadingZerosTo64 x = replicate (64 - length x) '0' ++ x

createMessageTX::MonadIO m=>Integer->Integer->Integer->Address->Integer->B.ByteString-> Maybe (Map Text Text) -> PrvKey->SecretT m Transaction
createMessageTX n gp gl to' val theData md prvKey = createChainMessageTX n gp gl to' val theData Nothing md prvKey

createChainMessageTX :: MonadIO m
                     => Integer
                     -> Integer
                     -> Integer
                     -> Address
                     -> Integer
                     -> B.ByteString
                     -> Maybe Word256
                     -> Maybe (Map Text Text)
                     -> PrvKey
                     -> SecretT m Transaction
createChainMessageTX n gp gl to' val theData cid md prvKey = do
  let unsignedTX = MessageTX {
                     transactionNonce = n,
                     transactionGasPrice = gp,
                     transactionGasLimit = gl,
                     transactionTo = to',
                     transactionValue = val,
                     transactionData = theData,
                     transactionChainId = cid,
                     transactionR = 0,
                     transactionS = 0,
                     transactionV = 0,
                     transactionMetadata = md
                   }
  let SHA theHash = partialTransactionHash unsignedTX
  ExtendedSignature signature yIsOdd <- extSignMsg theHash prvKey
  return
    unsignedTX {
      transactionR =
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigR signature) "" of
          (val', "") -> byteString2Integer val'
          _          -> error ("error: sigR is: " ++ showHex (sigR signature) ""),
      transactionS =
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigS signature) "" of
          (val', "") -> byteString2Integer val'
          _          -> error ("error: sigS is: " ++ showHex (sigS signature) ""),
      transactionV = if yIsOdd then 0x1c else 0x1b
    }

createContractCreationTX::MonadIO m=>Integer->Integer->Integer->Integer->Code-> Maybe (Map Text Text) -> PrvKey->SecretT m Transaction
createContractCreationTX n gp gl val init' md prvKey = createChainContractCreationTX n gp gl val init' Nothing md prvKey

createChainContractCreationTX :: MonadIO m
                              => Integer
                              -> Integer
                              -> Integer
                              -> Integer
                              -> Code
                              -> Maybe Word256
                              -> Maybe (Map Text Text)
                              -> PrvKey
                              -> SecretT m Transaction
createChainContractCreationTX n gp gl val init' cid md prvKey = do
  let unsignedTX = ContractCreationTX {
                     transactionNonce = n,
                     transactionGasPrice = gp,
                     transactionGasLimit = gl,
                     transactionValue = val,
                     transactionInit = init',
                     transactionChainId = cid,
                     transactionR = 0,
                     transactionS = 0,
                     transactionV = 0,
                     transactionMetadata = md
                   }

  let SHA theHash = partialTransactionHash unsignedTX
  ExtendedSignature signature yIsOdd <- extSignMsg theHash prvKey
  return
    unsignedTX {
      transactionR =
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigR signature) "" of
          (val', "") -> byteString2Integer val'
          _          -> error ("error: sigR is: " ++ showHex (sigR signature) ""),
      transactionS =
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigS signature) "" of
          (val', "") -> byteString2Integer val'
          _          -> error ("error: sigS is: " ++ showHex (sigS signature) ""),
      transactionV = if yIsOdd then 0x1c else 0x1b
    }


{-
  Switch to Either?
-}
whoSignedThisTransaction::Transaction->Maybe Address -- Signatures can be malformed, hence the Maybe
whoSignedThisTransaction tx = case tx of
  PrivateHashTX{} -> Just (Address 0)
  t -> pubKey2Address <$> getPubKeyFromSignature_fast xSignature theHash
        where
          xSignature = ExtendedSignature (Signature (fromInteger $ transactionR t) (fromInteger $ transactionS t)) (0x1c == transactionV t)
          SHA theHash = partialTransactionHash t

isContractCreationTX::Transaction->Bool
isContractCreationTX ContractCreationTX{} = True
isContractCreationTX _                    = False

transactionHash::Transaction->SHA
transactionHash = \case
                     PrivateHashTX{..} -> SHA transactionTxHash
                     t -> hash . rlpSerialize $ rlpEncode t

partialTransactionHash::Transaction->SHA
partialTransactionHash = \case
                            PrivateHashTX{..} -> SHA transactionTxHash -- TODO: Should this be an error instead?
                            t -> hash . rlpSerialize $ partialRLPEncode t
