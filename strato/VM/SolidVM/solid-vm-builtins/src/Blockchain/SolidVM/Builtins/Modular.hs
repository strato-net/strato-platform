module Blockchain.SolidVM.Builtins.Modular (byte, addmod, mulmod) where

import qualified Blockchain.SolidVM.Builtins.Operators as Operators
import Data.Bits ((.&.))

byte :: Integer -> Integer
byte n = n .&. 0xff

addmod, mulmod :: Integer -> Integer -> Integer -> Integer
addmod a b c = Operators.checkDivisor c `seq` ((a + b) `mod` c)
mulmod a b c = Operators.checkDivisor c `seq` ((a * b) `mod` c)
