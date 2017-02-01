{-# LANGUAGE NoImplicitPrelude #-}
-- |
-- Low-level operations on pointers.
module BlockApps.ECRecover.Pointers
where

import BlockApps.ECRecover.Prelude
import qualified Data.ByteString.Short as B
import qualified Data.ByteString.Short.Internal as A
import qualified Data.ByteString.Unsafe as C
import qualified Data.ByteString.Internal as D


-- |
-- Warning! Modifying the pointer will affect the original bytestring.
{-# INLINE withModifyingPtrOfBytes #-}
withModifyingPtrOfBytes :: ByteString -> (Ptr Word8 -> IO a) -> IO a
withModifyingPtrOfBytes bytes ptrAction =
  C.unsafeUseAsCString bytes (ptrAction . (castPtr :: Ptr CChar -> Ptr Word8))

-- |
-- Useful for post-processing a foreign function result based on its return status.
{-# INLINE createBytesAndMap #-}
createBytesAndMap :: Int -> (Ptr Word8 -> IO (ByteString -> a)) -> IO a
createBytesAndMap l f =
  do
    fp <- D.mallocByteString l
    postprocess <- withForeignPtr fp $ \p -> f p
    return $! postprocess $! D.PS fp 0 l

{-# INLINABLE pokeInteger #-}
pokeInteger :: Ptr Word8 -> Int -> Integer -> IO ()
pokeInteger ptr size integer =
  recur (pred size) (plusPtr ptr (pred size)) integer
  where
    recur i ptr state =
      if i >= 0
        then do
          poke ptr chunk
          recur (pred i) (plusPtr ptr (-1)) nextState
        else return ()
      where
        chunk =
          fromIntegral state :: Word8
        nextState =
          shiftR state 8
