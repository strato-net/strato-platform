module Blockchain.SolidVM.Builtins.Operators
  ( integerAdd, integerSubtract, integerMultiply, integerDivide,
    integerRemainder, integerPower, integerOr, integerAnd,
    integerXor, integerShiftLeft, integerShiftRight, integerUnsignedShiftRight,
    decimalAdd, decimalIntegerAdd, integerDecimalAdd,
    decimalSubtract, decimalIntegerSubtract, integerDecimalSubtract, decimalMultiply,
    decimalIntegerMultiply, integerDecimalMultiply, decimalDivide, decimalIntegerDivide,
    integerDecimalDivide, decimalRemainder, decimalIntegerRemainder, integerDecimalRemainder,
    stringAdd, textAdd, bytesAdd, integerShiftLeftAssign, checkDivisor
  ) where

import qualified Blockchain.VM.SolidException as Exception
import Data.Bits
import Data.Decimal
import qualified Data.ByteString as B
import qualified Data.Text as T
import Blockchain.Strato.Model.ExtendedWord (Word256)

integerAdd :: Integer -> Integer -> Integer
integerAdd a b = a + b

integerSubtract :: Integer -> Integer -> Integer
integerSubtract a b = a - b

integerMultiply :: Integer -> Integer -> Integer
integerMultiply a b = a * b

integerDivide :: Integer -> Integer -> Integer
integerDivide a b = checkDivisor b `seq` (a `div` b)

integerRemainder :: Integer -> Integer -> Integer
integerRemainder a b = checkDivisor b `seq` (a `rem` b)

integerPower :: Integer -> Integer -> Integer
integerPower a b
  | b < 0 = Exception.arithmeticException "negative exponent" b
  | otherwise = a ^ b

integerOr :: Integer -> Integer -> Integer
integerOr a b = a .|. b

integerAnd :: Integer -> Integer -> Integer
integerAnd a b = a .&. b

integerXor :: Integer -> Integer -> Integer
integerXor a b = a `xor` b

integerShiftLeft :: Integer -> Integer -> Integer
integerShiftLeft a b = shift a (fromInteger b)

integerShiftRight :: Integer -> Integer -> Integer
integerShiftRight a b = shiftR a (fromInteger b)

integerUnsignedShiftRight :: Integer -> Integer -> Integer
integerUnsignedShiftRight a b = shiftR (fromInteger (toInteger (fromInteger a :: Word256))) (fromInteger b)

decimalAdd :: Decimal -> Decimal -> Decimal
decimalAdd a b = a + b

decimalIntegerAdd :: Decimal -> Integer -> Decimal
decimalIntegerAdd a b = a + (Decimal 0 b)

integerDecimalAdd :: Integer -> Decimal -> Decimal
integerDecimalAdd a b = (Decimal 0 a) + b

decimalSubtract :: Decimal -> Decimal -> Decimal
decimalSubtract a b = roundTo (max (decimalPlaces a) (decimalPlaces b)) (a - b)

decimalIntegerSubtract :: Decimal -> Integer -> Decimal
decimalIntegerSubtract a b = roundTo (decimalPlaces a) (a - (Decimal 0 b))

integerDecimalSubtract :: Integer -> Decimal -> Decimal
integerDecimalSubtract a b = roundTo (decimalPlaces b) ((Decimal 0 a) - b)

decimalMultiply :: Decimal -> Decimal -> Decimal
decimalMultiply a b = roundTo (max (decimalPlaces a) (decimalPlaces b)) (a * b)

decimalIntegerMultiply :: Decimal -> Integer -> Decimal
decimalIntegerMultiply a b = roundTo (decimalPlaces a) (a * (Decimal 0 b))

integerDecimalMultiply :: Integer -> Decimal -> Decimal
integerDecimalMultiply a b = roundTo (decimalPlaces b) ((Decimal 0 a) * b)

decimalDivide :: Decimal -> Decimal -> Decimal
decimalDivide a b = checkDivisor b `seq` (roundTo (max (decimalPlaces a) (decimalPlaces b)) (a / b))

decimalIntegerDivide :: Decimal -> Integer -> Decimal
decimalIntegerDivide a b = checkDivisor b `seq` (roundTo (decimalPlaces a) (a / (Decimal 0 b)))

integerDecimalDivide :: Integer -> Decimal -> Decimal
integerDecimalDivide a b = checkDivisor b `seq` (roundTo (decimalPlaces b) ((Decimal 0 a) / b))

decimalRemainder :: Decimal -> Decimal -> Decimal
decimalRemainder a b = checkDivisor b `seq` (roundTo (max (decimalPlaces a) (decimalPlaces b)) (decimalModulo a b))

decimalIntegerRemainder :: Decimal -> Integer -> Decimal
decimalIntegerRemainder a b = checkDivisor b `seq` (roundTo (decimalPlaces a) (decimalModulo a (Decimal 0 b)))

integerDecimalRemainder :: Integer -> Decimal -> Decimal
integerDecimalRemainder a b = checkDivisor b `seq` (roundTo (decimalPlaces b) (decimalModulo (Decimal 0 a) b))

--decMod operation, implements % w Data.Decimal library functions
decimalModulo :: Decimal -> Decimal -> Decimal
decimalModulo a b = fromRational (x - fromIntegral (floor (x / y) :: Integer) * y)
  where x = toRational a; y = toRational b

stringAdd :: String -> String -> String
stringAdd = (++)

textAdd :: T.Text -> T.Text -> T.Text
textAdd = (<>)

bytesAdd :: B.ByteString -> B.ByteString -> B.ByteString
bytesAdd = (<>)

integerShiftLeftAssign :: Integer -> Integer -> Integer
integerShiftLeftAssign a b = shiftL a (fromInteger b)

checkDivisor :: (Eq a, Num a, Show a) => a -> ()
checkDivisor value
  | value == 0 = Exception.divideByZero value
  | otherwise = ()
