module Blockchain.SolidVM.Native
  ( bn254G1Add,
    bn254G1Mul,
    bn254Pairing,
    bls12381G1Add,
  )
where

import qualified Data.ByteString as B
import qualified Data.ByteString.Unsafe as BU
import Foreign.C.Types (CInt (..), CSize (..))
import Data.Word (Word8)
import Foreign.Marshal.Alloc (allocaBytes)
import Foreign.Ptr (Ptr, castPtr)
import System.IO.Unsafe (unsafePerformIO)

foreign import ccall unsafe "solidvm_bn254_pairing"
  c_bn254Pairing :: Ptr Word8 -> CSize -> IO CInt

foreign import ccall unsafe "solidvm_bn254_g1_add"
  c_bn254G1Add :: Ptr Word8 -> CSize -> Ptr Word8 -> IO CInt

foreign import ccall unsafe "solidvm_bn254_g1_mul"
  c_bn254G1Mul :: Ptr Word8 -> CSize -> Ptr Word8 -> IO CInt

foreign import ccall unsafe "solidvm_bls12381_g1_add"
  c_bls12381G1Add :: Ptr Word8 -> CSize -> Ptr Word8 -> IO CInt

-- Point operations copy their fixed 64-byte result before the Rust stack
-- frame returns.
bn254G1Add :: B.ByteString -> Either () B.ByteString
bn254G1Add = bn254PointOperation c_bn254G1Add
{-# NOINLINE bn254G1Add #-}

bn254G1Mul :: B.ByteString -> Either () B.ByteString
bn254G1Mul = bn254PointOperation c_bn254G1Mul
{-# NOINLINE bn254G1Mul #-}

bls12381G1Add :: B.ByteString -> Either () B.ByteString
bls12381G1Add = pointOperation 128 c_bls12381G1Add
{-# NOINLINE bls12381G1Add #-}

bn254PointOperation :: (Ptr Word8 -> CSize -> Ptr Word8 -> IO CInt) -> B.ByteString -> Either () B.ByteString
bn254PointOperation = pointOperation 64

pointOperation :: Int -> (Ptr Word8 -> CSize -> Ptr Word8 -> IO CInt) -> B.ByteString -> Either () B.ByteString
pointOperation outputBytes operation input = unsafePerformIO $
  BU.unsafeUseAsCStringLen input $ \(inputPointer, byteCount) ->
    allocaBytes outputBytes $ \outputPointer -> do
      result <- operation (castPtr inputPointer) (fromIntegral byteCount) outputPointer
      if result == 0
        then Right <$> B.packCStringLen (castPtr outputPointer, outputBytes)
        else pure $ Left ()

-- | Run the native EIP-197 pairing check. A 'Left' indicates malformed
-- input; callers can then enter the legacy implementation to preserve its
-- exact exception behavior.
bn254Pairing :: B.ByteString -> Either () Bool
bn254Pairing input = unsafePerformIO $
  BU.unsafeUseAsCStringLen input $ \(pointer, byteCount) -> do
    result <- c_bn254Pairing (castPtr pointer) (fromIntegral byteCount)
    pure $ case result of
      0 -> Right False
      1 -> Right True
      _ -> Left ()
{-# NOINLINE bn254Pairing #-}
