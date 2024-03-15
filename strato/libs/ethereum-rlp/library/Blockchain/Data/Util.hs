module Blockchain.Data.Util
  ( byteString2Integer,
    integer2Bytes,
  )
where

import           Data.Bits
import qualified Data.ByteString as B

byteString2Integer :: B.ByteString
                   -> Integer
                   -> Integer
byteString2Integer bs
                   acc = do
  case B.uncons bs of
    Nothing                 ->
      acc
    Just (byte,restofbytes) ->
      let newacc = acc * 256 + fromIntegral byte
        in byteString2Integer restofbytes
                              newacc

integer2Bytes :: Integer
              -> B.ByteString
integer2Bytes = B.pack . go []
  where
    go acc 0 = acc
    go acc x = go (fromInteger (x .&. 255) : acc)
                  (x `shiftR` 8)
