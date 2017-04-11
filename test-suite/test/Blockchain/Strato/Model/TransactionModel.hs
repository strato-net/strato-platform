{-# OPTIONS  -fno-warn-orphans          #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE OverloadedStrings #-}


module Blockchain.Strato.Model.TransactionModel where

import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.ByteString.Internal
import Data.Maybe
import Data.Word
import GHC.Generics

import Numeric

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.Util

import Blockchain.Data.RLP
import Blockchain.FastECRecover

import Network.Haskoin.Internals hiding (Address, txSignature, txHash)
import Blockchain.ExtendedECDSA

import Control.DeepSeq

import Blockchain.Strato.Model.Class

instance NFData Address
instance NFData Code
instance NFData SHA
instance NFData Transaction

data Transaction = 
  MessageTX {
    transactionNonce::Integer,
    transactionGasPrice::Integer,
    transactionGasLimit::Integer,
    transactionTo::Address,
    transactionValue::Integer,
    transactionData::B.ByteString,
    transactionR::Integer,
    transactionS::Integer,
    transactionV::Word8
   } |
  ContractCreationTX {
    transactionNonce::Integer,
    transactionGasPrice::Integer,
    transactionGasLimit::Integer,
    transactionValue::Integer,
    transactionInit::Code,
    transactionR::Integer,
    transactionS::Integer,
    transactionV::Word8
    } deriving (Show, Read, Eq, Ord, Generic)

instance RLPSerializable Transaction where
  rlpDecode (RLPArray [n, gp, gl, toAddr, val, i, vVal, rVal, sVal]) =
    partial {
      transactionV = fromInteger $ rlpDecode vVal,
      transactionR = rlpDecode rVal,
      transactionS = rlpDecode sVal
      }
        where
          partial = partialRLPDecode $ RLPArray [n, gp, gl, toAddr, val, i, RLPScalar 0, RLPScalar 0, RLPScalar 0]
  rlpDecode x = error ("rlp object has wrong format in call to rlpDecodeq: " ++ show x)

  rlpEncode t =
      RLPArray [
        n, gp, gl, toAddr, val, i,
        rlpEncode $ toInteger $ transactionV t,
        rlpEncode $ transactionR t,
        rlpEncode $ transactionS t
        ]
      where
        (RLPArray [n, gp, gl, toAddr, val, i]) = partialRLPEncode t


--partialRLP(De|En)code are used for the signing algorithm
partialRLPDecode::RLPObject->Transaction
partialRLPDecode (RLPArray [n, gp, gl, RLPString "", val, i, _, _, _]) = --Note- Address 0 /= Address 000000....  Only Address 0 yields a ContractCreationTX
    ContractCreationTX {
      transactionNonce = rlpDecode n,
      transactionGasPrice = rlpDecode gp,
      transactionGasLimit = rlpDecode gl,
      transactionValue = rlpDecode val,
      transactionInit = rlpDecode i,
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode"
      }
partialRLPDecode (RLPArray [n, gp, gl, toAddr, val, i, _, _, _]) =
    MessageTX {
      transactionNonce = rlpDecode n,
      transactionGasPrice = rlpDecode gp,
      transactionGasLimit = rlpDecode gl,
      transactionTo = rlpDecode toAddr,
      transactionValue = rlpDecode val,
      transactionData = rlpDecode i,
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode"
      }
partialRLPDecode x = error ("rlp object has wrong format in call to partialRLPDecode: " ++ show x)

partialRLPEncode::Transaction->RLPObject
partialRLPEncode MessageTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionTo=to', transactionValue=v, transactionData=d} =
      RLPArray [
        rlpEncode n,
        rlpEncode gp,
        rlpEncode gl,
        rlpEncode to',
        rlpEncode v,
        rlpEncode d
        ]
partialRLPEncode ContractCreationTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionValue=v, transactionInit=init'} =
      RLPArray [
        rlpEncode n,
        rlpEncode gp,
        rlpEncode gl,
        rlpEncode (0::Integer),
        rlpEncode v,
        rlpEncode init'
        ]

instance TransactionLike Transaction where
    txHash        = transactionHash 
    txPartialHash = partialTransactionHash 
    txSigner      = whoSignedThisTransaction
    txNonce       = transactionNonce
    txSignature t = (transactionR t, transactionS t, transactionV t)
    txValue       = transactionValue
    txGasPrice    = transactionGasPrice
    txGasLimit    = transactionGasLimit

    txType MessageTX{}          = Message
    txType ContractCreationTX{} = ContractCreation

    txDestination MessageTX{..}        = Just transactionTo
    txDestination ContractCreationTX{} = Nothing

    txCode MessageTX{}            = Nothing
    txCode ContractCreationTX{..} = Just transactionInit

    txData MessageTX{..}        = Just transactionData
    txData ContractCreationTX{} = Nothing

    morphTx t = case type' of
        Message          -> MessageTX n gp gl dest val dat r s v
        ContractCreation -> ContractCreationTX n gp gl val code r s v
        where type'     = txType t
              n         = txNonce t
              gp        = txGasPrice t
              gl        = txGasLimit t
              val       = txValue t
              dest      = fromJust (txDestination t)
              dat       = fromJust (txData t)
              code      = fromJust (txCode t)
              (r, s, v) = txSignature t

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

whoSignedThisTransaction::Transaction->Maybe Address -- Signatures can be malformed, hence the Maybe
whoSignedThisTransaction t = pubKey2Address <$> getPubKeyFromSignature' xSignature theHash
        where
          xSignature = ExtendedSignature (Signature (fromInteger $ transactionR t) (fromInteger $ transactionS t)) (0x1c == transactionV t)
          SHA theHash = partialTransactionHash t
          getPubKeyFromSignature' = getPubKeyFromSignature_fast 

isMessageTX::Transaction->Bool
isMessageTX MessageTX{} = True
isMessageTX _ = False

isContractCreationTX::Transaction->Bool
isContractCreationTX ContractCreationTX{} = True
isContractCreationTX _ = False

transactionHash::Transaction->SHA
transactionHash = superProprietaryStratoSHAHash . rlpSerialize . rlpEncode

partialTransactionHash::Transaction->SHA
partialTransactionHash = superProprietaryStratoSHAHash . rlpSerialize . partialRLPEncode


