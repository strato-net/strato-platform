{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MagicHash    #-}
module Blockchain.VM.Code where

import           Data.Bits
import qualified Data.ByteString              as B
import qualified Data.ByteString.Unsafe       as BU
import qualified Data.IntSet                  as I
import           Data.Primitive.ByteArray
import           Foreign.Ptr
import           Foreign.Storable
import           GHC.Exts
import           GHC.Integer.GMP.Internals (Integer(..), BigNat(..))
import           GHC.Word
import           Numeric
import           System.Endian
import           System.IO.Unsafe
import           Text.PrettyPrint.ANSI.Leijen

import qualified Blockchain.Colors            as CL
import           Blockchain.Data.Code
import           Blockchain.Format
import           Blockchain.Util
import           Blockchain.VM.Opcodes
import           Network.Haskoin.Internals (BigWord(..), Word256)


getOperationAt::Code->CodePointer->(Operation, CodePointer)
getOperationAt (Code bytes) p        = getOperationAt' bytes p
getOperationAt (PrecompiledCode _) _ = error "getOperationAt called for precompilded code"

getOperationAt'::B.ByteString->Int->(Operation, CodePointer)
getOperationAt' rom p = opCode2Op $ safeIntDrop p rom

showCode::CodePointer->Code->String
showCode _ (Code bytes) | B.null bytes = ""
showCode _ (PrecompiledCode x) = CL.blue $ "<PrecompiledCode:" ++ show x ++">"
showCode lineNumber c@(Code rom) = showHex lineNumber "" ++ " " ++ format (B.pack $ op2OpCode op) ++ " " ++ show (pretty op) ++ "\n" ++  showCode (lineNumber + nextP) (Code (safeIntDrop nextP rom))
        where
          (op, nextP) = getOperationAt c 0

formatCode::Code->String
formatCode = showCode 0

getValidJUMPDESTs :: Code -> I.IntSet
getValidJUMPDESTs (PrecompiledCode _) = error "getValidJUMPDESTs called on precompiled code"
getValidJUMPDESTs (Code bytes) = I.fromAscList $ go 0
 where
  len = B.length bytes
  go :: Int -> [Int]
  go !x = if x >= len
            then []
            else case B.index bytes x of
                    0x5b -> x : go (x+1)
                    op | 0x60 <= op && op <= 0x7f -> go (x + 2 + fromIntegral op - 0x60)
                       | otherwise -> go (x+1)

codeLength::Code->CodePointer
codeLength (Code bytes)        = B.length bytes
codeLength (PrecompiledCode _) = error "codeLength called on precompiled code"

compile::[Operation]->Code
compile x = Code bytes
  where
    bytes = B.pack $ op2OpCode =<< x

-- Unoptimized push, for 8-24 bytes that are too infrequently seen
-- to bother writing a specialization.
defaultExtract :: Code -> Int -> Int -> Word256
-- TODO(tim): Use fastBytesToWord256 once available
defaultExtract (Code bs) off len = fromIntegral
                                 . bytes2Integer
                                 . B.unpack
                                 . B.take len
                                 . B.drop off
                                 $ bs
defaultExtract _ _ _ = error "precompiled contracts cannot slice code"

fastExtractByte :: Code -> Int -> Word256
fastExtractByte (Code !code) !off = let !(W8# b#) = BU.unsafeIndex code off
                                    in BigWord (S# (word2Int# b#))
fastExtractByte _ _ = error "cannot slice out of precompiled"

-- Used to push 2-7 bytes
fastExtractSingle :: Code -> Int -> Int -> Word256
fastExtractSingle (Code !code) !off !len = unsafePerformIO . BU.unsafeUseAsCString code $ \ptr -> do
  let !offPtr = castPtr ptr :: Ptr Word64
      !delta = 64 - (8 * len)
  -- This may read past the end of the bytestring, but if the read is allowed
  -- those garbage bytes are truncated by the shift.
  !rawBits <- peekByteOff offPtr off
  let !(W64# w#) = toBE64 rawBits `shiftR` delta
  return $! BigWord (S# (word2Int# w#))
fastExtractSingle _ _ _ = error "cannot slice out of precompiled"

-- Used to push 25-32 bytes
fastExtractQuad :: Code -> Int -> Int -> Word256
fastExtractQuad (Code !code) !off !len = unsafePerformIO . BU.unsafeUseAsCString code $ \ptr -> do
  let !offPtr = castPtr (plusPtr ptr (off + len)) :: Ptr Word64
  dst <- newByteArray 32
  ll <- peekElemOff offPtr (-1)
  lh <- peekElemOff offPtr (-2)
  hl <- peekElemOff offPtr (-3)
  -- This might be a violation: we read before the beginning of the bytestring.
  -- However if the read is allowed, the garbage bytes are masked off.
  hh <- peekElemOff offPtr (-4)

  writeByteArray dst 0 $! toBE64 ll
  writeByteArray dst 1 $! toBE64 lh
  writeByteArray dst 2 $! toBE64 hl
  let !mask = bit (8 * (len - 24)) - 1
  writeByteArray dst 3 $! toBE64 hh .&. mask
  !(ByteArray ba#) <- unsafeFreezeByteArray dst
  return (BigWord (Jp# (BN# ba#)))
fastExtractQuad _ _ _ = error "cannot slice out of precompiled"
