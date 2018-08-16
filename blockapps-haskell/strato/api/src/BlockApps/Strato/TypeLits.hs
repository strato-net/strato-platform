{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE KindSignatures        #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE ScopedTypeVariables   #-}

module BlockApps.Strato.TypeLits
  ( NamedTuple(..)
  , NamedTupleParser
  , NamedMap
  , NamedMapParser
  , IsTuple(..)
  , module GHC.TypeLits
  , nmap
  ) where

import           Control.Applicative (liftA2)
import           Data.Aeson
import           Data.Aeson.Types    (Parser)
import           Data.Proxy
import qualified Data.Text           as Text
import           GHC.Generics
import           GHC.TypeLits
import           Test.QuickCheck     hiding (Success, Failure)

data NamedTuple (k :: Symbol) a (v :: Symbol) b = NamedTuple (a,b)
  deriving (Eq, Ord, Show, Generic)

type NamedTupleParser k a v b = Parser (NamedTuple k a v b)

type NamedMap k a v b = [NamedTuple k a v b]

type NamedMapParser k a v b = Parser (NamedMap k a v b)

class IsTuple t a b where
  fromTuple :: (a,b) -> t
  toTuple :: t -> (a,b)

instance IsTuple (NamedTuple k a v b) a b where
  fromTuple = NamedTuple
  toTuple (NamedTuple t) = t

instance forall k a v b. (KnownSymbol k, KnownSymbol v, ToJSON a, ToJSON b) => ToJSON (NamedTuple k a v b) where
  toJSON (NamedTuple (a,b)) =
    object [ (Text.pack $ symbolVal (Proxy :: Proxy k)) .= toJSON a
           , (Text.pack $ symbolVal (Proxy :: Proxy v)) .= toJSON b
           ]

instance forall k a v b. (KnownSymbol k, KnownSymbol v, FromJSON a, FromJSON b) => FromJSON (NamedTuple k a v b) where
  parseJSON (Object o) = NamedTuple
                     <$> liftA2 (,)
                         (o .: (Text.pack $ symbolVal (Proxy :: Proxy k)))
                         (o .: (Text.pack $ symbolVal (Proxy :: Proxy v)))
  parseJSON o          = error $ "parseJSON NamedTuple: expected object, got " ++ show o

instance forall k a v b. (KnownSymbol k, KnownSymbol v, Arbitrary a, Arbitrary b) => Arbitrary (NamedTuple k a v b) where
  arbitrary = fromTuple <$> (liftA2 (,) arbitrary arbitrary :: Gen (a,b))

nmap :: ((a,b) -> (c,d)) -> NamedMap k a v b -> NamedMap k c v d
nmap f = map (fromTuple . f . toTuple)
