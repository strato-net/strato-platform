module Blockchain.Data.Util
  ( byteString2Integer,
    integer2Bytes,
  )
where

import           Data.Bits
import qualified Data.ByteString as B
import           GHC.Num (integerLog2)

-- Both conversions split large values in halves: working a byte at a time
-- against the whole number takes time quadratic in its size.
byteString2Integer :: B.ByteString
                   -> Integer
                   -> Integer
byteString2Integer bs acc = (acc `shiftL` (8 * B.length bs)) + go bs
  where
    go b
      | B.length b <= 64 = B.foldl' (\n w -> n * 256 + fromIntegral w) 0 b
      | otherwise =
          let (hi, lo) = B.splitAt (B.length b `div` 2) b
           in (go hi `shiftL` (8 * B.length lo)) + go lo

integer2Bytes :: Integer
              -> B.ByteString
integer2Bytes x
  | x <= 0 = small x
  | otherwise = go (fromIntegral (integerLog2 x) `div` 8 + 1) x
  where
    go :: Int -> Integer -> B.ByteString
    go n v
      | n <= 64 = let b = small v in B.replicate (n - B.length b) 0 <> b
      | otherwise =
          let h = n `div` 2
           in go (n - h) (v `shiftR` (8 * h)) <> go h (v .&. (bit (8 * h) - 1))
    small = B.pack . loop []
    loop acc 0 = acc
    loop acc v = loop (fromInteger (v .&. 255) : acc)
                      (v `shiftR` 8)
