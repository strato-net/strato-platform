{-# LANGUAGE
    ScopedTypeVariables
#-}

module BlockApps.Solidity.Int
  ( module Data.Int
  , module Data.LargeWord
  , module Data.Word
  , Word24
  , Word40
  , Word48
  , Word56
  , Word72
  , Word80
  , Word88
  , Word104
  , Word112
  , Word120
  , Word136
  , Word144
  , Word152
  , Word168
  , Word176
  , Word184
  , Word200
  , Word208
  , Word216
  , Word232
  , Word240
  , Word248
  , Int24
  , Int40
  , Int48
  , Int56
  , Int72
  , Int80
  , Int88
  , Int96
  , Int104
  , Int112
  , Int120
  , Int128
  , Int136
  , Int144
  , Int152
  , Int160
  , Int168
  , Int176
  , Int184
  , Int192
  , Int200
  , Int208
  , Int216
  , Int224
  , Int232
  , Int240
  , Int248
  , Int256
  ) where

import Control.DeepSeq
import Data.Binary
import Data.Bits
import Data.Int
import Data.LargeWord
import Data.Word
import Foreign.Ptr
import Foreign.Storable

type Word24 = LargeKey Word8 Word16
type Word40 = LargeKey Word8 Word32
type Word48 = LargeKey Word16 Word32
type Word56 = LargeKey Word24 Word32
type Word72 = LargeKey Word8 Word64
type Word80 = LargeKey Word16 Word64
type Word88 = LargeKey Word24 Word64
type Word104 = LargeKey Word8 Word96
type Word112 = LargeKey Word16 Word96
type Word120 = LargeKey Word24 Word96
type Word136 = LargeKey Word8 Word128
type Word144 = LargeKey Word16 Word128
type Word152 = LargeKey Word8 Word144
type Word168 = LargeKey Word8 Word160
type Word176 = LargeKey Word8 Word168
type Word184 = LargeKey Word8 Word176
type Word200 = LargeKey Word8 Word192
type Word208 = LargeKey Word8 Word200
type Word216 = LargeKey Word8 Word208
type Word232 = LargeKey Word8 Word224
type Word240 = LargeKey Word8 Word232
type Word248 = LargeKey Word8 Word240

type Int24 = TwosComplement Word24
type Int40 = TwosComplement Word40
type Int48 = TwosComplement Word48
type Int56 = TwosComplement Word56
type Int72 = TwosComplement Word72
type Int80 = TwosComplement Word80
type Int88 = TwosComplement Word88
type Int96 = TwosComplement Word96
type Int104 = TwosComplement Word104
type Int112 = TwosComplement Word112
type Int120 = TwosComplement Word120
type Int128 = TwosComplement Word128
type Int136 = TwosComplement Word136
type Int144 = TwosComplement Word144
type Int152 = TwosComplement Word152
type Int160 = TwosComplement Word160
type Int168 = TwosComplement Word168
type Int176 = TwosComplement Word176
type Int184 = TwosComplement Word184
type Int192 = TwosComplement Word192
type Int200 = TwosComplement Word200
type Int208 = TwosComplement Word208
type Int216 = TwosComplement Word216
type Int224 = TwosComplement Word224
type Int232 = TwosComplement Word232
type Int240 = TwosComplement Word240
type Int248 = TwosComplement Word248
type Int256 = TwosComplement Word256

newtype TwosComplement x = TwosComplement { unTwosComplement :: x }

instance (Ord a, Num a, FiniteBits a) => FiniteBits (TwosComplement a) where
   finiteBitSize (TwosComplement a) = finiteBitSize a
instance (Ord a, Bits a, FiniteBits a) => Ord (TwosComplement a) where
   compare (TwosComplement a) (TwosComplement b)
     | testBit a (finiteBitSize a - 1) = if testBit b (finiteBitSize b - 1)
                                           then compare a b  -- a and b are negative
                                           else LT           -- a is neg, b is non-neg
     | testBit b (finiteBitSize b - 1) = GT -- a non-negative, b is negative
     | otherwise = compare a b -- a and b are non-negative
instance (Eq a) => Eq (TwosComplement a) where
   TwosComplement a == TwosComplement b = a == b
instance (FiniteBits a, Show a, Num a, Bits a, Ord a) => Show (TwosComplement a) where
   show i@(TwosComplement a)
     | i < 0 = '-' : show (complement a + 1)
     | otherwise = show a
instance (Num a, Bits a, Ord a, FiniteBits a) => Read (TwosComplement a) where
   readsPrec i s = [(fromInteger i', str) | (i',str) <- readsPrec i s]
instance (FiniteBits a, Num a, Bits a, Ord a) => Num (TwosComplement a) where
   (TwosComplement a) + (TwosComplement b) = TwosComplement (a+b)
   (TwosComplement a) - (TwosComplement b) = TwosComplement (a-b)
   (TwosComplement a) * (TwosComplement b) = TwosComplement (a*b)
   negate (TwosComplement a) = TwosComplement (complement a + 1)
   signum a = if a < 0 then -1 else if a > 0 then 1 else 0
   abs a = if a < 0 then negate a else a
   fromInteger i = if i < 0 then negate (TwosComplement $ fromInteger (abs i))
                            else TwosComplement (fromInteger i)
instance (Bits a, Num a, Ord a, FiniteBits a) => Bits (TwosComplement a) where
   rotate (TwosComplement a) i = TwosComplement (rotate a i)
   popCount (TwosComplement a) = popCount a
   (.&.) a b = TwosComplement (unTwosComplement a .&. unTwosComplement b)
   (.|.) a b = TwosComplement (unTwosComplement a .|. unTwosComplement b)
   xor a b   = TwosComplement (unTwosComplement a `xor` unTwosComplement b)
   complement = TwosComplement . complement . unTwosComplement
   shiftL a i = TwosComplement . (`shiftL` i) . unTwosComplement $ a
   shiftR a i = (if a < 0  then \x -> foldl setBit x [finiteBitSize a-1, finiteBitSize a - 2 .. finiteBitSize a - i]
                           else id)
              . TwosComplement
              . (`shiftR` i)
              . unTwosComplement
              $ a
   bit = TwosComplement . bit
   setBit a i = TwosComplement . (`setBit` i) . unTwosComplement $ a
   testBit a i = (`testBit` i) . unTwosComplement $ a
   bitSize (TwosComplement a) = finiteBitSize a
   bitSizeMaybe (TwosComplement a) = Just (finiteBitSize a)
   isSigned _ = True
instance (Bits a, Ord a, Integral a, Bounded a, Num a, FiniteBits a) => Enum (TwosComplement a) where
   toEnum i = fromIntegral i
   fromEnum i = fromIntegral i
   pred a | a > minBound = (a - 1)
          | otherwise = error "tried to take `pred' of minBound"
   succ a | a < maxBound = (a + 1)
          | otherwise = error "tried to take `succ' of maxBound"
instance (Integral a, Bits a, Bounded a, FiniteBits a) => Integral (TwosComplement a) where
   toInteger i@(TwosComplement h) =
           (if (i < 0) then negate else id) . toInteger . (if i < 0 then negate else id) $ h
   quotRem a b =
           let (TwosComplement ah) = abs a
               (TwosComplement bh) = abs b
               (q1,r1) = quotRem ah bh
           in if a < 0 && b < 0
                   then (TwosComplement q1, negate $ TwosComplement r1)
                   else if a < 0
                           then (negate $ TwosComplement q1, negate $ TwosComplement r1)
                           else if b < 0
                                   then (negate $ TwosComplement q1, TwosComplement r1)
                                   else (TwosComplement q1, TwosComplement r1)
instance (FiniteBits a, Real a, Bounded a, Integral a, Bits a) => Real (TwosComplement a) where
   toRational = fromIntegral
instance (Bounded a, Ord a, Bits a, Num a, FiniteBits a) => Bounded (TwosComplement a) where
   minBound = let r = fromIntegral (negate (2^ (finiteBitSize r - 1)) :: Integer) in r
   maxBound = let r = fromIntegral (2^(finiteBitSize r - 1) - 1 :: Integer) in r
instance (Storable a) => Storable (TwosComplement a) where
   sizeOf ~(TwosComplement a) = sizeOf a
   alignment ~(TwosComplement a) = alignment a
   peekElemOff ptr i = fmap TwosComplement (peekElemOff (castPtr ptr) i)
   pokeElemOff ptr i (TwosComplement a) = pokeElemOff (castPtr ptr) i a
instance NFData a => NFData (TwosComplement a) where
  rnf (TwosComplement a) = rnf a
instance Binary a => Binary (TwosComplement a) where
  put = put . unTwosComplement
  get = TwosComplement <$> get
