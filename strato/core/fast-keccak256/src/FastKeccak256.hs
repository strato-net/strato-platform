module FastKeccak256 where

import Crypto.Hash (Digest, Keccak_256, hash)
import Data.ByteArray (convert)
import qualified Data.ByteString as B
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.Unsafe as BU
import Foreign.C.Types
import Foreign.Ptr
import System.IO.Unsafe

foreign import ccall "keccak_256" c_keccak256 :: Ptr CUChar -> Int -> Ptr CUChar -> Int -> IO ()

fastKeccak256 :: B.ByteString -> B.ByteString
fastKeccak256 bs = unsafePerformIO $
  BI.create 32 $
    \dst -> BU.unsafeUseAsCStringLen bs $
      \(src, len) -> c_keccak256 (castPtr dst) 32 (castPtr src) len

-- For testing and benchmarks
slowKeccak256 :: B.ByteString -> B.ByteString
slowKeccak256 bs = convert (hash bs :: Digest Keccak_256)
