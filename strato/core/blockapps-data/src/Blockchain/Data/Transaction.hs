{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeFamilies #-}

{-# OPTIONS  -fno-warn-orphans     #-}
module Blockchain.Data.Transaction
  ( Transaction (..),
    isMessageTX,
    txAndTime2RawTX,
    tx2RawTXAndTime,
    rawTX2TX,
    insertTX,
    insertTX',
    insertTXIfNew,
    insertTXIfNew',
    isContractCreationTX,
    whoSignedThisTransaction,
    transactionHash,
    partialTransactionHash,
    whoSignedThisTransactionEcrecover,
    whoReallySignedThisTransactionEcrecover,
    ethVToRecoveryId,
    ethVToChainId,
    toEthV,
    getSigVals,
    codePtrName,
    codePtrHash
  )
where

import Blockchain.DB.SQLDB
import Blockchain.DBM
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Data.RawTransaction
import Blockchain.Data.TXOrigin
import Blockchain.Data.TransactionDef
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Secp256k1 as EC
import Control.DeepSeq
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Reader
import qualified Crypto.Secp256k1 as SEC
import qualified Data.ByteString as B
import qualified Data.ByteString.Short as BSS
import Data.Maybe
import Data.Time.Clock
import Data.Word
import qualified Database.Persist.Postgresql as SQL
import System.Clock

instance TransactionLike Transaction where
  txHash = hash . rlpSerialize . rlpEncode
  txPartialHash = hash . rlpSerialize . partialRLPEncode
  txChainHash = error "Transaction.txChainHash: Not a private transaction"
  txSigner = whoSignedThisTransaction
  txNonce = nonce
  txNetwork t = case t of
    EthereumTX{} -> ""
    _            -> network t
  txFuncName t = case t of
    MessageTX{..} -> Just funcName
    _ -> Nothing
  txContractName t = case t of
    ContractCreationTX{..} -> Just contractName
    _ -> Nothing
  txArgs t = case t of
    EthereumTX{} -> []
    _            -> args t
  txSignature EthereumTX{..} = (r, s, v)
  txSignature t = (r t, s t, v t)
  txGasLimit = gasLimit

  txType MessageTX {} = Message
  txType ContractCreationTX {} = ContractCreation
  txType EthereumTX {ethTo = Nothing} = ContractCreation
  txType EthereumTX {} = Message

  txDestination MessageTX {..} = Just to
  txDestination ContractCreationTX {} = Nothing
  txDestination EthereumTX {..} = ethTo

  txCode MessageTX {} = Nothing
  txCode ContractCreationTX {..} = Just code
  txCode EthereumTX {} = Nothing

  txChainId = chainId

  morphTx t = case txType t of
    Message
      | Just fn <- txFuncName t ->
          MessageTX n gl (fromJust $ txDestination t) fn args network cid r s v
      | otherwise ->
          EthereumTX n 0 gl (txDestination t) 0 B.empty cid r s v
    ContractCreation
      | Just cn <- txContractName t ->
          ContractCreationTX n gl cn args network (fromJust $ txCode t) cid r s v
      | otherwise ->
          EthereumTX n 0 gl Nothing 0 B.empty cid r s v
    where
      n = txNonce t
      gl = txGasLimit t
      args = txArgs t
      network = txNetwork t
      cid = txChainId t
      (r, s, v) = txSignature t

codePtrHash :: CodePtr -> Maybe Keccak256
codePtrHash (ExternallyOwned k) = Just k
codePtrHash (SolidVMCode _ k) = Just k

codePtrName :: CodePtr -> Maybe String
codePtrName (SolidVMCode n _) = Just n
codePtrName _ = Nothing

rawTX2TX :: RawTransaction -> Transaction
rawTX2TX (RawTransaction _ _ nonce' gl (Just to') (Just fn) Nothing ags net Nothing cid r' s' v' _ _ _ _ _ _) =
  MessageTX nonce' gl to' fn ags net cid r' s' v'
rawTX2TX (RawTransaction _ _ nonce' gl Nothing Nothing (Just cn) ags net (Just cd) cid r' s' v' _ _ _ _ _ _) =
  ContractCreationTX nonce' gl cn ags net cd cid r' s' v'
rawTX2TX (RawTransaction _ _ nonce' gl mTo Nothing Nothing [] _ Nothing cid r' s' v' _ _ _ mgp mval mdata) =
  EthereumTX nonce' (fromMaybe 0 mgp) gl mTo (fromMaybe 0 mval) (fromMaybe B.empty mdata) cid r' s' v'
rawTX2TX rt = error $ "rawTX2TX: " ++ show rt

txAndTime2RawTX :: TXOrigin -> Transaction -> Integer -> UTCTime -> RawTransaction
txAndTime2RawTX origin tx blkNum time =
  case tx of
    MessageTX{..} ->
      RawTransaction time signer nonce gasLimit (Just to) (Just funcName) Nothing args network Nothing chainId r s v (fromIntegral blkNum) (txHash tx) origin Nothing Nothing Nothing
    ContractCreationTX{..} ->
      RawTransaction time signer nonce gasLimit Nothing Nothing (Just contractName) args network (Just code) chainId r s v (fromIntegral blkNum) (txHash tx) origin Nothing Nothing Nothing
    EthereumTX{..} ->
      RawTransaction time signer nonce gasLimit ethTo Nothing Nothing [] "" Nothing chainId r s v (fromIntegral blkNum) (txHash tx) origin (Just gasPrice) (Just value) (Just txData)
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

insertTXIfNew' ::
  MonadUnliftIO m =>
  TXOrigin ->
  Maybe Integer ->
  UTCTime ->
  [Transaction] ->
  ReaderT SQL.SqlBackend m ()
insertTXIfNew' origin blockNum time = insertTX' Fail origin blockNum time

insertTX' ::
  MonadUnliftIO m =>
  DebugMode ->
  TXOrigin ->
  Maybe Integer ->
  UTCTime ->
  [Transaction] ->
  ReaderT SQL.SqlBackend m ()
insertTX' mode origin blockNum time txs = do
  let rawTXs =
        map (\tx -> txAndTime2RawTX origin tx (fromMaybe (-1) blockNum) time) txs
  insertRawTX' mode rawTXs

-- so we can convert R and S from the signature, and add 27 to V, per
-- Ethereum protocol (and backwards compatibility)
getSigVals :: EC.Signature -> (Word256, Word256, Word8)
getSigVals (EC.Signature (SEC.CompactRecSig r s v)) =
  let convert = bytesToWord256 . BSS.fromShort
   in (convert r, convert s, v + 0x1b)

whoSignedThisTransaction :: Transaction -> Maybe Address
whoSignedThisTransaction tx@EthereumTX{..} = fromPublicKey <$> EC.recoverPub sig mesg
    where
      intToBSS = BSS.toShort . word256ToBytes . fromInteger
      sig = EC.Signature (SEC.CompactRecSig (intToBSS r) (intToBSS s) v)
      mesg = keccak256ToByteString $ hash $ rlpSerialize $ case chainId of
        Nothing  -> partialRLPEncode tx
        Just cid -> case partialRLPEncode tx of
          RLPArray items -> RLPArray $ items ++ [rlpEncode cid, rlpEncode (0::Integer), rlpEncode (0::Integer)]
          x -> x
whoSignedThisTransaction tx = fromPublicKey <$> EC.recoverPub sig mesg
    where
      intToBSS = BSS.toShort . word256ToBytes . fromInteger
      sig = EC.Signature (SEC.CompactRecSig (intToBSS $ r tx) (intToBSS $ s tx) ((v tx) - 0x1b))
      mesg = keccak256ToByteString $ partialTransactionHash tx

whoSignedThisTransactionEcrecover :: Keccak256 -> Integer -> Integer -> Integer -> Maybe Address
whoSignedThisTransactionEcrecover hsh r s v = fromPublicKey <$> EC.recoverPub sig mesg
  where
    intToBSS = BSS.toShort . word256ToBytes . fromInteger
    sig = EC.Signature (SEC.CompactRecSig (intToBSS $ r) (intToBSS $ s) (((fromInteger v) :: Word8) - 0x1b))
    mesg = keccak256ToByteString $ hsh

whoReallySignedThisTransactionEcrecover :: Keccak256 -> Word256 -> Word256 -> Word8 -> Maybe Address
whoReallySignedThisTransactionEcrecover hsh r s v = fromPublicKey <$> EC.recoverPub sig mesg
  where
    word256ToBSS = BSS.toShort . word256ToBytes
    sig = EC.Signature (SEC.CompactRecSig (word256ToBSS $ r) (word256ToBSS $ s) v)
    mesg = keccak256ToByteString $ hsh

isContractCreationTX :: Transaction -> Bool
isContractCreationTX ContractCreationTX {} = True
isContractCreationTX EthereumTX {ethTo = Nothing} = True
isContractCreationTX _ = False

transactionHash :: Transaction -> Keccak256
transactionHash = hash . rlpSerialize . rlpEncode

partialTransactionHash :: Transaction -> Keccak256
partialTransactionHash = hash . rlpSerialize . partialRLPEncode
