module FastKeccak256 where

import qualified Data.ByteString as B
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.Unsafe as BU
import Foreign.C.Types
import Foreign.Ptr
import System.IO.Unsafe

foreign import ccall "fastKeccak256" c_fastKeccak256 :: Ptr CUChar -> Int -> Ptr CUChar -> IO ()

fastKeccak256 :: B.ByteString -> B.ByteString
fastKeccak256 bs = unsafePerformIO
                 $ BI.create 32
                 $ \dst -> BU.unsafeUseAsCStringLen bs
                 $ \(src, len) -> c_fastKeccak256 (castPtr src) len (castPtr dst)
