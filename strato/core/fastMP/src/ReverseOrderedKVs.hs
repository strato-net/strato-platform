module ReverseOrderedKVs
  ( ReverseOrderedKVs, --we must not export the constructor....  you should only be allowed to make a ReverseOrderedKVs using the following funcitons
    orderTheKVs,
    iPromiseTheseKVsAreOrdered,
    getTheKVs,
  )
where

import Data.Function
import Data.List
import KV

newtype ReverseOrderedKVs = ReverseOrderedKVs [KV] deriving (Show)

orderTheKVs :: [KV] -> ReverseOrderedKVs
orderTheKVs kvs = ReverseOrderedKVs $ sortBy (flip compare `on` theKey) kvs

iPromiseTheseKVsAreOrdered :: [KV] -> ReverseOrderedKVs
iPromiseTheseKVsAreOrdered kvs = ReverseOrderedKVs kvs

getTheKVs :: ReverseOrderedKVs -> [KV]
getTheKVs (ReverseOrderedKVs kvs) = kvs
