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
    createMessageTX,
    createContractCreationTX,
    isContractCreationTX,
    whoSignedThisTransaction,
    transactionHash,
    partialTransactionHash,
    whoSignedThisTransactionEcrecover,
    whoReallySignedThisTransactionEcrecover,
    getSigVals,
    codePtrAddress,
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
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.PositiveInteger
import qualified Blockchain.Strato.Model.Secp256k1 as EC
import Control.DeepSeq
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Reader
import qualified Crypto.Secp256k1 as SEC
import qualified Data.ByteString.Short as BSS
import Data.Maybe
import Data.Text (Text)
import Data.Time.Clock
import Data.Word
import qualified Database.Persist.Postgresql as SQL
import System.Clock
import System.IO.Unsafe (unsafePerformIO)
import Test.QuickCheck

instance TransactionLike Transaction where
  txHash = hash . rlpSerialize . rlpEncode
  txPartialHash = hash . rlpSerialize . partialRLPEncode
  txChainHash = error "Transaction.txChainHash: Not a private transaction"
  txSigner = whoSignedThisTransaction
  txNonce = transactionNonce
  txNetwork = transactionNetwork
  txFuncName t = case t of
    MessageTX{..} -> Just transactionFuncName
    _ -> Nothing
  txContractName t = case t of
    ContractCreationTX{..} -> Just transactionContractName
    _ -> Nothing
  txArgs = transactionArgs
  txSignature t = (transactionR t, transactionS t, transactionV t)
  txGasLimit = transactionGasLimit

  txType MessageTX {} = Message
  txType ContractCreationTX {} = ContractCreation

  txDestination MessageTX {..} = Just transactionTo
  txDestination ContractCreationTX {} = Nothing

  txCode MessageTX {} = Nothing
  txCode ContractCreationTX {..} = Just transactionCode

  morphTx t = case type' of
    Message -> MessageTX n gl dest (fromJust $ txFuncName t) args network r s v
    ContractCreation -> ContractCreationTX n gl (fromJust contractName) args network code r s v
    where
      type' = txType t
      n = txNonce t
      gl = txGasLimit t
      args = txArgs t
      contractName = txContractName t
      dest = fromJust (txDestination t)
      network = txNetwork t
      code = fromJust (txCode t)
      (r, s, v) = txSignature t

codePtrHash :: CodePtr -> Maybe Keccak256
codePtrHash (ExternallyOwned k) = Just k
codePtrHash (SolidVMCode _ k) = Just k
codePtrHash _ = Nothing

codePtrName :: CodePtr -> Maybe String
codePtrName (SolidVMCode n _) = Just n
codePtrName (CodeAtAccount _ n) = Just n
codePtrName _ = Nothing

codePtrAddress :: CodePtr -> Maybe Address
codePtrAddress (CodeAtAccount a _) = Just a
codePtrAddress _ = Nothing

rawTX2TX :: RawTransaction -> Transaction
rawTX2TX (RawTransaction _ _ nonce' gl (Just to') (Just funcName) Nothing args network Nothing r s v _ _ _) =
  MessageTX nonce' gl to' funcName args network r s v
rawTX2TX (RawTransaction _ _ nonce' gl Nothing Nothing (Just contractName) args network (Just code) r s v _ _ _) =
  ContractCreationTX nonce' gl contractName args network code r s v
rawTX2TX rt = error $ "rawTX2TX: " ++ show rt

txAndTime2RawTX :: TXOrigin -> Transaction -> Integer -> UTCTime -> RawTransaction
txAndTime2RawTX origin tx blkNum time =
  case tx of
    MessageTX{..} ->
      RawTransaction time signer transactionNonce transactionGasLimit (Just transactionTo) (Just transactionFuncName) Nothing transactionArgs transactionNetwork Nothing transactionR transactionS transactionV (fromIntegral blkNum) (txHash tx) origin
    ContractCreationTX{..} ->
      RawTransaction time signer transactionNonce transactionGasLimit Nothing Nothing (Just transactionContractName) transactionArgs transactionNetwork (Just transactionCode) transactionR transactionS transactionV (fromIntegral blkNum) (txHash tx) origin
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
  [Transaction] ->
  ReaderT SQL.SqlBackend m ()
insertTXIfNew' = insertTX' Fail

insertTX' ::
  MonadUnliftIO m =>
  DebugMode ->
  TXOrigin ->
  Maybe Integer ->
  [Transaction] ->
  ReaderT SQL.SqlBackend m ()
insertTX' mode origin blockNum txs = do
  time <- liftIO getCurrentTime
  let rawTXs =
        map (\tx -> txAndTime2RawTX origin tx (fromMaybe (-1) blockNum) time) txs
  insertRawTX' mode rawTXs

-- so we can convert R and S from the signature, and add 27 to V, per
-- Ethereum protocol (and backwards compatibility)
getSigVals :: EC.Signature -> (Word256, Word256, Word8)
getSigVals (EC.Signature (SEC.CompactRecSig r s v)) =
  let convert = bytesToWord256 . BSS.fromShort
   in (convert r, convert s, v + 0x1b)

createMessageTX ::
  Integer ->
  Integer ->
  Address ->
  Text ->
  [Text] ->
  Text ->
  EC.PrivateKey ->
  IO Transaction
createMessageTX n gl toAddr funcName args network prvKey = do
  let unsignedTX =
        MessageTX
          { transactionNonce = n,
            transactionGasLimit = gl,
            transactionTo = toAddr,
            transactionFuncName = funcName,
            transactionArgs = args,
            transactionNetwork = network,
            transactionR = 0,
            transactionS = 0,
            transactionV = 0
          }
  let theHash = partialTransactionHash unsignedTX

  let (r, s, v) = getSigVals $ EC.signMsg prvKey $ word256ToBytes $ keccak256ToWord256 theHash

  return $ case unsignedTX of
    MessageTX {} -> unsignedTX {transactionR = toInteger r, transactionS = toInteger s, transactionV = v}
    _ -> error "createChainMessageTX: PrivateHashTX not supported should be impossible"

createContractCreationTX ::
  Integer ->
  Integer ->
  Text ->
  [Text] ->
  Code ->
  Text ->
  EC.PrivateKey ->
  IO Transaction
createContractCreationTX n gl contractName args code network prvKey = do
  let unsignedTX =
        ContractCreationTX
          { transactionNonce = n,
            transactionGasLimit = gl,
            transactionContractName = contractName,
            transactionArgs = args,
            transactionNetwork = network,
            transactionCode = code,
            transactionR = 0,
            transactionS = 0,
            transactionV = 0
          }

  let theHash = partialTransactionHash unsignedTX

  let (r, s, v) = getSigVals $ EC.signMsg prvKey $ word256ToBytes $ keccak256ToWord256 theHash

  return $ case unsignedTX of
    ContractCreationTX {} -> unsignedTX {transactionR = toInteger r, transactionS = toInteger s, transactionV = v}
    _ -> error "createChainContractCreationTX: not supported should be impossible"

-- return unsignedTX { transactionR = toInteger r, transactionS = toInteger s, transactionV = v }

{-
  Switch to Either?
-}

whoSignedThisTransaction :: Transaction -> Maybe Address
whoSignedThisTransaction tx = fromPublicKey <$> EC.recoverPub sig mesg
    where
      intToBSS = BSS.toShort . word256ToBytes . fromInteger
      sig = EC.Signature (SEC.CompactRecSig (intToBSS $ transactionR tx) (intToBSS $ transactionS tx) ((transactionV tx) - 0x1b))
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

{-
whoSignedThisTransaction::Transaction->Maybe Address -- Signatures can be malformed, hence the Maybe
whoSignedThisTransaction tx = case tx of
  PrivateHashTX{} -> Just (Address 0)
  t -> pubKey2Address <$> getPubKeyFromSignature xSignature (keccak256ToWord256 theHash)
        where
          xSignature = ExtendedSignature (Signature (fromInteger $ transactionR t) (fromInteger $ transactionS t)) (0x1c == transactionV t)
          theHash = partialTransactionHash t
-}
isContractCreationTX :: Transaction -> Bool
isContractCreationTX ContractCreationTX {} = True
isContractCreationTX _ = False

transactionHash :: Transaction -> Keccak256
transactionHash = hash . rlpSerialize . rlpEncode

partialTransactionHash :: Transaction -> Keccak256
partialTransactionHash = hash . rlpSerialize . partialRLPEncode


instance Arbitrary Transaction where
  arbitrary = do
        nonce <- unboxPI <$> arbitrary
        gasPrice <- unboxPI <$> arbitrary
        gasLimit <- arbitrary `suchThat` (> gasPrice)
        prvKey <- arbitrary
        isMessage <- arbitrary :: Gen Bool
        network <- arbitrary
        args <- arbitrary
        case isMessage of
          True -> do
            to <- arbitrary
            funcName <- arbitrary
            return . unsafePerformIO $
              createMessageTX nonce gasLimit to funcName args network prvKey
          False -> do
            contractCode <- arbitrary
            contractName <- arbitrary
            return . unsafePerformIO $
              createContractCreationTX nonce gasLimit contractName args contractCode network prvKey
