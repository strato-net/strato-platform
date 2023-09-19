import Blockchain.Strato.Model.ExtendedWord
import Criterion.Main
import Data.Bits
import qualified Data.ByteString as B
import Data.Word

benchLSBSlow :: Word256 -> Benchmark
benchLSBSlow w = bench ("least significant byte slow: " ++ show w) $ nf g w
  where
    g :: Word256 -> Word8
    g v = fromIntegral $! v .&. 0xff

benchLSBFast :: Word256 -> Benchmark
benchLSBFast w = bench ("least significant byte fast: " ++ show w) $ nf fastWord256LSB w

benchSerializeSlow :: Word256 -> Benchmark
benchSerializeSlow w = bench ("serializing slow: " ++ show w) $ nf (B.pack . slowWord256ToBytes) w

benchSerializeFast :: Word256 -> Benchmark
benchSerializeFast w = bench ("serializing fast: " ++ show w) $ nf word256ToBytes w

benchDeserializeSlow :: Word256 -> Benchmark
benchDeserializeSlow w = bench ("deserializing slow: " ++ show w) $ nf slowBytesToWord256 (slowWord256ToBytes w)

benchDeserializeFast :: Word256 -> Benchmark
benchDeserializeFast w = bench ("deserializing fast: " ++ show w) $ nf bytesToWord256 (word256ToBytes w)

main :: IO ()
main = do
  let input =
        [ 0,
          0xff,
          0xffffffff,
          0xffeeddccbbaa99887766554433221100,
          0xffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100
        ] ::
          [Word256]
  defaultMain $
    map benchLSBSlow input
      ++ map benchLSBFast input
      ++ map benchSerializeSlow input
      ++ map benchSerializeFast input
      ++ map benchDeserializeSlow input
      ++ map benchDeserializeFast input
