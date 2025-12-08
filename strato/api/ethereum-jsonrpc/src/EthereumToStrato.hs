{-# LANGUAGE OverloadedStrings #-}

module EthereumToStrato
  ( ethereumToStratoTransaction,
  )
where

import Blockchain.Data.TransactionDef
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import EthereumTransaction
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T

ethereumToStratoTransaction :: EthereumTransaction -> Either String Transaction
ethereumToStratoTransaction tx =
  case (ethTo tx, B.null $ ethData tx) of
    (Nothing, False) -> handleContractCreation tx
    (Just toAddr, True) -> handleSimpleTransfer tx toAddr
    (Just toAddr, False) -> handleFunctionCall tx toAddr
    (Nothing, True) -> Left "Invalid transaction: no recipient and no data"

handleContractCreation :: EthereumTransaction -> Either String Transaction
handleContractCreation tx =
  let code = Code $ T.pack $ BC.unpack $ B16.encode $ ethData tx
      contractName = "Contract" -- Default name, could be extracted from code
      network = "mercata" -- Default network, could be configurable
      v = ethV tx :: Integer
      -- Convert Ethereum V to Strato V (recovery ID + 27)
      -- Legacy: V is 27 or 28, Strato V = V (already has 27 added)
      -- EIP-155: V is chainId*2 + 35 or chainId*2 + 36, recovery ID = (V - 35) mod 2, Strato V = recovery ID + 27
      stratoV = if v >= 35 then fromInteger ((v - 35) `mod` 2 + 27) else fromInteger v
   in Right $
        ContractCreationTX
          { transactionNonce = ethNonce tx,
            transactionGasLimit = ethGasLimit tx,
            transactionContractName = T.pack contractName,
            transactionArgs = [],
            transactionNetwork = T.pack network,
            transactionCode = code,
            transactionR = ethR tx,
            transactionS = ethS tx,
            transactionV = stratoV
          }

handleSimpleTransfer :: EthereumTransaction -> Address -> Either String Transaction
handleSimpleTransfer tx toAddr =
  let network = "mercata"
      funcName = "transfer"
      args = []
      v = ethV tx :: Integer
      -- Convert Ethereum V to Strato V (recovery ID + 27)
      -- Legacy: V is 27 or 28, Strato V = V (already has 27 added)
      -- EIP-155: V is chainId*2 + 35 or chainId*2 + 36, recovery ID = (V - 35) mod 2, Strato V = recovery ID + 27
      stratoV = if v >= 35 then fromInteger ((v - 35) `mod` 2 + 27) else fromInteger v
   in Right $
        MessageTX
          { transactionNonce = ethNonce tx,
            transactionGasLimit = ethGasLimit tx,
            transactionTo = toAddr,
            transactionFuncName = funcName,
            transactionArgs = args,
            transactionNetwork = T.pack network,
            transactionR = ethR tx,
            transactionS = ethS tx,
            transactionV = stratoV
          }

handleFunctionCall :: EthereumTransaction -> Address -> Either String Transaction
handleFunctionCall tx toAddr =
  let dataBytes = ethData tx
      network = "mercata"
      -- For now, use a generic function name and pass data as hex-encoded argument
      -- Future enhancement: parse function selector and ABI-encoded args
      funcName = "call"
      dataHex = T.pack $ BC.unpack $ B16.encode dataBytes
      args = [dataHex]
      v = ethV tx :: Integer
      -- Convert Ethereum V to Strato V (recovery ID + 27)
      -- Legacy: V is 27 or 28, Strato V = V (already has 27 added)
      -- EIP-155: V is chainId*2 + 35 or chainId*2 + 36, recovery ID = (V - 35) mod 2, Strato V = recovery ID + 27
      stratoV = if v >= 35 then fromInteger ((v - 35) `mod` 2 + 27) else fromInteger v
   in Right $
        MessageTX
          { transactionNonce = ethNonce tx,
            transactionGasLimit = ethGasLimit tx,
            transactionTo = toAddr,
            transactionFuncName = funcName,
            transactionArgs = args,
            transactionNetwork = T.pack network,
            transactionR = ethR tx,
            transactionS = ethS tx,
            transactionV = stratoV
          }

