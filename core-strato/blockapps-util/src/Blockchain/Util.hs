{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE NoDeriveAnyClass #-}

module Blockchain.Util where

import qualified Data.Map.Strict          as M
import           Data.Maybe

toMaybe :: Eq a => a -> a -> Maybe a
toMaybe a b = if a == b then Nothing else Just b

partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
partitionWith f = M.toList . foldr builder M.empty
  where builder a = M.alter (Just . (a:) . fromMaybe []) (f a)

