{-# LANGUAGE OverloadedStrings #-}

-- | Ethereum-style logs bloom filter (Yellow Paper section 4.3.1, function M).
--
-- A logs bloom is a 2048-bit (256-byte) filter. Each log contributes its
-- contract address and each of its topics as a bloomable item. For an item @x@,
-- three bits are set, taken from the first six bytes of @KEC(x)@: for each of the
-- byte pairs (0,1), (2,3), (4,5), the 11 low-order bits give a bit index in
-- [0, 2047]. The final filter is the big-endian, left-padded serialization of the
-- 2048-bit value, matching go-ethereum's @bloom9@.
--
-- STRATO does not store a real bloom on-chain (see 'Blockchain.Data.BlockHeader'
-- logsBloom, historically a dummy). This module lets the JSON-RPC layer compute a
-- correct bloom on demand from reconstructed logs, and lets the block producer
-- store a real bloom going forward.
module Blockchain.Data.LogsBloom
  ( computeLogsBloom
  , bloomFromItems
  , emptyLogsBloom
  , bloomByteLength
  ) where

import Blockchain.Strato.Model.Address (Address, addressToByteString)
import Blockchain.Strato.Model.ExtendedWord (Word256, word256ToBytes)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Data.Bits (setBit, shiftL, shiftR, (.&.), (.|.))
import qualified Data.ByteString as B
import Data.List (foldl')

-- | Number of bytes in an Ethereum logs bloom (2048 bits).
bloomByteLength :: Int
bloomByteLength = 256

-- | The all-zero 256-byte bloom.
emptyLogsBloom :: B.ByteString
emptyLogsBloom = B.replicate bloomByteLength 0

-- | Ethereum logs bloom over a list of @(address, topics)@ pairs.
computeLogsBloom :: [(Address, [Word256])] -> B.ByteString
computeLogsBloom logs =
  bloomFromItems
    [ item
    | (addr, tops) <- logs
    , item <- addressToByteString addr : map word256ToBytes tops
    ]

-- | Insert raw items (each already the bytes of an address or a topic) into a
-- fresh bloom. Exposed for callers (e.g. the JSON-RPC layer) that already hold
-- topic/address bytes rather than typed values.
bloomFromItems :: [B.ByteString] -> B.ByteString
bloomFromItems items =
  integerToFixedBytes bloomByteLength $
    foldl' (\acc x -> acc .|. bloomBits x) (0 :: Integer) items

-- | The three-bit contribution of a single item, as a 2048-bit integer.
bloomBits :: B.ByteString -> Integer
bloomBits x =
  let k = keccak256ToByteString (hash x) -- 32 bytes
      byteAt i = fromIntegral (B.index k i) :: Int
      bitIndex i = ((byteAt i `shiftL` 8) + byteAt (i + 1)) .&. 2047
  in foldl' (\acc i -> acc `setBit` bitIndex i) (0 :: Integer) [0, 2, 4]

-- | Big-endian serialization of an integer, left-padded to @len@ bytes.
integerToFixedBytes :: Int -> Integer -> B.ByteString
integerToFixedBytes len n =
  B.pack [fromIntegral (n `shiftR` (8 * i)) | i <- [len - 1, len - 2 .. 0]]
