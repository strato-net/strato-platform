module Strato.Strato23.Server.Utils where

import Blockchain.Strato.Model.ExtendedWord
import Data.ByteString (ByteString)

word256ToByteString :: Word256 -> ByteString
word256ToByteString = word256ToBytes

byteStringToWord256 :: ByteString -> Word256
byteStringToWord256 = bytesToWord256
