module Blockchain.Data.Util
  ( byteString2Integer,
    integer2Bytes,
  )
where

import Data.Bits
import qualified Data.ByteString as B
import qualified Data.Vector.Storable as V

byteString2Integer :: B.ByteString
                   -> Integer
byteString2Integer bs = do
  let bsv = V.fromList $ B.unpack bs
  V.foldl' (\acc byte -> acc * 256 + fromIntegral byte)
           0
           bsv

integer2Bytes :: Integer
              -> B.ByteString
integer2Bytes = B.pack . go []
  where
    go acc 0 = acc
    go acc x = go (fromInteger (x .&. 255) : acc)
                  (x `shiftR` 8)
