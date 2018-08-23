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
  , nmap1
  , nmap2
  , nmap1'
  , nmap2'
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

nmap :: (a -> b -> c) -> NamedMap k a v b -> [c]
nmap f = map (uncurry f . toTuple)

nmap1 :: (a -> c) -> NamedMap k a v b -> [c]
nmap1 f = map (f . fst . (toTuple :: NamedTuple k a v b -> (a,b)))

nmap2 :: (b -> c) -> NamedMap k a v b -> [c]
nmap2 f = map (f . snd . (toTuple :: NamedTuple k a v b -> (a,b)))

nmap1' :: NamedMap k a v b -> [a]
nmap1' = nmap1 id

nmap2' :: NamedMap k a v b -> [b]
nmap2' = nmap2 id
