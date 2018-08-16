module Strato.Strato23.Server.Utils where

import           Data.Binary.Get         (runGet, getWord64be)
import           Data.ByteString         (ByteString)
import qualified Data.ByteString         as BS
import qualified Data.ByteString.Builder as BB
import qualified Data.ByteString.Lazy    as BL
import           Data.LargeWord          (LargeKey(..), Word256)

word256ToByteString :: Word256 -> ByteString
word256ToByteString (LargeKey w1 (LargeKey w2 (LargeKey w3 w4))) =
  BS.concat $ map (BL.toStrict . BB.toLazyByteString . BB.word64BE) [w4,w3,w2,w1]

byteStringToWord256 :: ByteString -> Word256
byteStringToWord256 bs =
  let
    [w4,w3,w2,w1] = flip runGet (BL.fromStrict bs) $ do
      w_4 <- getWord64be
      w_3 <- getWord64be
      w_2 <- getWord64be
      w_1 <- getWord64be
      return [w_4,w_3,w_2,w_1]
  in LargeKey w1 (LargeKey w2 (LargeKey w3 w4))

