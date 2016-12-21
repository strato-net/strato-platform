{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances           #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE DeriveGeneric              #-}


module Blockchain.Data.Transaction (
{-  Transaction(transactionNonce,
              transactionGasPrice,
              transactionGasLimit,
              transactionTo,
              transactionValue,
              transactionData,
              transactionInit), -}
  Transaction(..),
  txAndTime2RawTX,
  tx2RawTXAndTime,
  rawTX2TX,
  insertTXIfNew,
  insertTXIfNew',
  createMessageTX,
  createContractCreationTX,
  isMessageTX,
  isContractCreationTX,
  whoSignedThisTransaction,
  transactionHash,
  partialTransactionHash
  ) where

import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.ByteString.Internal
import Data.Maybe
import Data.Time.Clock
import qualified Database.Persist.Postgresql as SQL
import Numeric

import Blockchain.Data.Address
import Blockchain.Data.Code
import Blockchain.Data.DataDefs
import Blockchain.Data.RawTransaction
import Blockchain.Data.RLP
import Blockchain.Data.TransactionDef
import Blockchain.Data.TXOrigin
import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Blockchain.FastECRecover
import Blockchain.SHA
import Blockchain.Util

--import Debug.Trace

import Network.Haskoin.Internals hiding (Address)
import Blockchain.ExtendedECDSA

import Control.DeepSeq
import System.Clock

instance NFData Address
instance NFData Code
instance NFData SHA
instance NFData TXOrigin
instance NFData Transaction
instance NFData RawTransaction


rawTX2TX :: RawTransaction -> Transaction
rawTX2TX (RawTransaction _ _ nonce' gp gl (Just to') val dat r s v _ _ _) = (MessageTX nonce' gp gl to' val dat r s v)
rawTX2TX (RawTransaction _ _ nonce' gp gl Nothing val init' r s v _ _ _) = (ContractCreationTX nonce' gp gl val (Code init') r s v)

txAndTime2RawTX :: TXOrigin -> Transaction -> Integer -> UTCTime -> RawTransaction
txAndTime2RawTX origin tx blkNum time =
  case tx of
    (MessageTX nonce' gp gl to' val dat r s v) -> (RawTransaction time signer nonce' gp gl (Just to') val dat r s v (fromIntegral $ blkNum) (hash $ rlpSerialize $ rlpEncode tx) origin)
    (ContractCreationTX _ _ _ _ (PrecompiledCode _) _ _ _) -> error "Error in call to txAndTime2RawTX: You can't convert a transaction to a raw transaction if the code is a precompiled contract"
    (ContractCreationTX nonce' gp gl val (Code init') r s v) ->  (RawTransaction time signer nonce' gp gl Nothing val init' r s v (fromIntegral $ blkNum) (hash $ rlpSerialize $ rlpEncode tx) origin)
  where
    signer = fromMaybe (Address (-1)) $ whoSignedThisTransaction tx

tx2RawTXAndTime :: (MonadIO m) => TXOrigin -> Transaction -> m RawTransaction
tx2RawTXAndTime origin tx = do
  time <- liftIO getCurrentTime
  return $ txAndTime2RawTX origin tx (-1) time

insertTXIfNew::HasSQLDB m=>TXOrigin->Maybe Integer->[Transaction]->m Integer
insertTXIfNew origin blockNum txs = do
  time <- liftIO getCurrentTime
  beforeECRecover <- liftIO $ getTime Realtime
  let rawTXs =
        map (\tx -> txAndTime2RawTX origin tx (fromMaybe (-1) blockNum) time) txs
  afterECRecover <- rawTXs `deepseq` (liftIO $ getTime Realtime)
  insertRawTXIfNew $ map id rawTXs
  return $ timeSpecAsNanoSecs $ afterECRecover - beforeECRecover

insertTXIfNew'::(MonadBaseControl IO m, MonadIO m)=>
                TXOrigin->Maybe Integer->[Transaction]->ReaderT SQL.SqlBackend m ()
insertTXIfNew' origin blockNum txs = do
  time <- liftIO getCurrentTime
  let rawTXs =
        map (\tx -> txAndTime2RawTX origin tx (fromMaybe (-1) blockNum) time) txs
  insertRawTXIfNew' $ map id rawTXs

addLeadingZerosTo64::String->String
addLeadingZerosTo64 x = replicate (64 - length x) '0' ++ x

createMessageTX::MonadIO m=>Integer->Integer->Integer->Address->Integer->B.ByteString->PrvKey->SecretT m Transaction
createMessageTX n gp gl to' val theData prvKey = do
  let unsignedTX = MessageTX {
                     transactionNonce = n,
                     transactionGasPrice = gp,
                     transactionGasLimit = gl,
                     transactionTo = to',
                     transactionValue = val,
                     transactionData = theData,
                     transactionR = 0,
                     transactionS = 0,
                     transactionV = 0
                   }
  let SHA theHash = partialTransactionHash unsignedTX
  ExtendedSignature signature yIsOdd <- extSignMsg theHash prvKey
  return 
    unsignedTX {
      transactionR = 
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigR signature) "" of
          (val', "") -> byteString2Integer val'
          _ -> error ("error: sigR is: " ++ showHex (sigR signature) ""),
      transactionS = 
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigS signature) "" of
          (val', "") -> byteString2Integer val'
          _ -> error ("error: sigS is: " ++ showHex (sigS signature) ""),
      transactionV = if yIsOdd then 0x1c else 0x1b
    }

createContractCreationTX::MonadIO m=>Integer->Integer->Integer->Integer->Code->PrvKey->SecretT m Transaction
createContractCreationTX n gp gl val init' prvKey = do
  let unsignedTX = ContractCreationTX {
                     transactionNonce = n,
                     transactionGasPrice = gp,
                     transactionGasLimit = gl,
                     transactionValue = val,
                     transactionInit = init',
                     transactionR = 0,
                     transactionS = 0,
                     transactionV = 0
                   }

  let SHA theHash = partialTransactionHash unsignedTX
  ExtendedSignature signature yIsOdd <- extSignMsg theHash prvKey
  return 
    unsignedTX {
      transactionR = 
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigR signature) "" of
          (val', "") -> byteString2Integer val'
          _ -> error ("error: sigR is: " ++ showHex (sigR signature) ""),
      transactionS = 
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigS signature) "" of
          (val', "") -> byteString2Integer val'
          _ -> error ("error: sigS is: " ++ showHex (sigS signature) ""),
      transactionV = if yIsOdd then 0x1c else 0x1b
    }


{-
  Switch to Either?
-}
whoSignedThisTransaction::Transaction->Maybe Address -- Signatures can be malformed, hence the Maybe
whoSignedThisTransaction t = 
    fmap pubKey2Address $ getPubKeyFromSignature' xSignature theHash
        where
          xSignature = ExtendedSignature (Signature (fromInteger $ transactionR t) (fromInteger $ transactionS t)) (0x1c == transactionV t)
          SHA theHash = partialTransactionHash t
          getPubKeyFromSignature' = if (fastECRecover $ generalConfig ethConf)
                                    then getPubKeyFromSignature_fast
                                    else getPubKeyFromSignature

isMessageTX::Transaction->Bool
isMessageTX MessageTX{} = True
isMessageTX _ = False

isContractCreationTX::Transaction->Bool
isContractCreationTX ContractCreationTX{} = True
isContractCreationTX _ = False


transactionHash::Transaction->SHA
transactionHash = hash . rlpSerialize . rlpEncode

partialTransactionHash::Transaction->SHA
partialTransactionHash = hash . rlpSerialize . partialRLPEncode
