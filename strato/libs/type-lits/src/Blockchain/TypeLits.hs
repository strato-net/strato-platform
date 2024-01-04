{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveTraversable #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE KindSignatures #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.TypeLits
  ( NamedTuple (..),
    NamedTupleParser,
    NamedMap,
    NamedMapParser,
    module GHC.TypeLits,
    nmap,
    nmap1,
    nmap2,
    nmap1',
    nmap2',
  )
where

import Control.Comonad
import Data.Aeson
import qualified Data.Aeson.Key as DAK
import Data.Aeson.Types (Parser)
import Data.Biapplicative
import Data.Bifoldable
import Data.Bitraversable
import Data.Proxy
import qualified Data.Text as Text
import GHC.Generics
import GHC.TypeLits
import Test.QuickCheck hiding (Failure, Success)

newtype NamedTuple (k :: Symbol) (v :: Symbol) a b = NamedTuple {unNamedTuple :: (a, b)}
  deriving stock (Eq, Ord, Show, Generic, Functor, Foldable, Traversable)
  deriving newtype (Applicative, Bifunctor, Biapplicative, Bifoldable, Comonad)
  --deriving (Bitraversable)

type NamedTupleParser k v a b = Parser (NamedTuple k v a b)

type NamedMap k v a b = [NamedTuple k v a b]

type NamedMapParser k v a b = Parser (NamedMap k v a b)

instance forall k a v b. (KnownSymbol k, KnownSymbol v, ToJSON a, ToJSON b) => ToJSON (NamedTuple k v a b) where
  toJSON (NamedTuple (a, b)) =
    object
      [ (DAK.fromText . Text.pack $ symbolVal (Proxy :: Proxy k)) .= toJSON a,
        (DAK.fromText . Text.pack $ symbolVal (Proxy :: Proxy v)) .= toJSON b
      ]

instance forall k a v b. (KnownSymbol k, KnownSymbol v, FromJSON a, FromJSON b) => FromJSON (NamedTuple k v a b) where
  parseJSON (Object o) =
    NamedTuple
      <$> liftA2
        (,)
        (o .: (DAK.fromText . Text.pack $ symbolVal (Proxy :: Proxy k)))
        (o .: (DAK.fromText . Text.pack $ symbolVal (Proxy :: Proxy v)))
  parseJSON o = error $ "parseJSON NamedTuple: expected object, got " ++ show o


instance Bitraversable (NamedTuple k v) where
    bitraverse f g (NamedTuple (a, b)) = NamedTuple <$> liftA2 (,) (f a) (g b)


instance forall k a v b. (KnownSymbol k, KnownSymbol v, Arbitrary a, Arbitrary b) => Arbitrary (NamedTuple k v a b) where
  arbitrary = NamedTuple <$> (liftA2 (,) arbitrary arbitrary :: Gen (a, b))

nmap :: (a -> b -> c) -> NamedMap k v a b -> [c]
nmap f = map (uncurry f . unNamedTuple)

nmap1 :: (a -> c) -> NamedMap k v a b -> [c]
nmap1 f = map (f . fst . unNamedTuple)

nmap2 :: (b -> c) -> NamedMap k v a b -> [c]
nmap2 f = map (f . snd . unNamedTuple)

nmap1' :: NamedMap k v a b -> [a]
nmap1' = nmap1 id

nmap2' :: NamedMap k v a b -> [b]
nmap2' = nmap2 id
