{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PolyKinds         #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module API.Parametric where

import           Data.Kind
import           Data.Text
import           GHC.TypeLits
import           Servant.API

data APIP
data ClientP
data ServerP

type family Embed (d :: Type) (hs :: [Type]) (ns :: [Symbol]) (r :: Type) :: Type where
  Embed APIP r '[x] rest = Header' r x Text :> rest
  Embed ClientP '[Required, Strict] '[x] rest = Text -> rest
  Embed ClientP r '[x] rest = Maybe Text -> rest
  Embed ServerP '[Required, Strict] '[x] rest = Text -> rest
  Embed ServerP r '[x] rest = Maybe Text -> rest
  Embed APIP r (x ': ns) rest = Header' r x Text :> Embed APIP r ns rest
  Embed ClientP '[Required, Strict] (x ': ns) rest = Text -> Embed ClientP '[Required, Strict] ns rest
  Embed ClientP r (x ': ns) rest = Maybe Text -> Embed ClientP r ns rest
  Embed ServerP '[Required, Strict] (x ': ns) rest = Text -> Embed ServerP '[Required, Strict] ns rest
  Embed ServerP r (x ': ns) rest = Maybe Text -> Embed ServerP r ns rest

type ApiEmbed  r xs rest = Embed APIP    r                   xs rest
type ClientEmbed xs rest = Embed ClientP '[Optional, Strict] xs rest
type ServerEmbed xs rest = Embed ServerP '[Required, Strict] xs rest

type InternalHeaders = '["X-USER-ACCESS-TOKEN"]
type ExternalHeaders = '["Authorization"]