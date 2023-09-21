module Blockchain.Strato.Model.Util where -- todo once blockapps-util doesnt have a circular dep with us, remove this

import Data.Bits
import qualified Data.ByteString as B
import qualified Data.NibbleString as N
import Data.Word

byteString2Integer :: B.ByteString -> Integer
byteString2Integer = bytes2Integer . B.unpack

--I hate this, it is an ugly way to create an Integer from its component bytes.
--There should be an easier way....
--See http://stackoverflow.com/questions/25854311/efficient-packing-bytes-into-integers
bytes2Integer :: [Word8] -> Integer
bytes2Integer [] = 0
bytes2Integer (byte : rest) = fromIntegral byte `shift` (8 * length rest) + bytes2Integer rest

padZeros :: Int -> String -> String
padZeros n s = replicate (n - length s) '0' ++ s

nibbleString2ByteString :: N.NibbleString -> B.ByteString
nibbleString2ByteString (N.EvenNibbleString s) = s
nibbleString2ByteString (N.OddNibbleString c s) = c `B.cons` s

byteString2NibbleString :: B.ByteString -> N.NibbleString
byteString2NibbleString = N.EvenNibbleString
