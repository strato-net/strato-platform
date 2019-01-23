{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE MagicHash #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
{-# OPTIONS_GHC -fno-warn-missing-fields #-}
import Control.Monad
import Criterion.Main
import Data.Bits
import qualified Data.ByteString        as B
import qualified Data.ByteString.Unsafe as BU
import Data.Primitive.ByteArray
import Foreign.Ptr
import Foreign.Storable
import GHC.Exts
import GHC.Integer.GMP.Internals (Integer(..), BigNat(..))
import GHC.Word
import System.Endian
import System.IO.Unsafe

import Network.Haskoin.Internals (BigWord(..))

import Blockchain.Data.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Util

import Test.Hspec

{-# NOINLINE exampleCode #-}
exampleCode :: Code
exampleCode = Code $ B.pack $ [0..255]

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

benchExtract1Slow :: Benchmark
benchExtract1Slow = bench "extract1 slow"
                  $ nf (defaultExtract exampleCode 128) 1

benchExtract1Fast :: Benchmark
benchExtract1Fast = bench "extract1 fast"
                  $ nf (fastExtractByte exampleCode) 128

benchExtract3Slow :: Benchmark
benchExtract3Slow = bench "extract3 slow"
                  $ nf (defaultExtract exampleCode 128) 3

benchExtract3Fast :: Benchmark
benchExtract3Fast = bench "extract3 fast"
                  $ nf (fastExtractSingle exampleCode 0) 3

benchExtract25Slow :: Benchmark
benchExtract25Slow = bench "extract25 slow"
                   $ nf (defaultExtract exampleCode 128) 25

benchExtract25Fast :: Benchmark
benchExtract25Fast = bench "extract25 fast"
                   $ nf (fastExtractQuad exampleCode 128) 25

spec :: Spec
spec = do
  describe "push1" $ do
    it "can extract 1 byte" $ do
       fastExtractByte exampleCode 0 `shouldBe` defaultExtract exampleCode 0 1
       fastExtractByte exampleCode 1 `shouldBe` defaultExtract exampleCode 1 1
       fastExtractByte exampleCode 2 `shouldBe` defaultExtract exampleCode 2 1
       map (fastExtractByte exampleCode) [0..255] `shouldBe` map (\x -> defaultExtract exampleCode x 1) [0..255]

  describe "push low" $ do
    it "can push 3 bytes" $ do
      forM_ [0, 1, 7, 128] $ \n ->
        fastExtractSingle exampleCode n 3 `shouldBe` defaultExtract exampleCode n 3
    it "can push 7 bytes" $ do
      forM_ [0, 1, 0xbb] $ \n ->
        fastExtractSingle exampleCode n 7 `shouldBe` defaultExtract exampleCode n 7

  describe "push high" $ do
    it "can push 25 bytes" $ do
      fastExtractQuad exampleCode 1 25 `shouldBe` defaultExtract exampleCode 1 25
    it "can push 31 bytes" $ do
      fastExtractQuad exampleCode 0 31 `shouldBe` defaultExtract exampleCode 0 31
      fastExtractQuad exampleCode 1 31 `shouldBe` defaultExtract exampleCode 1 31
      fastExtractQuad exampleCode 2 31 `shouldBe` defaultExtract exampleCode 2 31
    it "can push 32 bytes" $ do
      fastExtractQuad exampleCode 0 32 `shouldBe`  defaultExtract exampleCode 0 32
      fastExtractQuad exampleCode 1 32 `shouldBe`  defaultExtract exampleCode 1 32
      fastExtractQuad exampleCode 2 32 `shouldBe`  defaultExtract exampleCode 2 32
      fastExtractQuad exampleCode 64 32 `shouldBe` defaultExtract exampleCode 64 32


main :: IO ()
main = do
  hspec spec
  defaultMain [benchExtract1Slow, benchExtract1Fast,
               benchExtract3Slow, benchExtract3Fast,
               benchExtract25Slow, benchExtract25Fast]
