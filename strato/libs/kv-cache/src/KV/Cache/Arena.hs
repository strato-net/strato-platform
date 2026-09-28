-- | A bump allocator for bytes that are going to be cached.
--
-- A 'ByteString' read from LevelDB is a slice of a large pinned buffer; caching
-- the slice keeps the whole buffer alive. Copying it into an arena slab instead
-- means a cached value only ever pins bytes that are also cached, and a slab is
-- freed once nothing in it is referenced. Slabs live on the C heap, outside the
-- GHC heap entirely.
module KV.Cache.Arena
  ( Arena,
    new,
    copy,
  )
where

import qualified Data.ByteString as B
import qualified Data.ByteString.Internal as BI
import qualified Data.ByteString.Unsafe as BU
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.IORef
import Data.Word (Word8)
import Foreign.ForeignPtr (ForeignPtr, newForeignPtr, withForeignPtr)
import Foreign.Marshal.Alloc (finalizerFree, mallocBytes)
import Foreign.Marshal.Utils (copyBytes)
import Foreign.Ptr (castPtr, plusPtr)

-- | Slab size, and the current slab with its fill offset.
data Arena = Arena !Int !(IORef (ForeignPtr Word8, Int))

new :: MonadIO m => Int -> m Arena
new slabSize = liftIO $ do
  fp <- newSlab slabSize
  Arena slabSize <$> newIORef (fp, 0)

newSlab :: Int -> IO (ForeignPtr Word8)
newSlab n = mallocBytes n >>= newForeignPtr finalizerFree

-- | Copy into the arena. Anything larger than a slab gets its own allocation.
copy :: MonadIO m => Arena -> B.ByteString -> m B.ByteString
copy (Arena slabSize ref) src
  | n > slabSize = pure $! B.copy src
  | otherwise = liftIO $ do
      (fp0, off0) <- readIORef ref
      (fp, off) <-
        if off0 + n > slabSize
          then (\fp -> (fp, 0)) <$> newSlab slabSize
          else pure (fp0, off0)
      withForeignPtr fp $ \dst -> BU.unsafeUseAsCStringLen src $ \(p, _) ->
        copyBytes (dst `plusPtr` off) (castPtr p) n
      writeIORef ref (fp, off + n)
      pure $! BI.fromForeignPtr fp off n
  where
    n = B.length src
