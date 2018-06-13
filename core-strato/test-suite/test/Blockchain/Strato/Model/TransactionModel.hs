{-# OPTIONS  -fno-warn-orphans          #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}


module Blockchain.Strato.Model.TransactionModel where

import           Control.Monad.IO.Class
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Base16          as B16
import           Data.ByteString.Internal
import           Data.Maybe
import           Data.Word
import           GHC.Generics

import           Numeric

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.Util

import           Blockchain.Data.RLP
import           Blockchain.FastECRecover

import           Blockchain.ExtendedECDSA
import           Network.Haskoin.Internals       hiding (Address, txHash, txSignature)

import           Control.DeepSeq

import           Blockchain.Strato.Model.Class

instance NFData Address
instance NFData Code
instance NFData SHA
instance NFData Transaction

data Transaction =
  MessageTX {
    transactionNonce    ::  Integer,
    transactionGasPrice ::  Integer,
    transactionGasLimit ::  Integer,
    transactionTo       ::  Address,
    transactionValue    ::  Integer,
    transactionData     ::  B.ByteString,
    transactionChainId  ::  Maybe Word256,
    transactionR        ::  Integer,
    transactionS        ::  Integer,
    transactionV        ::  Word8
   } |
  ContractCreationTX {
    transactionNonce    ::  Integer,
    transactionGasPrice ::  Integer,
    transactionGasLimit ::  Integer,
    transactionValue    ::  Integer,
    transactionInit     ::  Code,
    transactionChainId  ::  Maybe Word256,
    transactionR        ::  Integer,
    transactionS        ::  Integer,
    transactionV        ::  Word8
    } |
  PrivateHashTX {
    transactionTxHash    ::  Word256,
    transactionChainHash ::  Word256
    } deriving (Show, Read, Eq, Ord, Generic)

instance RLPSerializable Transaction where
  rlpDecode (RLPArray [n, gp, gl, toAddr, val, i, vVal, rVal, sVal, cid]) =
    case partial of
      PrivateHashTX{..} -> error "rlpDecode Transaction: PrivateHashTX transactions can't have a chainId"
      p@MessageTX{} -> p {
        transactionV = fromInteger $ rlpDecode vVal,
        transactionR = rlpDecode rVal,
        transactionS = rlpDecode sVal,
        transactionChainId = Just $ rlpDecode cid
        }
      p@ContractCreationTX{} -> p {
        transactionV = fromInteger $ rlpDecode vVal,
        transactionR = rlpDecode rVal,
        transactionS = rlpDecode sVal,
        transactionChainId = Just $ rlpDecode cid
        }
    where
      partial = partialRLPDecode $ RLPArray [n, gp, gl, toAddr, val, i, RLPScalar 0, RLPScalar 0, RLPScalar 0]
  rlpDecode (RLPArray [n, gp, gl, toAddr, val, i, vVal, rVal, sVal]) =
    case partial of
      PrivateHashTX{..} -> PrivateHashTX (rlpDecode rVal) (rlpDecode sVal)
      p@MessageTX{} -> p {
        transactionV = fromInteger $ rlpDecode vVal,
        transactionR = rlpDecode rVal,
        transactionS = rlpDecode sVal,
        transactionChainId = Nothing
        }
      p@ContractCreationTX{} -> p {
        transactionV = fromInteger $ rlpDecode vVal,
        transactionR = rlpDecode rVal,
        transactionS = rlpDecode sVal,
        transactionChainId = Nothing
        }
    where
      partial = partialRLPDecode $ RLPArray [n, gp, gl, toAddr, val, i, RLPScalar 0, RLPScalar 0, RLPScalar 0]
  rlpDecode x = error ("rlp object has wrong format in call to rlpDecodeq: " ++ show x)

  rlpEncode t = case r of
      RLPArray [n, gp, gl, toAddr, val, i, cid] ->
        case t of
          PrivateHashTX{..} -> error "rlpEncode Transaction: PrivateHashTX transactions can't have a chainId"
          MessageTX{..} ->
            RLPArray [
              n, gp, gl, toAddr, val, i,
              rlpEncode $ toInteger transactionV,
              rlpEncode $ transactionR,
              rlpEncode $ transactionS,
              cid
              ]
          ContractCreationTX{..} ->
            RLPArray [
              n, gp, gl, toAddr, val, i,
              rlpEncode $ toInteger transactionV,
              rlpEncode $ transactionR,
              rlpEncode $ transactionS,
              cid
              ]
      RLPArray [n, gp, gl, toAddr, val, i] ->
        case t of
          PrivateHashTX{..} -> RLPArray [(rlpEncode transactionTxHash), (rlpEncode transactionChainHash)]
          MessageTX{..} ->
            RLPArray [
              n, gp, gl, toAddr, val, i,
              rlpEncode $ toInteger transactionV,
              rlpEncode $ transactionR,
              rlpEncode $ transactionS
              ]
          ContractCreationTX{..} ->
            RLPArray [
              n, gp, gl, toAddr, val, i,
              rlpEncode $ toInteger transactionV,
              rlpEncode $ transactionR,
              rlpEncode $ transactionS
              ]
      _ -> error "wow I really am stupid"
      where
        r = partialRLPEncode t


--partialRLP(De|En)code are used for the signing algorithm
partialRLPDecode  ::  RLPObject->Transaction
partialRLPDecode (RLPArray [RLPString "", RLPString "", RLPString "", RLPString "", RLPString "", RLPString "", _, _, _]) = -- empty strings and the number 0 rlpEncode to (RLPString "")
    PrivateHashTX {
      transactionTxHash = error "transactionTxHash not initialized in partialRLPDecode",
      transactionChainHash = error "transactionChainHash not initialized in partialRLPDecode"
      }
partialRLPDecode (RLPArray [n, gp, gl, RLPString "", val, i, _, _, _, _]) = --Note- Address 0 /= Address 000000....  Only Address 0 yields a ContractCreationTX
    ContractCreationTX {
      transactionNonce = rlpDecode n,
      transactionGasPrice = rlpDecode gp,
      transactionGasLimit = rlpDecode gl,
      transactionValue = rlpDecode val,
      transactionInit = rlpDecode i,
      transactionChainId = error "transactionChainId not initialized in partialRLPDecode",
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode"
      }
partialRLPDecode (RLPArray [n, gp, gl, RLPString "", val, i, _, _, _]) = --Note- Address 0 /= Address 000000....  Only Address 0 yields a ContractCreationTX
    ContractCreationTX {
      transactionNonce = rlpDecode n,
      transactionGasPrice = rlpDecode gp,
      transactionGasLimit = rlpDecode gl,
      transactionValue = rlpDecode val,
      transactionInit = rlpDecode i,
      transactionChainId = error "transactionChainId not initialized in partialRLPDecode",
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode"
      }
partialRLPDecode (RLPArray [n, gp, gl, toAddr, val, i, _, _, _, _]) =
    MessageTX {
      transactionNonce = rlpDecode n,
      transactionGasPrice = rlpDecode gp,
      transactionGasLimit = rlpDecode gl,
      transactionTo = rlpDecode toAddr,
      transactionValue = rlpDecode val,
      transactionData = rlpDecode i,
      transactionChainId = error "transactionChainId not initialized in partialRLPDecode",
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
      transactionChainId = error "transactionChainId not initialized in partialRLPDecode",
      transactionR = error "transactionR not initialized in partialRLPDecode",
      transactionS = error "transactionS not initialized in partialRLPDecode",
      transactionV = error "transactionV not initialized in partialRLPDecode"
      }
partialRLPDecode x = error ("rlp object has wrong format in call to partialRLPDecode: " ++ show x)

partialRLPEncode  ::  Transaction->RLPObject
partialRLPEncode MessageTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionTo=to', transactionValue=v, transactionData=d, transactionChainId=cid} =
      RLPArray $ [
        rlpEncode n,
        rlpEncode gp,
        rlpEncode gl,
        rlpEncode to',
        rlpEncode v,
        rlpEncode d
        ] ++ (maybeToList $ fmap rlpEncode cid)
partialRLPEncode ContractCreationTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionValue=v, transactionInit=init', transactionChainId=cid} =
      RLPArray $ [
        rlpEncode n,
        rlpEncode gp,
        rlpEncode gl,
        rlpEncode (0  ::  Integer),
        rlpEncode v,
        rlpEncode init'
        ] ++ (maybeToList $ fmap rlpEncode cid)
partialRLPEncode _ = RLPArray . map rlpEncode $ replicate 6 (0 :: Integer) -- PrivateHashTX

instance TransactionLike Transaction where
    txHash        = transactionHash
    txPartialHash = partialTransactionHash
    txSigner      = whoSignedThisTransaction
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

    txType MessageTX{}          = Message
    txType ContractCreationTX{} = ContractCreation
    txType PrivateHashTX{}      = PrivateHash

    txDestination MessageTX{..}        = Just transactionTo
    txDestination ContractCreationTX{} = Nothing
    txDestination PrivateHashTX{}      = Nothing

    txCode MessageTX{}            = Nothing
    txCode ContractCreationTX{..} = Just transactionInit
    txCode PrivateHashTX{}      = Nothing

    txData MessageTX{..}        = Just transactionData
    txData ContractCreationTX{} = Nothing
    txData PrivateHashTX{}      = Nothing

    morphTx t = case type' of
        Message          -> MessageTX n gp gl dest val dat cid r s v
        ContractCreation -> ContractCreationTX n gp gl val code cid r s v
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
              cid       = txChainId t

addLeadingZerosTo64  ::  String->String
addLeadingZerosTo64 x = replicate (64 - length x) '0' ++ x

createMessageTX  ::  MonadIO m=>Integer->Integer->Integer->Address->Integer->B.ByteString->PrvKey->SecretT m Transaction
createMessageTX n gp gl to' val theData prvKey = createChainMessageTX n gp gl to' val theData Nothing prvKey

createChainMessageTX :: MonadIO m
                     => Integer
                     -> Integer
                     -> Integer
                     -> Address
                     -> Integer
                     -> B.ByteString
                     -> Maybe Word256
                     -> PrvKey
                     -> SecretT m Transaction
createChainMessageTX n gp gl to' val theData chainId prvKey = do
  let unsignedTX = MessageTX {
                     transactionNonce = n,
                     transactionGasPrice = gp,
                     transactionGasLimit = gl,
                     transactionTo = to',
                     transactionValue = val,
                     transactionData = theData,
                     transactionChainId = chainId,
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
          _          -> error ("error: sigR is: " ++ showHex (sigR signature) ""),
      transactionS =
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigS signature) "" of
          (val', "") -> byteString2Integer val'
          _          -> error ("error: sigS is: " ++ showHex (sigS signature) ""),
      transactionV = if yIsOdd then 0x1c else 0x1b
    }

createContractCreationTX  ::  MonadIO m=>Integer->Integer->Integer->Integer->Code->PrvKey->SecretT m Transaction
createContractCreationTX n gp gl val init' prvKey = createChainContractCreationTX n gp gl val init' Nothing prvKey

createChainContractCreationTX :: MonadIO m
                              => Integer
                              -> Integer
                              -> Integer
                              -> Integer
                              -> Code
                              -> Maybe Word256
                              -> PrvKey
                              -> SecretT m Transaction
createChainContractCreationTX n gp gl val init' chainId prvKey = do
  let unsignedTX = ContractCreationTX {
                     transactionNonce = n,
                     transactionGasPrice = gp,
                     transactionGasLimit = gl,
                     transactionValue = val,
                     transactionInit = init',
                     transactionChainId = chainId,
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
          _          -> error ("error: sigR is: " ++ showHex (sigR signature) ""),
      transactionS =
        case B16.decode $ B.pack $ map c2w $ addLeadingZerosTo64 $ showHex (sigS signature) "" of
          (val', "") -> byteString2Integer val'
          _          -> error ("error: sigS is: " ++ showHex (sigS signature) ""),
      transactionV = if yIsOdd then 0x1c else 0x1b
    }

whoSignedThisTransaction  ::  Transaction->Maybe Address -- Signatures can be malformed, hence the Maybe
whoSignedThisTransaction tx = case tx of
  PrivateHashTX{} -> Just (Address (-1))
  t -> pubKey2Address <$> getPubKeyFromSignature' xSignature theHash
    where
      xSignature = ExtendedSignature (Signature (fromInteger $ transactionR t) (fromInteger $ transactionS t)) (0x1c == transactionV t)
      SHA theHash = partialTransactionHash t
      getPubKeyFromSignature' = getPubKeyFromSignature_fast

isMessageTX  ::  Transaction->Bool
isMessageTX MessageTX{} = True
isMessageTX _           = False

isContractCreationTX  ::  Transaction->Bool
isContractCreationTX ContractCreationTX{} = True
isContractCreationTX _                    = False

transactionHash  ::  Transaction->SHA
transactionHash = \case
                     PrivateHashTX{..} -> SHA transactionTxHash
                     t -> superProprietaryStratoSHAHash . rlpSerialize $ rlpEncode t

partialTransactionHash  ::  Transaction->SHA
partialTransactionHash = \case
                            PrivateHashTX{..} -> SHA transactionTxHash
                            t -> superProprietaryStratoSHAHash . rlpSerialize $ partialRLPEncode t


