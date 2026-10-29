module Blockchain.SolidVM.Builtins.Operators.Metered where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import qualified Blockchain.SolidVM.Builtins.Operators as Operators
import Blockchain.SolidVM.Builtins.Gas
import Control.Exception (evaluate)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Decimal
import qualified Data.ByteString as B
import qualified Data.Text as T

integerAdd :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerAdd a b = chargeOperation (1 + max (byteWidth a) (byteWidth b)) >> pure (Operators.integerAdd a b)

integerSubtract :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerSubtract a b = chargeOperation (1 + max (byteWidth a) (byteWidth b)) >> pure (Operators.integerSubtract a b)

integerMultiply :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerMultiply a b = chargeOperation (byteWidth a + byteWidth b) >> pure (Operators.integerMultiply a b)

integerDivide :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerDivide a b = chargeOperation (byteWidth a) >> liftIO (evaluate (Operators.integerDivide a b))

integerRemainder :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerRemainder a b = chargeOperation (byteWidth b) >> liftIO (evaluate (Operators.integerRemainder a b))

integerPower :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerPower a b = chargeOperation (byteWidth a * b) >> liftIO (evaluate (Operators.integerPower a b))

integerOr :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerOr a b = chargeOperation (max (byteWidth a) (byteWidth b)) >> pure (Operators.integerOr a b)

integerAnd :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerAnd a b = chargeOperation (max (byteWidth a) (byteWidth b)) >> pure (Operators.integerAnd a b)

integerXor :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerXor a b = chargeOperation (max (byteWidth a) (byteWidth b)) >> pure (Operators.integerXor a b)

integerShiftLeft :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerShiftLeft a b = chargeOperation (byteWidth a + b) >> pure (Operators.integerShiftLeft a b)

integerShiftRight :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerShiftRight a b = chargeOperation (byteWidth a) >> pure (Operators.integerShiftRight a b)

integerUnsignedShiftRight :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerUnsignedShiftRight a b = chargeOperation (byteWidth a) >> pure (Operators.integerUnsignedShiftRight a b)

integerDivideAssign :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerDivideAssign a b = chargeOperation (max (byteWidth a) (byteWidth b)) >> liftIO (evaluate (Operators.integerDivide a b))

decimalAdd :: MonadBuiltinGas m => Decimal -> Decimal -> m Decimal
decimalAdd a b = chargeOperation (fromIntegral (max (decimalPlaces a) (decimalPlaces b)) + 1 + max (byteWidth (decimalMantissa a)) (byteWidth (decimalMantissa b))) >> pure (Operators.decimalAdd a b)

decimalIntegerAdd :: MonadBuiltinGas m => Decimal -> Integer -> m Decimal
decimalIntegerAdd a b = chargeOperation (fromIntegral (decimalPlaces a) + 1 + max (byteWidth (decimalMantissa a)) (byteWidth (b))) >> pure (Operators.decimalIntegerAdd a b)

integerDecimalAdd :: MonadBuiltinGas m => Integer -> Decimal -> m Decimal
integerDecimalAdd a b = chargeOperation (fromIntegral (decimalPlaces b) + 1 + max (byteWidth (a)) (byteWidth (decimalMantissa b))) >> pure (Operators.integerDecimalAdd a b)

decimalSubtract :: MonadBuiltinGas m => Decimal -> Decimal -> m Decimal
decimalSubtract a b = chargeOperation (fromIntegral (max (decimalPlaces a) (decimalPlaces b)) + 1 + max (byteWidth (decimalMantissa a)) (byteWidth (decimalMantissa b))) >> pure (Operators.decimalSubtract a b)

decimalIntegerSubtract :: MonadBuiltinGas m => Decimal -> Integer -> m Decimal
decimalIntegerSubtract a b = chargeOperation (fromIntegral (decimalPlaces a) + 1 + max (byteWidth (decimalMantissa a)) (byteWidth (b))) >> pure (Operators.decimalIntegerSubtract a b)

integerDecimalSubtract :: MonadBuiltinGas m => Integer -> Decimal -> m Decimal
integerDecimalSubtract a b = chargeOperation (fromIntegral (decimalPlaces b) + 1 + max (byteWidth (a)) (byteWidth (decimalMantissa b))) >> pure (Operators.integerDecimalSubtract a b)

decimalMultiply :: MonadBuiltinGas m => Decimal -> Decimal -> m Decimal
decimalMultiply a b = chargeOperation (fromIntegral (max (decimalPlaces a) (decimalPlaces b)) + byteWidth (decimalMantissa a) + byteWidth (decimalMantissa b)) >> pure (Operators.decimalMultiply a b)

decimalIntegerMultiply :: MonadBuiltinGas m => Decimal -> Integer -> m Decimal
decimalIntegerMultiply a b = chargeOperation (fromIntegral (decimalPlaces a) + byteWidth (decimalMantissa a) + byteWidth (b)) >> pure (Operators.decimalIntegerMultiply a b)

integerDecimalMultiply :: MonadBuiltinGas m => Integer -> Decimal -> m Decimal
integerDecimalMultiply a b = chargeOperation (fromIntegral (decimalPlaces b) + byteWidth (a) + byteWidth (decimalMantissa b)) >> pure (Operators.integerDecimalMultiply a b)

decimalDivide :: MonadBuiltinGas m => Decimal -> Decimal -> m Decimal
decimalDivide a b = chargeOperation (fromIntegral (max (decimalPlaces a) (decimalPlaces b)) + max (byteWidth (decimalMantissa a)) (byteWidth (decimalMantissa b))) >> liftIO (evaluate (Operators.decimalDivide a b))

decimalDivideAssign :: MonadBuiltinGas m => Decimal -> Decimal -> m Decimal
decimalDivideAssign a b = chargeOperation (fromIntegral (max (decimalPlaces a) (decimalPlaces b)) + max (byteWidth (decimalMantissa a)) (byteWidth (decimalMantissa b))) >> liftIO (evaluate (Operators.decimalDivide a b))

decimalIntegerDivide :: MonadBuiltinGas m => Decimal -> Integer -> m Decimal
decimalIntegerDivide a b = chargeOperation (fromIntegral (decimalPlaces a) + byteWidth (decimalMantissa a)) >> liftIO (evaluate (Operators.decimalIntegerDivide a b))

decimalIntegerDivideAssign :: MonadBuiltinGas m => Decimal -> Integer -> m Decimal
decimalIntegerDivideAssign a b = chargeOperation (fromIntegral (decimalPlaces a) + max (byteWidth (decimalMantissa a)) (byteWidth (b))) >> liftIO (evaluate (Operators.decimalIntegerDivide a b))

integerDecimalDivide :: MonadBuiltinGas m => Integer -> Decimal -> m Decimal
integerDecimalDivide a b = chargeOperation (fromIntegral (decimalPlaces b) + byteWidth (a)) >> liftIO (evaluate (Operators.integerDecimalDivide a b))

integerDecimalDivideAssign :: MonadBuiltinGas m => Integer -> Decimal -> m Decimal
integerDecimalDivideAssign a b = chargeOperation (fromIntegral (decimalPlaces b) + max (byteWidth (a)) (byteWidth (decimalMantissa b))) >> liftIO (evaluate (Operators.integerDecimalDivide a b))

decimalRemainder :: MonadBuiltinGas m => Decimal -> Decimal -> m Decimal
decimalRemainder a b = chargeOperation (fromIntegral (max (decimalPlaces a) (decimalPlaces b)) + byteWidth (decimalMantissa b)) >> liftIO (evaluate (Operators.decimalRemainder a b))

decimalIntegerRemainder :: MonadBuiltinGas m => Decimal -> Integer -> m Decimal
decimalIntegerRemainder a b = chargeOperation (fromIntegral (decimalPlaces a) + byteWidth (b)) >> liftIO (evaluate (Operators.decimalIntegerRemainder a b))

integerDecimalRemainder :: MonadBuiltinGas m => Integer -> Decimal -> m Decimal
integerDecimalRemainder a b = chargeOperation (fromIntegral (decimalPlaces b) + byteWidth (decimalMantissa b)) >> liftIO (evaluate (Operators.integerDecimalRemainder a b))

stringAdd :: MonadBuiltinGas m => String -> String -> m String
stringAdd a b = chargeOperation (fromIntegral (length a + length b)) >> pure (Operators.stringAdd a b)

textAdd :: MonadBuiltinGas m => T.Text -> T.Text -> m T.Text
textAdd a b = chargeOperation (fromIntegral (T.length a + T.length b)) >> pure (Operators.textAdd a b)

bytesAdd :: MonadBuiltinGas m => B.ByteString -> B.ByteString -> m B.ByteString
bytesAdd a b = chargeOperation (fromIntegral (B.length a + B.length b)) >> pure (Operators.bytesAdd a b)

integerShiftLeftAssign :: MonadBuiltinGas m => Integer -> Integer -> m Integer
integerShiftLeftAssign a b = chargeOperation (byteWidth a + b) >> pure (Operators.integerShiftLeftAssign a b)

checkDivisor :: (MonadIO m, Eq a, Num a, Show a) => a -> m ()
checkDivisor = liftIO . evaluate . Operators.checkDivisor
