{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE GADTs               #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.TypeLits where

import GHC.TypeLits
import Data.Aeson

data NamedTuple (k :: Symbol) a (v :: Symbol) b = NamedTuple (a,b)

-- class IsTuple t a b where
--   fromTuple :: (a,b) -> t
--   toTuple :: t -> (a,b)

-- instance IsTuple (NamedTuple a b) where
--   fromTuple = NamedTuple
--   toTuple (NamedTuple t) = t

instance forall k a v b. (KnownSymbol k, KnownSymbol v, ToJSON a, ToJSON b) => ToJSON (NamedTuple k a v b) where
  toJSON (NamedTuple (a,b)) =
    object [ (Text.pack (symbolVal (Proxy :: Proxy k))) .= toJSON a
           , (Text.pack (symbolVal (Proxy :: Proxy v))) .= toJSON b
           ]

-- TODO: Figure out FromJSON
