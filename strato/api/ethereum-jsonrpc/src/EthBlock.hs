{-# LANGUAGE OverloadedStrings #-}

-- | Ethereum-shaped serialization for a STRATO 'Block'.
--
-- STRATO's internal 'Block'' serializes to STRATO REST JSON (@blockHash@,
-- nested @blockData@), which Ethereum clients (e.g. the alloy Rust crate)
-- reject because it lacks the top-level @hash@ and flat header fields they
-- expect. Following the codebase convention (a wrapper around the domain type
-- with a different serialization instance, like 'Block'' / 'Transaction''),
-- 'EthBlock' wraps a 'Block' and renders the Ethereum @eth_getBlockBy*@ shape.
--
-- The two constructors model the two Ethereum block representations selected by
-- the @fullTransactions@ request flag: @transactions@ as a list of hashes, or
-- as a list of full transaction objects.
module EthBlock
  ( EthBlock(..)
  ) where

import Blockchain.Data.Block (Block(..))
import Blockchain.Data.RLP (rlpEncode, rlpSerialize)
import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as EthConf
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256 (Keccak256, keccak256ToHex)
import Data.Aeson (ToJSON(..), Value, object, (.=))
import Data.Aeson.Types (Pair)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import Data.Word (Word64)
import Numeric (showHex)

data EthBlock
  = EthBlockWithTxHashes B.ByteString Block  -- ^ @transactions@ rendered as tx hashes (@fullTransactions = false@)
  | EthBlockWithFullTxs  B.ByteString Block  -- ^ @transactions@ rendered as full tx objects (@fullTransactions = true@)
  -- ^ The 'B.ByteString' is the resolved 256-byte @logsBloom@ (stored value when
  -- real, otherwise a null bloom); see 'Commands.blockBloom'.

instance ToJSON EthBlock where
  toJSON (EthBlockWithTxHashes bloom blk@(Block _ txs _)) =
    object $ headerPairs bloom blk ++ [ "transactions" .= map (hexHash . txHash) txs ]
  toJSON (EthBlockWithFullTxs bloom blk@(Block bd txs _)) =
    object $ headerPairs bloom blk ++
      [ "transactions" .=
          zipWith (txToEthValue (blockHeaderHash bd) (blockHeaderBlockNumber bd)) [0 ..] txs
      ]

-- | Shared Ethereum block header fields, identical for both representations.
headerPairs :: B.ByteString -> Block -> [Pair]
headerPairs bloom blk@(Block bd _ uncles) =
  [ "number"           .= hexQuantity (blockHeaderBlockNumber bd)
  , "hash"             .= hexHash (blockHeaderHash bd)
  , "parentHash"       .= hexHash (blockHeaderParentHash bd)
  , "nonce"            .= hexNonce (blockHeaderNonce bd)
  , "sha3Uncles"       .= hexHash (blockHeaderOmmersHash bd)
  , "logsBloom"        .= hexBytes bloom
  , "transactionsRoot" .= hexBytes (blockHeaderTransactionsRoot bd)
  , "stateRoot"        .= hexBytes (blockHeaderStateRoot bd)
  , "receiptsRoot"     .= hexBytes (blockHeaderReceiptsRoot bd)
  , "miner"            .= hexAddr (blockHeaderBeneficiary bd)
  , "difficulty"       .= hexQuantity (blockHeaderDifficulty bd)
  , "extraData"        .= hexBytes (blockHeaderExtraData bd)
  , "size"             .= hexQuantity (blockSize blk)
  , "gasLimit"         .= hexQuantity configGasLimit
  , "gasUsed"          .= hexQuantity (blockHeaderGasUsed bd)
  , "timestamp"        .= hexQuantity (round . utcTimeToPOSIXSeconds $ blockHeaderTimestamp bd :: Integer)
  , "mixHash"          .= hexHash (blockHeaderMixHash bd)
  , "uncles"           .= map (hexHash . blockHeaderHash) uncles
  ]

-- | Ethereum-shaped transaction object, with block context injected.
txToEthValue :: TransactionLike t => Keccak256 -> Integer -> Integer -> t -> Value
txToEthValue blkHash blkNum idx tx = object
  [ "hash"             .= hexHash (txHash tx)
  , "nonce"            .= hexQuantity (txNonce tx)
  , "blockHash"        .= hexHash blkHash
  , "blockNumber"      .= hexQuantity blkNum
  , "transactionIndex" .= hexQuantity idx
  , "from"             .= fmap hexAddr (txSigner tx)
  , "to"               .= fmap hexAddr (txDestination tx)
  , "value"            .= hexQuantity (txValue tx)
  , "gas"              .= hexQuantity (txGasLimit tx)
  , "gasPrice"         .= hexQuantity (txGasPrice tx)
  , "input"            .= hexBytes (maybe B.empty id (txTxData tx))
  , "v"                .= hexQuantity (txSigV tx)
  , "r"                .= hexQuantity (txSigR tx)
  , "s"                .= hexQuantity (txSigS tx)
  ]

-- Dummy values for fields STRATO does not maintain in an Ethereum-compatible form.

-- | The real network gas limit used to reject oversized txs. Sourced from
-- config, not from the meaningless 'getBlockGasLimit' V2 sentinel.
configGasLimit :: Integer
configGasLimit = EthConf.gasLimit (EthConf.networkConfig ethConf)

blockSize :: Block -> Integer
blockSize = fromIntegral . B.length . rlpSerialize . rlpEncode

-- Ethereum JSON-RPC hex encodings.

-- | QUANTITY: hex with no leading zeros, @0x0@ for zero.
hexQuantity :: Integral a => a -> Value
hexQuantity n = toJSON $ "0x" ++ showHex n ""

-- | DATA: @0x@-prefixed, exact bytes.
hexBytes :: B.ByteString -> Value
hexBytes bs = toJSON $ "0x" ++ BC.unpack (B16.encode bs)

hexHash :: Keccak256 -> Value
hexHash h = toJSON $ "0x" ++ keccak256ToHex h

hexAddr :: Address -> Value
hexAddr a = toJSON $ "0x" ++ show a

-- | The block @nonce@ is 8-byte DATA.
hexNonce :: Word64 -> Value
hexNonce w = toJSON $ "0x" ++ pad 16 (showHex w "")
  where pad n s = replicate (n - length s) '0' ++ s
