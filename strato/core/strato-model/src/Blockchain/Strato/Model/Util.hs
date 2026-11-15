module Blockchain.Strato.Model.Util where -- todo once blockapps-util doesnt have a circular dep with us, remove this

import Data.Binary (Get, Put, get, put)
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.NibbleString as N
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Word

-- Splits large values in halves: adding a byte at a time to the whole number
-- takes time quadratic in its size.
byteString2Integer :: B.ByteString -> Integer
byteString2Integer b
  | B.length b <= 64 = B.foldl' (\n w -> n * 256 + fromIntegral w) 0 b
  | otherwise =
      let (hi, lo) = B.splitAt (B.length b `div` 2) b
       in (byteString2Integer hi `shiftL` (8 * B.length lo)) + byteString2Integer lo

--I hate this, it is an ugly way to create an Integer from its component bytes.
--There should be an easier way....
--See http://stackoverflow.com/questions/25854311/efficient-packing-bytes-into-integers
bytes2Integer :: [Word8] -> Integer
bytes2Integer [] = 0
bytes2Integer (byte : rest) = fromIntegral byte `shift` (8 * length rest) + bytes2Integer rest

-- | Data.Binary's String instance writes one Char at a time; for string-heavy
-- messages (events, tx results) that is most of the encoding cost. Write the
-- whole String as one UTF-8 blob instead.
putUtf8String :: String -> Put
putUtf8String = put . TE.encodeUtf8 . T.pack

getUtf8String :: Get String
getUtf8String = T.unpack . TE.decodeUtf8 <$> get

padZeros :: Int -> String -> String
padZeros n s = replicate (n - length s) '0' ++ s

nibbleString2ByteString :: N.NibbleString -> B.ByteString
nibbleString2ByteString (N.EvenNibbleString s) = s
nibbleString2ByteString (N.OddNibbleString c s) = c `B.cons` s

byteString2NibbleString :: B.ByteString -> N.NibbleString
byteString2NibbleString = N.EvenNibbleString
