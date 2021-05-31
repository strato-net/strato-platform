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

module Control.Monad.FT.Insert
  ( Insertable(..)
  , Inserts
  ) where

import           Data.Foldable               (traverse_)

{- The Insertable Typeclass
  `Insertable k a f` is a typeclass used to generalize the Data.Map function `insert` to any monad f.
  The class has three type parameters:
    k - the key type, like the `k` in `Map k a`
    a - the value type, like the `a` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
  Use this typeclass instead of `Alterable` when `insert` functionality is all that is needed.
  NB: This typeclass may not be useful in real-world applications, but is provided for completeness.
-}
class Monad f => Insertable a k f where
  {- insert
     Insert the corresponding key/value pair in the underlying monad `f`
  -}
  insert :: k -> a -> f ()
  default insert :: k -> a -> f ()
  insert k a = insertMany [(k, a)]

  {- insertMany
     Take a `Map k a`, and insert/overwrite its entries in the underlying monad `f`.
     The default instance is implemented as the list version of `insert`.
  -}
  insertMany :: [(k, a)] -> f ()
  default insertMany :: [(k, a)] -> f ()
  insertMany = traverse_ (uncurry insert)
  
  {-# MINIMAL insert | insertMany #-}

type Inserts k a = Insertable a k