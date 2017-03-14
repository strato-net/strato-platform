{-# LANGUAGE
    ScopedTypeVariables
#-}

module BlockApps.Solidity.Int
  ( module Data.Int
  , module Data.LargeInt
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
  , Int104
  , Int112
  , Int120
  , Int136
  , Int144
  , Int152
  , Int168
  , Int176
  , Int184
  , Int200
  , Int208
  , Int216
  , Int232
  , Int240
  , Int248
  ) where

import Data.Int
import Data.LargeInt
import Data.LargeWord
import Data.Word

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
type Int104 = TwosComplement Word104
type Int112 = TwosComplement Word112
type Int120 = TwosComplement Word120
type Int136 = TwosComplement Word136
type Int144 = TwosComplement Word144
type Int152 = TwosComplement Word152
type Int168 = TwosComplement Word168
type Int176 = TwosComplement Word176
type Int184 = TwosComplement Word184
type Int200 = TwosComplement Word200
type Int208 = TwosComplement Word208
type Int216 = TwosComplement Word216
type Int232 = TwosComplement Word232
type Int240 = TwosComplement Word240
type Int248 = TwosComplement Word248
