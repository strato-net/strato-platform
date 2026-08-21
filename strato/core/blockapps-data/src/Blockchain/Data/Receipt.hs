{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

-- | Canonical, on-chain receipt structure for STRATO blocks.
--
-- The Phase 0 spec for proof-based bridge withdrawals
-- (proof-based-withdrawals-phase0.md, §6) defines the receipts trie that gets
-- committed to in @BlockHeaderV2.receiptsRoot@. Each leaf is a 'Receipt' for
-- a transaction, RLP-encoded and keyed by @rlp(txIndex)@.
--
-- The Receipt structure is intentionally smaller than Ethereum's: there is no
-- @logsBloom@ (the bridge does not use bloom filters), and 'ReceiptLog' uses
-- the SolidVM event shape @(contractAddress, eventName, [TypedArg])@ instead
-- of EVM's @(address, topics, data)@.
module Blockchain.Data.Receipt
  ( Receipt (..),
    ReceiptStatus (..),
    ReceiptLog (..),
    statusInteger,
    statusFromInteger,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Control.DeepSeq (NFData)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import GHC.Generics (Generic)
import SolidVM.Model.TypedArg (TypedArg)

data ReceiptStatus
  = ReceiptSuccess
  | ReceiptFailure
  deriving (Eq, Show, Generic, NFData)

statusInteger :: ReceiptStatus -> Integer
statusInteger ReceiptSuccess = 1
statusInteger ReceiptFailure = 0

statusFromInteger :: Integer -> ReceiptStatus
statusFromInteger 0 = ReceiptFailure
statusFromInteger _ = ReceiptSuccess

instance RLPSerializable ReceiptStatus where
  rlpEncode = rlpEncode . statusInteger
  rlpDecode = statusFromInteger . rlpDecode

data ReceiptLog = ReceiptLog
  { rlogContractAddress :: Address,
    rlogEventName :: String,
    rlogArgs :: [TypedArg]
  }
  deriving (Eq, Show, Generic, NFData)

instance RLPSerializable ReceiptLog where
  rlpEncode (ReceiptLog addr name args) =
    RLPArray
      [ rlpEncode addr,
        rlpEncode (encodeUtf8 (T.pack name)),
        RLPArray (map rlpEncode args)
      ]
  rlpDecode (RLPArray [a, n, RLPArray as]) =
    ReceiptLog
      (rlpDecode a)
      (T.unpack . decodeUtf8 . rlpDecode $ n)
      (map rlpDecode as)
  rlpDecode x = error $ "rlpDecode ReceiptLog: bad RLP shape: " ++ show x

data Receipt = Receipt
  { receiptStatus :: ReceiptStatus,
    receiptGasUsed :: Integer,
    receiptLogs :: [ReceiptLog]
  }
  deriving (Eq, Show, Generic, NFData)

instance RLPSerializable Receipt where
  rlpEncode (Receipt s g logs) =
    RLPArray
      [ rlpEncode s,
        rlpEncode g,
        RLPArray (map rlpEncode logs)
      ]
  rlpDecode (RLPArray [s, g, RLPArray ls]) =
    Receipt (rlpDecode s) (rlpDecode g) (map rlpDecode ls)
  rlpDecode x = error $ "rlpDecode Receipt: bad RLP shape: " ++ show x
