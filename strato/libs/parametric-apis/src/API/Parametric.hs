{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PolyKinds         #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}
{-# LANGUAGE UndecidableInstances #-}

module API.Parametric
  ( module Data.Proxy
  , module GHC.TypeLits
  , ApiEmbed
  , ClientEmbed
  , ServerEmbed
  , InternalHeaders
  , ExternalHeaders
  , All
  , HeaderList
  , ServerEmbeddable(..)
  , getHeader
  ) where

import           Data.Kind
import           Data.Proxy
import           Data.Text
import           GHC.TypeLits
import           Servant.API

data WebType = APIP | ClientP | ServerP

type family Embed (d :: WebType) (hs :: [Type]) (ns :: [Symbol]) (r :: Type) :: Type where
  Embed APIP    _                   '[]       rest = rest
  Embed APIP    r                   (x ': ns) rest = Header' r x Text :> Embed APIP r ns rest
  Embed ClientP _                   '[]       rest = rest
  Embed ClientP '[Required, Strict] (x ': ns) rest = Text -> Embed ClientP '[Required, Strict] ns rest
  Embed ClientP r                   (x ': ns) rest = Maybe Text -> Embed ClientP r ns rest
  Embed ServerP _                   '[]       rest = rest
  Embed ServerP '[Required, Strict] (x ': ns) rest = Text -> Embed ServerP '[Required, Strict] ns rest
  Embed ServerP r                   (x ': ns) rest = Maybe Text -> Embed ServerP r ns rest

type ApiEmbed  r xs rest = Embed APIP    r                   xs rest
type ClientEmbed xs rest = Embed ClientP '[Optional, Strict] xs rest
type ServerEmbed xs rest = Embed ServerP '[Required, Strict] xs rest

type InternalHeaders = '["X-USER-ACCESS-TOKEN"]
type ExternalHeaders = '["Authorization"]

type family All (f :: k -> Constraint) (ks :: [k]) :: Constraint where
  All f (k ': '[]) = f k
  All f (k ': ks)  = (f k, All f ks)

type HeaderList = [(Text, Text)]

class ServerEmbeddable (hs :: [Symbol]) where
  embedServer :: Proxy hs -> (HeaderList -> a) -> ServerEmbed hs a

instance ServerEmbeddable '[] where
  embedServer _ f = f []

instance (KnownSymbol h, ServerEmbeddable hs) => ServerEmbeddable (h ': hs) where
  embedServer _ f = \t -> embedServer (Proxy :: Proxy hs) (f . ((pack $ symbolVal (Proxy :: Proxy h), t) :))

getHeader :: Text -> HeaderList -> Maybe Text
getHeader _ [] = Nothing
getHeader p ((k, v) : r) = if p == k then Just v else getHeader p r