integerAdd :: Integer -> Integer -> M Integer
integerAdd a b = chargeOp (1 + max (byteWidth a) (byteWidth b)) >> pure (a + b)

integerSubtract :: Integer -> Integer -> M Integer
integerSubtract a b = chargeOp (1 + max (byteWidth a) (byteWidth b)) >> pure (a - b)

integerMultiply :: Integer -> Integer -> M Integer
integerMultiply a b = chargeOp (byteWidth a + byteWidth b) >> pure (a * b)

integerDivide :: Integer -> Integer -> M Integer
integerDivide a b = chargeOp (byteWidth a) >> if b == 0 then revert "division by zero" else pure (a `div` b)

integerRemainder :: Integer -> Integer -> M Integer
integerRemainder a b = chargeOp (byteWidth b) >> if b == 0 then revert "modulo by zero" else pure (a `rem` b)

integerPower :: Integer -> Integer -> M Integer
integerPower a b = chargeOp (byteWidth a * b) >> if b < 0 then revert "negative exponent" else pure (a ^ b)

integerOr :: Integer -> Integer -> M Integer
integerOr a b = chargeOp (max (byteWidth a) (byteWidth b)) >> pure (a .|. b)

integerAnd :: Integer -> Integer -> M Integer
integerAnd a b = chargeOp (max (byteWidth a) (byteWidth b)) >> pure (a .&. b)

integerXor :: Integer -> Integer -> M Integer
integerXor a b = chargeOp (max (byteWidth a) (byteWidth b)) >> pure (xor a b)

integerShiftLeft :: Integer -> Integer -> M Integer
integerShiftLeft a b = chargeOp (byteWidth a + b) >> pure (shiftL a (fromIntegral b))

integerShiftRight :: Integer -> Integer -> M Integer
integerShiftRight a b = chargeOp (byteWidth a) >> pure (shiftR a (fromIntegral b))
