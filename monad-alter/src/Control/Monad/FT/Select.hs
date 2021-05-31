{-# LANGUAGE AllowAmbiguousTypes   #-}
{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE DefaultSignatures     #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RankNTypes            #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeOperators         #-}

module Control.Monad.FT.Select
  ( Selectable(..)
  , Selects
  , selectWithDefault
  , selectWithMempty
  , catMaybes
  ) where

import           Control.Monad
import           Data.Default
import           Data.Maybe

{- The Selectable Typeclass
  `Selectable k a f` is a typeclass used to generalize the Data.Map function `select` to any monad f.
  The class has three type parameters:
    a - the value type, like the `a` in `Map k a`
    k - the key type, like the `k` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
-}
class Monad f => Selectable a k f where
  {- select
     Select the corresponding value for a given key `k` in the underlying monad `f`
     This function is analogous to the `select` function in `Alterable`
  -}
  select :: k -> f (Maybe a)
  default select :: k -> f (Maybe a)
  select k = join . listToMaybe . map snd <$> selectMany [k]

  {- selectMany
     Take a list of keys, and return a `[(k, Maybe a)]` of the keys and their values existing in the
     underlying type constructor `f`.
  -}
  selectMany :: [k] -> f [(k, Maybe a)]
  default selectMany :: [k] -> f [(k, Maybe a)]
  selectMany = traverse (\k -> (k,) <$> select k)

  {-# MINIMAL select | selectMany #-}

  {- selectWithFallback
     Select the corresponding value for a given key `k` in the underlying monad `f`,
     and return a supplied default value if the entry for key `k` is not found.
  -}
  selectWithFallback :: a -> k -> f a
  default selectWithFallback :: a -> k -> f a
  selectWithFallback a k = fromMaybe a <$> select k

  {- exists
     Returns a Bool representing whether the entry for a given key `k` exists in the
     underlying monad `f`. Although this is trivially implemented as `isJust <$> select p k`,
     in cases where the backend can make this determination without returning the value itself,
     utilizing this capability can be substantially more performant for large values.
  -}
  exists :: k -> f Bool
  default exists :: k -> f Bool
  exists k = isJust <$> select @a k

type Selects k a = Selectable a k

selectWithDefault :: (Default a, (k `Selects` a) f) => k -> f a
selectWithDefault = selectWithFallback def

selectWithMempty :: (Monoid a, (k `Selects` a) f) => k -> f a
selectWithMempty = selectWithFallback mempty