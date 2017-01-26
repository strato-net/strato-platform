module Blockchain.Strato.Model.Util where -- todo once blockapps-util doesnt have a circular dep with us, remove this

import           Data.Bits
import qualified Data.ByteString as B
import           Data.Word

byteString2Integer :: B.ByteString -> Integer
byteString2Integer x = bytes2Integer $ B.unpack x

bytes2Integer :: [Word8] -> Integer
bytes2Integer [] = 0
bytes2Integer (byte:rest) = fromIntegral byte `shift` (8 * length rest) + bytes2Integer rest

padZeros :: Int -> String -> String
padZeros n s = replicate (n - length s) '0' ++ s