module Blockchain.Strato.Model.PositiveInteger where

import Test.QuickCheck

data PositiveInteger = PositiveInteger Integer deriving (Eq, Ord, Show, Read)

unboxPI :: PositiveInteger -> Integer
unboxPI (PositiveInteger n) = n

positiveIntegerMax :: Integer
positiveIntegerMax = 99999999

instance Arbitrary PositiveInteger where
  arbitrary = PositiveInteger . abs <$> arbitrary
