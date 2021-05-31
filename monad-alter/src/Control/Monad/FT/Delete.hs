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

module Control.Monad.FT.Delete
  ( Deletable(..)
  , Deletes
  ) where

import           Data.Foldable               (traverse_)

{- The Deletable Typeclass
  `Deletable k a f` is a typeclass used to generalize the Data.Map function `delete` to any monad f.
  The class has three type parameters:
    k - the key type, like the `k` in `Map k a`
    a - the value type, like the `a` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
  Use this typeclass instead of `Alterable` when `delete` functionality is all that is needed.
  NB: This typeclass may not be useful in real-world applications, but is provided for completeness.
  TODO: implement a `deleteMany` function, analogous to `deleteMany`.
-}
class Monad f => Deletable a k f where

  {- delete
     Delete the corresponding entry for the key `k` in the underlying monad `f`
  -}
  delete :: k -> f ()
  default delete :: k -> f ()
  delete k = deleteMany @a [k]

  {- deleteMany
     Take a list of keys, and delete the corresponding entries in the underlying monad `f`.
     The default instance is implemented as the list version of `delete`.
  -}
  deleteMany :: [k] -> f ()
  default deleteMany :: [k] -> f ()
  deleteMany = traverse_ (delete @a)

  {-# MINIMAL delete | deleteMany #-}

type Deletes k a = Deletable a k