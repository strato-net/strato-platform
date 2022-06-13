{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE NoDeriveAnyClass #-}

module Blockchain.Util
  ( module Blockchain.Util
  , module Blockchain.Strato.Model.Util
  ) where

import           Data.Data
import qualified Data.Map.Strict          as M
import           Data.Maybe

import           Blockchain.Strato.Model.Util

import           Data.Time.Clock.POSIX    (POSIXTime, getPOSIXTime)

import qualified Data.Binary              as Binary

toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
partitionWith f = M.toList . foldr builder M.empty
  where builder a = M.alter (Just . (a:) . fromMaybe []) (f a)

splitWith :: Eq k => (a -> k) -> [a] -> [(k, [a])]
splitWith f = foldr agg []
  where agg a [] = [(f a, [a])]
        agg a kas@((k, as):kas') =
          let fa = f a
           in if fa == k
                then (k, a:as):kas'
                else (fa, [a]):kas

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

