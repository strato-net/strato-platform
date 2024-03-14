module Blockchain.Data.Util
  ( byteString2Integer,
    integer2Bytes,
  )
where

import Data.Bits
import qualified Data.ByteString as B

byteString2Integer :: B.ByteString
                   -> Integer
byteString2Integer bs =
  go 0
     0
     (B.length bs - 1)
  where
    go acc _           (-1) = acc
    go acc shiftamount n    = go (acc + (fromIntegral (bs `B.index` n) `shiftL` shiftamount))
                                 (shiftamount + 8)
                                 (n - 1)

integer2Bytes :: Integer
              -> B.ByteString
integer2Bytes = B.pack . go []
  where
    go acc 0 = acc
    go acc x = go (fromInteger (x .&. 255) : acc)
                  (x `shiftR` 8)
