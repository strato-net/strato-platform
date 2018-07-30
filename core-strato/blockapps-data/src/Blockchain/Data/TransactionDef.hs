{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}

module Blockchain.Data.TransactionDef (
  Transaction(..),
  partialRLPEncode,
  partialRLPDecode
  ) where

import           Data.Binary
import qualified Data.ByteString              as B
import           Data.Maybe                   (maybeToList)
import           Database.Persist.TH
import           GHC.Generics

import           Text.PrettyPrint.ANSI.Leijen hiding ((<$>))

import qualified Blockchain.Colors            as CL
import           Blockchain.Data.Address
import           Blockchain.Data.Code
import           Blockchain.Data.RLP
import           Blockchain.Format
import           Blockchain.SHA
import           Blockchain.Util
import           Blockchain.Strato.Model.ExtendedWord (Word256)

derivePersistField "Transaction"

data Transaction =
  MessageTX {
    transactionNonce    :: Integer,
    transactionGasPrice :: Integer,
    transactionGasLimit :: Integer,
    transactionTo       :: Address,
    transactionValue    :: Integer,
    transactionData     :: B.ByteString,
    transactionChainId  :: Maybe Word256,
    transactionR        :: Integer,
    transactionS        :: Integer,
    transactionV        :: Word8
   } |
  ContractCreationTX {
    transactionNonce    :: Integer,
    transactionGasPrice :: Integer,
    transactionGasLimit :: Integer,
    transactionValue    :: Integer,
    transactionInit     :: Code,
    transactionChainId  :: Maybe Word256,
    transactionR        :: Integer,
    transactionS        :: Integer,
    transactionV        :: Word8
    } |
  PrivateHashTX {
    transactionTxHash    :: Word256,
    transactionChainHash :: Word256
    } deriving (Show, Read, Eq, Ord, Generic)

instance Binary Transaction where
  put = put . rlpSerialize . rlpEncode
  get = (rlpDecode . rlpDeserialize) <$> get

instance Format Transaction where
  format PrivateHashTX{transactionTxHash=h, transactionChainHash=ch} =
    CL.blue "Private Transaction Hash" ++
    tab (
      "\n" ++
      "Transaction Hash:       " ++ show h ++ "\n" ++
      "Transaction Chain Hash: " ++ show ch ++ "\n")
  format t@MessageTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionTo=to', transactionValue=v, transactionData=d, transactionChainId=cid} =
    CL.blue "Message Transaction" ++
    tab (
      "\n" ++
      "tNonce: " ++ show n ++ "\n" ++
      "gasPrice: " ++ show gp ++ "\n" ++
      "tGasLimit: " ++ show gl ++ "\n" ++
      "to: " ++ show (pretty to') ++ "\n" ++
      "value: " ++ show v ++ "\n" ++
      "tData: " ++ ("\n" ++ format d) ++ "\n" ++
      "chainId: " ++ show cid ++ "\n" ++
      "hash: " ++ format (hash . rlpSerialize . rlpEncode $ t) ++ "\n")
  format t@ContractCreationTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionValue=v, transactionInit=theCode, transactionChainId=cid} =
    CL.blue "Contract Creation Transaction" ++
    tab (
      "\n" ++
      "tNonce: " ++ show n ++ "\n" ++
      "gasPrice: " ++ show gp ++ "\n" ++
      "tGasLimit: " ++ show gl ++ "\n" ++
      "value: " ++ show v ++ "\n" ++
      "tInit: " ++ codeToString theCode ++ "\n" ++
      "chainId: " ++ show cid ++ "\n" ++
      "hash: " ++ format (hash . rlpSerialize . rlpEncode $ t) ++ "\n")
    where
      codeToString (Code init')        = format init'
      codeToString (PrecompiledCode _) = "<precompiledCode>"

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
          PrivateHashTX{..} ->
            RLPArray [
             n, gp, gl, toAddr, val, i,
             RLPString "",
             (rlpEncode transactionTxHash),
             (rlpEncode transactionChainHash)
             ]
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
partialRLPDecode :: RLPObject->Transaction
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

partialRLPEncode :: Transaction->RLPObject
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
        rlpEncode (0 :: Integer),
        rlpEncode v,
        rlpEncode init'
        ] ++ (maybeToList $ fmap rlpEncode cid)
partialRLPEncode _ = RLPArray . map rlpEncode $ replicate 6 (0 :: Integer) -- PrivateHashTX
