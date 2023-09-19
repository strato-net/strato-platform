--{-# LANGUAGE GeneralizedNewtypeDeriving #-}
--{-# LANGUAGE DeriveDataTypeable         #-}
--{-# LANGUAGE NoDeriveAnyClass #-}

module Blockchain.Partitioner where

import qualified Data.Map.Strict as M
import Data.Maybe

partitionWith :: Ord k => (a -> k) -> [a] -> [(k, [a])]
partitionWith f = M.toList . foldr builder M.empty
  where
    builder a = M.alter (Just . (a :) . fromMaybe []) (f a)
