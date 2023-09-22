{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE NoDeriveAnyClass #-}

module Blockchain.Strato.Model.MicroTime where

import Blockchain.Strato.Model.PositiveInteger
import qualified Data.Binary as Binary
import Data.Data
import Data.Time.Clock.POSIX (POSIXTime, getPOSIXTime)
import Test.QuickCheck
import Test.QuickCheck.Instances ()

newtype Microtime = Microtime Integer deriving (Read, Show, Eq, Ord, Num, Enum, Real, Integral, Data, Typeable)

posixTimeToMicrotime :: POSIXTime -> Microtime
posixTimeToMicrotime = Microtime . round . (* 1000000)

secondsToMicrotime :: Integer -> Microtime
secondsToMicrotime = Microtime . (* 1000000)

getCurrentMicrotime :: IO Microtime
getCurrentMicrotime = posixTimeToMicrotime <$> getPOSIXTime

instance Binary.Binary Microtime where
  get = Microtime <$> Binary.get
  put (Microtime a) = Binary.put a

instance Arbitrary Microtime where
  arbitrary = (Microtime . unboxPI) <$> (arbitrary :: Gen PositiveInteger)
