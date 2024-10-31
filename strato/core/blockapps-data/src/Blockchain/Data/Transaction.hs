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
    createChainMessageTX,
    createContractCreationTX,
    createChainContractCreationTX,
    isContractCreationTX,
    whoSignedThisTransaction,
    transactionHash,
    partialTransactionHash,
    whoSignedThisTransactionEcrecover,
    whoReallySignedThisTransactionEcrecover,
    getSigVals,
    codePtrChainId,
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
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.Model.Secp256k1 as EC
-- import qualified Data.ByteString.Short as B (ShortByteString, toShort, fromShort)
import Control.DeepSeq
import Control.Monad.IO.Class
import Control.Lens ((^.))
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Reader
import qualified Crypto.Secp256k1 as SEC
import qualified Data.ByteString as B
import qualified Data.ByteString.Short as BSS
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Text (Text)
import Data.Time.Clock
import Data.Word
import qualified Database.Persist.Postgresql as SQL
import System.Clock

-- import Data.ByteString (ByteString)

instance TransactionLike Transaction where
  txHash = \case
    PrivateHashTX {..} -> transactionTxHash
    t -> hash . rlpSerialize $ rlpEncode t
  txPartialHash = \case
    PrivateHashTX {..} -> transactionTxHash
    t -> hash . rlpSerialize $ partialRLPEncode t
  txChainHash = \case
    PrivateHashTX {..} -> transactionChainHash
    _ -> error "Transaction.txChainHash: Not a private transaction"
  txSigner = \case
    PrivateHashTX {} -> Just (Address 0) -- TODO: Should this be an error instead?
    t -> whoSignedThisTransaction t
  txNonce = \case
    PrivateHashTX {} -> 0
    t -> transactionNonce t
  txSignature = \case
    PrivateHashTX {..} -> (fromIntegral $ keccak256ToWord256 transactionTxHash, fromIntegral $ keccak256ToWord256 transactionChainHash, 0)
    t -> (transactionR t, transactionS t, transactionV t)
  txValue = \case
    PrivateHashTX {} -> 0
    t -> transactionValue t
  txGasPrice = \case
    PrivateHashTX {} -> 0
    t -> transactionGasPrice t
  txGasLimit = \case
    PrivateHashTX {} -> 0
    t -> transactionGasLimit t
  txChainId = \case
    PrivateHashTX {} -> Nothing
    t -> transactionChainId t
  txMetadata = \case
    PrivateHashTX {} -> Nothing
    t -> transactionMetadata t

  txType MessageTX {} = Message
  txType ContractCreationTX {} = ContractCreation
  txType PrivateHashTX {} = PrivateHash

  txDestination MessageTX {..} = Just transactionTo
  txDestination ContractCreationTX {} = Nothing
  txDestination PrivateHashTX {} = Nothing

  txCode MessageTX {} = Nothing
  txCode ContractCreationTX {..} = Just transactionInit
  txCode PrivateHashTX {} = Nothing

  txData MessageTX {..} = Just transactionData
  txData ContractCreationTX {} = Nothing
  txData PrivateHashTX {} = Nothing

  morphTx t = case type' of
    Message -> MessageTX n gp gl dest val dat chainId r s v md
    ContractCreation -> ContractCreationTX n gp gl val code chainId r s v md
    PrivateHash -> PrivateHashTX (unsafeCreateKeccak256FromWord256 $ fromInteger r) (unsafeCreateKeccak256FromWord256 $ fromInteger s)
    where
      type' = txType t
      n = txNonce t
      gp = txGasPrice t
      gl = txGasLimit t
      val = txValue t
      dest = fromJust (txDestination t)
      dat = fromJust (txData t)
      code = fromJust (txCode t)
      (r, s, v) = txSignature t
      chainId = txChainId t
      md = txMetadata t

codePtrHash :: CodePtr -> Maybe Keccak256
codePtrHash (ExternallyOwned k) = Just k
codePtrHash (SolidVMCode _ k) = Just k
codePtrHash _ = Nothing

codePtrName :: CodePtr -> Maybe String
codePtrName (SolidVMCode n _) = Just n
codePtrName (CodeAtAccount _ n) = Just n
codePtrName _ = Nothing

codePtrAddress :: CodePtr -> Maybe Address
codePtrAddress (CodeAtAccount a _) = Just $ a ^. accountAddress
codePtrAddress _ = Nothing

codePtrChainId :: CodePtr -> Maybe Word256
codePtrChainId (CodeAtAccount a _) = a ^. accountChainId
codePtrChainId _ = Nothing

rawTX2TX :: RawTransaction -> Transaction
rawTX2TX (RawTransaction _ _ nonce' gp gl (Just to') val (Just dat) _ _ cid r s v md _ _ _) =
  MessageTX nonce' gp gl to' val dat (if (0 == cid) then Nothing else Just cid) r s v (M.fromList <$> md)
rawTX2TX (RawTransaction _ _ 0 0 0 Nothing 0 (Just init') _ _ 0 h ch 0 Nothing _ _ _)
  | init' == B.empty =
    PrivateHashTX (unsafeCreateKeccak256FromWord256 $ fromInteger h) (unsafeCreateKeccak256FromWord256 $ fromInteger ch)
rawTX2TX (RawTransaction _ _ nonce' gp gl Nothing val (Just init') _ _ cid r s v md _ _ _) =
  ContractCreationTX nonce' gp gl val (Code init') (if (0 == cid) then Nothing else Just cid) r s v (M.fromList <$> md)
rawTX2TX (RawTransaction _ _ nonce' gp gl Nothing val Nothing (Just contractName') (Just codePtrAddress') cid r s v md _ _ _) =
  ContractCreationTX nonce' gp gl val(PtrToCode $ CodeAtAccount (Account codePtrAddress' Nothing) contractName') (if (0 == cid) then Nothing else Just cid) r s v (M.fromList <$> md)
rawTX2TX rt = error $ "rawTX2TX: " ++ show rt

txAndTime2RawTX :: TXOrigin -> Transaction -> Integer -> UTCTime -> RawTransaction
txAndTime2RawTX origin tx blkNum time =
  case tx of
    (MessageTX nonce' gp gl to' val dat cid r s v md) ->
      RawTransaction time signer nonce' gp gl (Just to') val (Just dat) Nothing Nothing (fromMaybe 0 cid) r s v (M.toList <$> md) (fromIntegral blkNum) (txHash tx) origin
    (ContractCreationTX nonce' gp gl val( Code init') cid r s v md) ->
      RawTransaction time signer nonce' gp gl Nothing val (Just init') Nothing Nothing  (fromMaybe 0 cid) r s v (M.toList <$> md) (fromIntegral blkNum) (txHash tx) origin
    (ContractCreationTX nonce' gp gl val (PtrToCode init') cid r s v md) ->
      RawTransaction time signer nonce' gp gl Nothing val Nothing (codePtrName init') (codePtrAddress init')  (fromMaybe 0 cid) r s v (M.toList <$> md) (fromIntegral blkNum) (txHash tx) origin
    (PrivateHashTX h ch) ->
      RawTransaction time signer 0 0 0 Nothing 0 (Just B.empty) Nothing Nothing 0 (fromIntegral $ keccak256ToWord256 h) (fromIntegral $ keccak256ToWord256 ch) 0 Nothing (fromIntegral blkNum) (txHash tx) origin
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

createMessageTX :: Integer -> Integer -> Integer -> Address -> Integer -> B.ByteString -> Maybe (Map Text Text) -> EC.PrivateKey -> IO Transaction
createMessageTX n gp gl to' val theData md prvKey = createChainMessageTX n gp gl to' val theData Nothing md prvKey

-- so we can convert R and S from the signature, and add 27 to V, per
-- Ethereum protocol (and backwards compatibility)
getSigVals :: EC.Signature -> (Word256, Word256, Word8)
getSigVals (EC.Signature (SEC.CompactRecSig r s v)) =
  let convert = bytesToWord256 . BSS.fromShort
   in (convert r, convert s, v + 0x1b)

createChainMessageTX ::
  Integer ->
  Integer ->
  Integer ->
  Address ->
  Integer ->
  B.ByteString ->
  Maybe Word256 ->
  Maybe (Map Text Text) ->
  EC.PrivateKey ->
  IO Transaction
createChainMessageTX n gp gl to' val theData cid md prvKey = do
  let unsignedTX =
        MessageTX
          { transactionNonce = n,
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
  let theHash = partialTransactionHash unsignedTX

  let (r, s, v) = getSigVals $ EC.signMsg prvKey $ word256ToBytes $ keccak256ToWord256 theHash

  return $ case unsignedTX of
    MessageTX {} -> unsignedTX {transactionR = toInteger r, transactionS = toInteger s, transactionV = v}
    _ -> error "createChainMessageTX: PrivateHashTX not supported should be impossible"

createContractCreationTX :: Integer -> Integer -> Integer -> Integer -> Code -> Maybe (Map Text Text) -> EC.PrivateKey -> IO Transaction
createContractCreationTX n gp gl val init' md prvKey = createChainContractCreationTX n gp gl val init' Nothing md prvKey

createChainContractCreationTX ::
  Integer ->
  Integer ->
  Integer ->
  Integer ->
  Code ->
  Maybe Word256 ->
  Maybe (Map Text Text) ->
  EC.PrivateKey ->
  IO Transaction
createChainContractCreationTX n gp gl val init' cid md prvKey = do
  let unsignedTX =
        ContractCreationTX
          { transactionNonce = n,
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
whoSignedThisTransaction tx = case tx of
  PrivateHashTX {} -> Just (Address 0)
  t -> fromPublicKey <$> EC.recoverPub sig mesg
    where
      intToBSS = BSS.toShort . word256ToBytes . fromInteger
      sig = EC.Signature (SEC.CompactRecSig (intToBSS $ transactionR t) (intToBSS $ transactionS t) ((transactionV t) - 0x1b))
      mesg = keccak256ToByteString $ partialTransactionHash t

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
transactionHash = \case
  PrivateHashTX {..} -> transactionTxHash
  t -> hash . rlpSerialize $ rlpEncode t

partialTransactionHash :: Transaction -> Keccak256
partialTransactionHash = \case
  PrivateHashTX {..} -> transactionTxHash -- TODO: Should this be an error instead?
  t -> hash . rlpSerialize $ partialRLPEncode t
