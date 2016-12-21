{-# LANGUAGE DeriveGeneric, OverloadedStrings #-}

module Blockchain.Data.TransactionDef (
  Transaction(..),
  partialRLPEncode,
  partialRLPDecode
  ) where

import qualified Data.ByteString as B
import Data.Word
import Database.Persist.TH
import GHC.Generics

import Text.PrettyPrint.ANSI.Leijen

import qualified Blockchain.Colors as CL
import Blockchain.Data.Address
import Blockchain.Data.Code
import Blockchain.Data.RLP
import Blockchain.Format
import Blockchain.Util

derivePersistField "Transaction"

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



instance Format Transaction where
  format MessageTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionTo=to', transactionValue=v, transactionData=d} =
    CL.blue "Message Transaction" ++
    tab (
      "\n" ++
      "tNonce: " ++ show n ++ "\n" ++
      "gasPrice: " ++ show gp ++ "\n" ++
      "tGasLimit: " ++ show gl ++ "\n" ++
      "to: " ++ show (pretty to') ++ "\n" ++
      "value: " ++ show v ++ "\n" ++
      "tData: " ++ tab ("\n" ++ format d) ++ "\n")
  format ContractCreationTX{transactionNonce=n, transactionGasPrice=gp, transactionGasLimit=gl, transactionValue=v, transactionInit=theCode} =
    CL.blue "Contract Creation Transaction" ++
    tab (
      "\n" ++
      "tNonce: " ++ show n ++ "\n" ++
      "gasPrice: " ++ show gp ++ "\n" ++
      "tGasLimit: " ++ show gl ++ "\n" ++
      "value: " ++ show v ++ "\n" ++
      "tInit: " ++ tab (codeToString theCode) ++ "\n")
    where
      codeToString (Code init') = format init'
      codeToString (PrecompiledCode _) = "<precompiledCode>"
 
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
