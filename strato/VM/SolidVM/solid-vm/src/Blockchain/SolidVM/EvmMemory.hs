{-# LANGUAGE FlexibleContexts #-}

-- | EVM-style byte-addressable memory for inline assembly (Yul) blocks.
--
-- Each 'Blockchain.SolidVM.SM.CallInfo' carries an 'IORef' 'ByteString'
-- that represents the call frame's EVM memory. The layout follows the
-- Solidity convention:
--
--   * 0x00-0x3f -- scratch space (64 bytes)
--   * 0x40-0x5f -- free memory pointer, initialized to 0x80
--   * 0x60-0x7f -- zero slot (always read as 0)
--   * 0x80..    -- allocated region managed by the free memory pointer
--
-- Reads past the end of allocated memory return zero-extended bytes,
-- matching EVM semantics; writes grow the buffer with zero-padding.
module Blockchain.SolidVM.EvmMemory
  ( -- * Raw IORef operations
    readEvmMemRef,
    writeEvmMemRef,
    readEvmWordRef,
    writeEvmWordRef,
    writeEvmByteRef,
    evmMSizeRef,
    freeMemPointerRef,
    -- * MonadSM wrappers (operate on the current call frame's memory)
    mload,
    mstore,
    mstore8,
    mloadBytes,
    mstoreBytes,
    msize,
    freeMemPointer,
    allocateMem,
    -- * Utilities
    wordToBytes,
    bytesToWord,
  )
where

import Blockchain.SolidVM.SM (MonadSM, evmMemory, getCurrentCallInfo)
import Blockchain.Strato.Model.ExtendedWord (Word256, bytesToWord256, word256ToBytes)
import Control.Monad.IO.Class (MonadIO (..))
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.IORef (IORef, atomicModifyIORef', readIORef)
import Data.Word (Word8)

-- ---------------------------------------------------------------------------
-- Constants

-- | Offset of the free memory pointer word (Solidity convention).
fmpOffset :: Int
fmpOffset = 0x40

-- | Number of bytes in an EVM word.
wordSize :: Int
wordSize = 32

-- ---------------------------------------------------------------------------
-- Raw IORef primitives

-- | Read @n@ bytes at @offset@, zero-extending past the end of memory.
readEvmMemRef :: MonadIO m => IORef BC.ByteString -> Int -> Int -> m BC.ByteString
readEvmMemRef ref offset n = liftIO $ do
  mem <- readIORef ref
  let len = B.length mem
  if offset >= len
    then pure $ BC.replicate n '\0'
    else
      let available = min n (len - offset)
          slice = B.take available (B.drop offset mem)
       in pure $ slice <> BC.replicate (n - available) '\0'

-- | Write @bs@ starting at @offset@, growing memory with zero-padding.
writeEvmMemRef :: MonadIO m => IORef BC.ByteString -> Int -> BC.ByteString -> m ()
writeEvmMemRef ref offset bs = liftIO $ atomicModifyIORef' ref $ \mem ->
  let end = offset + B.length bs
      grown =
        if end > B.length mem
          then mem <> BC.replicate (end - B.length mem) '\0'
          else mem
      updated =
        B.take offset grown
          <> bs
          <> B.drop end grown
   in (updated, ())

-- | Read a 32-byte word at @offset@ interpreted as big-endian 'Word256'.
readEvmWordRef :: MonadIO m => IORef BC.ByteString -> Int -> m Word256
readEvmWordRef ref offset = do
  bs <- readEvmMemRef ref offset wordSize
  pure $ bytesToWord256 bs

-- | Write a 'Word256' as 32 big-endian bytes at @offset@.
writeEvmWordRef :: MonadIO m => IORef BC.ByteString -> Int -> Word256 -> m ()
writeEvmWordRef ref offset w = writeEvmMemRef ref offset (word256ToBytes w)

-- | Write a single byte (MSTORE8 semantics: only the LSB is stored).
writeEvmByteRef :: MonadIO m => IORef BC.ByteString -> Int -> Word8 -> m ()
writeEvmByteRef ref offset b = writeEvmMemRef ref offset (B.singleton b)

-- | Current allocated size of memory in bytes, rounded up to 32.
-- This matches the EVM MSIZE opcode.
evmMSizeRef :: MonadIO m => IORef BC.ByteString -> m Int
evmMSizeRef ref = liftIO $ do
  mem <- readIORef ref
  let raw = B.length mem
  -- Round up to the next 32-byte boundary
  pure $ ((raw + wordSize - 1) `div` wordSize) * wordSize

-- | Read the free memory pointer (offset 0x40) as a 'Word256'.
freeMemPointerRef :: MonadIO m => IORef BC.ByteString -> m Word256
freeMemPointerRef ref = readEvmWordRef ref fmpOffset

-- ---------------------------------------------------------------------------
-- MonadSM wrappers

getMemRef :: MonadSM m => m (IORef BC.ByteString)
getMemRef = evmMemory <$> getCurrentCallInfo

-- | @mload(offset)@: read a 32-byte word at @offset@.
mload :: MonadSM m => Int -> m Word256
mload offset = getMemRef >>= \r -> readEvmWordRef r offset

-- | @mstore(offset, value)@: write a 32-byte word at @offset@.
mstore :: MonadSM m => Int -> Word256 -> m ()
mstore offset w = getMemRef >>= \r -> writeEvmWordRef r offset w

-- | @mstore8(offset, value)@: write the low byte of @value@ at @offset@.
mstore8 :: MonadSM m => Int -> Word8 -> m ()
mstore8 offset b = getMemRef >>= \r -> writeEvmByteRef r offset b

-- | Read @n@ raw bytes at @offset@, zero-extended.
mloadBytes :: MonadSM m => Int -> Int -> m BC.ByteString
mloadBytes offset n = getMemRef >>= \r -> readEvmMemRef r offset n

-- | Write a raw byte string starting at @offset@.
mstoreBytes :: MonadSM m => Int -> BC.ByteString -> m ()
mstoreBytes offset bs = getMemRef >>= \r -> writeEvmMemRef r offset bs

-- | Current memory size rounded up to a 32-byte word.
msize :: MonadSM m => m Int
msize = getMemRef >>= evmMSizeRef

-- | Read the free memory pointer stored at offset 0x40.
freeMemPointer :: MonadSM m => m Word256
freeMemPointer = getMemRef >>= freeMemPointerRef

-- | Bump the free memory pointer by @n@ bytes (rounded up to 32) and
-- return the pre-bump pointer, which is the start of the new allocation.
-- This mirrors Solidity's usual @mload(0x40); mstore(0x40, ptr + n)@ idiom.
allocateMem :: MonadSM m => Int -> m Word256
allocateMem n = do
  ref <- getMemRef
  liftIO $ do
    ptr <- readEvmWordRef ref fmpOffset
    let padded = ((n + wordSize - 1) `div` wordSize) * wordSize
        newPtr = ptr + fromIntegral padded
    writeEvmWordRef ref fmpOffset newPtr
    pure ptr

-- ---------------------------------------------------------------------------
-- Utilities

wordToBytes :: Word256 -> BC.ByteString
wordToBytes = word256ToBytes

bytesToWord :: BC.ByteString -> Word256
bytesToWord = bytesToWord256
