module Strato.Strato23.Server.Utils where

import           Data.ByteString         (ByteString)
import           BlockApps.Ethereum

word256ToByteString :: Word256 -> ByteString
word256ToByteString = word256ToBytes

byteStringToWord256 :: ByteString -> Word256
byteStringToWord256 = bytesToWord256
