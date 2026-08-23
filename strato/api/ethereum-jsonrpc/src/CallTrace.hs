{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | Minimal @callTracer@-style output for @debug_traceBlockByHash@.
--
-- STRATO runs SolidVM (a Solidity source interpreter), not the EVM, so there is
-- no opcode-level execution to report and the geth @structLogs@ tracer cannot be
-- produced. This module builds the @callTracer@ frame instead, which carries the
-- data an attribution indexer actually needs: the transaction @input@ (calldata,
-- including any trailing ERC-8021 builder-code suffix). Nested internal calls are
-- not instrumented, so @calls@ is always empty.
module CallTrace
  ( CallFrame(..)
  , BlockTrace(..)
  , mkCallFrame
  ) where

import Blockchain.Data.DataDefs (TransactionResult(..))
import Blockchain.Data.Transaction (Transaction, isContractCreationTX, whoSignedThisTransaction)
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex)
import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Numeric (showHex)

-- | One entry of a @debug_traceBlockByHash@ result: geth wraps each
-- transaction's trace as @{ "txHash": ..., "result": <frame> }@.
data BlockTrace = BlockTrace
  { btTxHash :: Keccak256
  , btResult :: CallFrame
  }

instance ToJSON BlockTrace where
  toJSON BlockTrace {..} =
    object
      [ "txHash" .= ("0x" ++ keccak256ToHex btTxHash)
      , "result" .= btResult
      ]

-- | A single @callTracer@ frame.
data CallFrame = CallFrame
  { cfType    :: String
  , cfFrom    :: Maybe Address
  , cfTo      :: Maybe Address
  , cfValue   :: Integer
  , cfGas     :: Integer
  , cfGasUsed :: Integer
  , cfInput   :: B.ByteString
  , cfOutput  :: B.ByteString
  , cfCalls   :: [CallFrame]
  }

hexQuantity :: Integer -> Value
hexQuantity n = toJSON $ "0x" ++ showHex n ""

hexData :: B.ByteString -> Value
hexData bs = toJSON $ "0x" ++ BC.unpack (B16.encode bs)

hexAddress :: Address -> Value
hexAddress a = toJSON $ "0x" ++ show a

instance ToJSON CallFrame where
  toJSON CallFrame {..} =
    object $
      [ "type"    .= cfType
      , "from"    .= maybe Null hexAddress cfFrom
      , "value"   .= hexQuantity cfValue
      , "gas"     .= hexQuantity cfGas
      , "gasUsed" .= hexQuantity cfGasUsed
      , "input"   .= hexData cfInput
      , "output"  .= hexData cfOutput
      , "calls"   .= cfCalls
      ]
        ++ maybe [] (\a -> ["to" .= hexAddress a]) cfTo

-- | Build a top-level call frame from a transaction and its result. @output@ is
-- left empty and @calls@ empty (internal calls are not instrumented).
mkCallFrame :: TransactionResult -> Transaction -> CallFrame
mkCallFrame tr tx =
  CallFrame
    { cfType    = if isContractCreationTX tx then "CREATE" else "CALL"
    , cfFrom    = whoSignedThisTransaction tx
    , cfTo      = frameTo
    , cfValue   = txVal
    , cfGas     = toInteger $ TX.gasLimit tx
    , cfGasUsed = toInteger $ transactionResultGasUsed tr
    , cfInput   = txInput
    , cfOutput  = B.empty
    , cfCalls   = []
    }
  where
    frameTo = case txDest of
      Just d  -> Just d
      Nothing -> case transactionResultContractsCreated tr of
        (a : _) -> Just a
        []      -> Nothing

    -- For MessageTX there is no EVM calldata, so @input@ carries just the
    -- attribution suffix (e.g. an ERC-8021 data suffix ending in the marker),
    -- which is exactly what an attribution parser reads from the end.
    (txDest, txVal, txInput) = case tx of
      TX.EthereumTX {TX.ethTo = mTo, TX.value = v, TX.txData = d} -> (mTo, v, d)
      TX.MessageTX {TX.to = addr, TX.attribution = attr} -> (Just addr, 0, attr)
      TX.ContractCreationTX {} -> (Nothing, 0, B.empty)
