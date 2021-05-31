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

module Control.Monad.FT.Alter
  ( Alterable(..)
  , Alters
  , adjustWithDefault
  , adjustWithDefault_
  , adjustWithDefaultStatefully
  , adjustWithDefaultStatefully_
  , adjustWithMempty
  , adjustWithMempty_
  , adjustWithMemptyStatefully
  , adjustWithMemptyStatefully_
  , module Control.Monad.FT.Select
  , module Control.Monad.FT.Insert
  , module Control.Monad.FT.Delete
  ) where

import           Control.Monad
import           Control.Monad.FT.Delete
import           Control.Monad.FT.Insert
import           Control.Monad.FT.Select
import           Control.Monad.Trans.State   (evalStateT, execStateT, StateT)
import           Data.Default
import           Data.Maybe

type M k a = [(k, Maybe a)]

{- The Alterable Typeclass
  Alterable a k f is a typeclass used to generalize Data.Map-like functions to any type constructor f.
  The class has three type parameters:
    a - the value type, like the `a` in `Map k a`
    k - the key type, like the `k` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
  Alterable a k f allows reusable code to be written for different contexts. For example,
  instances can be written for production monads, using calls to external databases;
  testing monads, where the Map-like structure is held in-memory;
  or hybrids, where the user wishes to implement a sophisticated caching system in-memory,
  and have fallback calls to the database. Using `Alters`, the memory management logic is
  separated from the backend-agnostic business logic.

  The Alterable typeclass contains two basic sets of functions to represent Map-like operations:
  `lookup`, `insert`, and `delete`; and `alter`. Instances of Alterable may choose to implement
  one or both of these sets, depending on the details of the underlying monad. For example,
  if connecting to a simple key-value store, which only supports lookup, insert, and delete,
  it makes sense to only implement those respective functions in the monad's `Alterable` instance,
  because there is no way to leverage the database's API to optimize more complex functions.
  In this case, the defaults for composite functions like `alter`, `adjust`, and `update` are
  implemented using combinations of `select`, `insert`, and `delete`. However, let's say the
  database we're connecting to supports an update function, which can be called without having
  to retrieve and replace the value associated with a certain key, then it would be more
  efficient to separately implement the `update` or `adjust` functions in the monad's `Alterable`
  instance, rather than using the default, which is the composition of `select` and `insert`.
  Now, let's say the backend supports some more advanced query language, such as SQL, which
  supports complex CRUD operations, as well as functions to modify data in-place. In this case,
  it might make more sense to implement `alter` and/or `alterMany`, instead of, or in addition to,
  the standard `select`, `insert`, and `delete` functions, because `alterMany` may be written as
  a SQL query to update millions of rows in a table, without the Haskell code ever having to see
  that data. This is why all of the functions in the Alterable typeclass are inside the class, rather
  than top-level functions with an `Alterable` constraint.
-}
class ( Monad f
      , Selectable a k f
      , Insertable a k f
      , Deletable  a k f
      )
     => Alterable  a k f where

  {- alterManyReturing
     The most general function that can be applied to a Map-like structure.
     Apply an effectful function to a `[(k, Maybe a)]`, which represents values that
     exist in a `Map k a`, at a given key `k`, and return a `(b, [(k, Maybe a)])`, which represents whether
     to insert the new values in the Map, along with a return value of arbitrary type.
     From `alterManyReturning`, we can derive every other function in the `Alterable` typeclass.
     However, for many cases, defining `alterManyReturning` by itself is not the most
     efficient implementation for the underlying monad.
  -}
  alterManyReturning :: [k] -> (M k a -> f (b, M k a)) -> f b
  default alterManyReturning :: [k] -> (M k a -> f (b, M k a)) -> f b
  alterManyReturning ks f = do
    m <- selectMany ks
    ~(b, m') <- f m
    deleteMany @a $ fst <$> filter (isNothing . snd) m'
    insertMany . catMaybes $ sequence <$> m'
    return b

  {- alterMany
     A version of `alterManyReturning` that returns the result of the operation
  -}
  alterMany :: [k] -> (M k a -> f (M k a)) -> f (M k a)
  default alterMany :: [k] -> (M k a -> f (M k a)) -> f (M k a)
  alterMany ks f = alterManyReturning ks (fmap (\a -> (a,a)) . f)

  {- alterManyReturningPure
     A version of `alterManyReturning` that takes a pure function
  -}
  alterManyReturningPure :: [k] -> (M k a -> (b, M k a)) -> f b
  default alterManyReturningPure :: [k] -> (M k a -> (b, M k a)) -> f b
  alterManyReturningPure ks f = alterManyReturning ks (pure . f)

  {- alterManyPure
     A version of `alterMany` that takes a pure function
  -}
  alterManyPure :: [k] -> (M k a -> M k a) -> f (M k a)
  default alterManyPure :: [k] -> (M k a -> M k a) -> f (M k a)
  alterManyPure ks f = alterMany ks (pure . f)

  {- alterReturning
  -}
  alterReturning :: k -> (Maybe a -> f (b, Maybe a)) -> f b
  default alterReturning :: k -> (Maybe a -> f (b, Maybe a)) -> f b
  alterReturning k f = alterManyReturning [k] $ \m -> do
    ~(b, ma) <- f . join . listToMaybe $ snd <$> m 
    pure (b, [(k, ma)])

  {- alter
     A version of `alterReturning` that returns the result of the operation
  -}
  alter :: k -> (Maybe a -> f (Maybe a)) -> f (Maybe a)
  default alter :: k -> (Maybe a -> f (Maybe a)) -> f (Maybe a)
  alter k f = alterReturning k (fmap (\a -> (a,a)) . f)

  {- alterReturningPure
     A version of `alterReturning` that takes a pure function
  -}
  alterReturningPure :: k -> (Maybe a -> (b, Maybe a)) -> f b
  default alterReturningPure :: k -> (Maybe a -> (b, Maybe a)) -> f b
  alterReturningPure k f = alterReturning k (pure . f)

  {- alterPure
     A version of `alter` that takes a pure function
  -}
  alterPure :: k -> (Maybe a -> Maybe a) -> f (Maybe a)
  default alterPure :: k -> (Maybe a -> Maybe a) -> f (Maybe a)
  alterPure k f = alter k (pure . f)

  {- alter_
     Same as `alter` except it discards the return value.
  -}
  alter_ :: k -> (Maybe a -> f (Maybe a)) -> f ()
  default alter_ :: k -> (Maybe a -> f (Maybe a)) -> f ()
  alter_ k = void . alter k

  {- alterPure_
     Same as `alterPure` except it discards the return value.
  -}
  alterPure_ :: k -> (Maybe a -> Maybe a) -> f ()
  default alterPure_ :: k -> (Maybe a -> Maybe a) -> f ()
  alterPure_ k = void . alterPure k

  {- alterMany_
     Same as `alterMany` except it discards the return value.
  -}
  alterMany_ :: [k] -> (M k a -> f (M k a)) -> f ()
  default alterMany_ :: [k] -> (M k a -> f (M k a)) -> f ()
  alterMany_ ks = void . alterMany ks

  {- alterManyPure_
     Same as `alterManyPure` except it discards the return value.
  -}
  alterManyPure_ :: [k] -> (M k a -> M k a) -> f ()
  default alterManyPure_ :: [k] -> (M k a -> M k a) -> f ()
  alterManyPure_ ks = void . alterManyPure ks

  {- update
     Apply an effectful function on an existing key/value pair in the underlying monad `f`.
     If the entry for key `k` does not exist in the underlying monad beforehand, the function
     is not applied. If the function returns `Nothing`, the entry for key `k` is deleted from
     the underlying monad.
  -}
  update :: k -> (a -> f (Maybe a)) -> f (Maybe a)
  default update :: k -> (a -> f (Maybe a)) -> f (Maybe a)
  update k f = alter k $ \case
    Just a -> f a
    Nothing -> pure Nothing

  {- update_
     Same as `update` except it discards the return value.
  -}
  update_ :: k -> (a -> f (Maybe a)) -> f ()
  default update_ :: k -> (a -> f (Maybe a)) -> f ()
  update_ k = void . update k

  {- updatePure
     A version of `update` that takes a pure function
  -}
  updatePure :: k -> (a -> Maybe a) -> f (Maybe a)
  default updatePure :: k -> (a -> Maybe a) -> f (Maybe a)
  updatePure k f = update k (pure . f)

  {- updatePure_
     Same as `updatePure` except it discards the return value.
  -}
  updatePure_ :: k -> (a -> Maybe a) -> f ()
  default updatePure_ :: k -> (a -> Maybe a) -> f ()
  updatePure_ k = void . updatePure k

  {- updateStatefully
     Same as `update`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  updateStatefully :: k -> StateT a f (Maybe a) -> f (Maybe a)
  default updateStatefully :: k -> StateT a f (Maybe a) -> f (Maybe a)
  updateStatefully k = update k . evalStateT

  {- updateStatefully_
     Same as `updateStatefully` except it discards the return value.
  -}
  updateStatefully_ :: k -> StateT a f (Maybe a) -> f ()
  default updateStatefully_ :: k -> StateT a f (Maybe a) -> f ()
  updateStatefully_ k = void . updateStatefully k

  {- adjust
     Apply an effectful function on an existing key/value pair in the underlying monad `f`.
     If the entry for key `k` does not exist in the underlying monad beforehand, the function
     is not applied. Unlike `update`, `adjust` returns an `a` instead of a `Maybe a`, which
     means that the entry for key `k` cannot be deleted from the underlying monad by calling
     `adjust`.
  -}
  adjust :: k -> (a -> f a) -> f a
  default adjust :: k -> (a -> f a) -> f a
  adjust k f = fromJust <$> update k (fmap Just . f)

  {- adjust_
     Same as `adjust` except it discards the return value.
  -}
  adjust_ :: k -> (a -> f a) -> f ()
  default adjust_ :: k -> (a -> f a) -> f ()
  adjust_ k = void . adjust k

  {- adjustPure
     A version of `adjust` that takes a pure function.
  -}
  adjustPure :: k -> (a -> a) -> f a
  default adjustPure :: k -> (a -> a) -> f a
  adjustPure k f = adjust k (pure . f)

  {- adjustPure_
     Same as `adjustPure` except it discards the return value.
  -}
  adjustPure_ :: k -> (a -> a) -> f ()
  default adjustPure_ :: k -> (a -> a) -> f ()
  adjustPure_ k = void . adjustPure k

  {- adjustStatefully
     Same as `adjust`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  adjustStatefully :: k -> StateT a f () -> f a
  default adjustStatefully :: k -> StateT a f () -> f a
  adjustStatefully k = adjust k . execStateT

  {- adjustStatefully_
     Same as `adjustStatefully` except it discards the return value.
  -}
  adjustStatefully_ :: k -> StateT a f () -> f ()
  default adjustStatefully_ :: k -> StateT a f () -> f ()
  adjustStatefully_ k = void . adjustStatefully k

  {- adjustWithFallback
     Adjust the corresponding value for a given key `k` in the underlying monad `f`,
     If the entry for key `k` does not exist in the underlying monad beforehand, a fallback value
     is passed to the function. This ensures that the entry for key `k` will exist
     in the underlying monad after calling `adjustWithFallback`.
  -}
  adjustWithFallback :: a -> k -> (a -> f a) -> f a
  default adjustWithFallback :: a -> k -> (a -> f a) -> f a
  adjustWithFallback a k f = fromJust <$> alter k (fmap Just . f . fromMaybe a)

  {- adjustWithFallback_
     Same as `adjustWithFallback` except it discards the return value.
  -}
  adjustWithFallback_ :: a -> k -> (a -> f a) -> f ()
  default adjustWithFallback_ :: a -> k -> (a -> f a) -> f ()
  adjustWithFallback_ a k = void . adjustWithFallback a k

  {- adjustWithFallbackStatefully
     Same as `adjustWithFallback`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  adjustWithFallbackStatefully :: a -> k -> StateT a f () -> f a
  default adjustWithFallbackStatefully :: a -> k -> StateT a f () -> f a
  adjustWithFallbackStatefully a k = adjustWithFallback a k . execStateT

  {- adjustWithFallbackStatefully_
     Same as `adjustWithFallbackStatefully` except it discards the return value.
  -}
  adjustWithFallbackStatefully_ :: a -> k -> StateT a f () -> f ()
  default adjustWithFallbackStatefully_ :: a -> k -> StateT a f () -> f ()
  adjustWithFallbackStatefully_ a k = void . adjustWithFallbackStatefully a k

  {- repsert
     Insert a key/value pair into the underlying monad `f`, but use the existing value,
     whether it exists or not, as a parameter to an effectful function to determine
     the new value. This is a generalization of `adjustWith{Default,Mempty}`, where a custom
     value may be supplied if the entry for key `k` doesn't already exist in the underlying
     monad `f`.
  -}
  repsert :: k -> (Maybe a -> f a) -> f a
  default repsert :: k -> (Maybe a -> f a) -> f a
  repsert k f = fromJust <$> alter k (fmap Just . f)

  {- repsert_
     Same as `repsert` except it discards the return value.
  -}
  repsert_ :: k -> (Maybe a -> f a) -> f ()
  default repsert_ :: k -> (Maybe a -> f a) -> f ()
  repsert_ k = void . repsert k

  {- repsertPure
     A version of `repsert` that takes a pure function.
  -}
  repsertPure :: k -> (Maybe a -> a) -> f a
  default repsertPure :: k -> (Maybe a -> a) -> f a
  repsertPure k f = repsert k (pure . f)

  {- repsertPure_
     Same as `repsertPure` except it discards the return value.
  -}
  repsertPure_ :: k -> (Maybe a -> a) -> f ()
  default repsertPure_ :: k -> (Maybe a -> a) -> f ()
  repsertPure_ k = void . repsertPure k

type Alters k a = Alterable a k

adjustWithDefault :: (Default a, (k `Alters` a) f) => k -> (a -> f a) -> f a
adjustWithDefault = adjustWithFallback def

adjustWithDefault_ :: (Default a, (k `Alters` a) f) => k -> (a -> f a) -> f ()
adjustWithDefault_ = adjustWithFallback_ def

adjustWithDefaultStatefully :: (Default a, (k `Alters` a) f) => k -> StateT a f () -> f a
adjustWithDefaultStatefully = adjustWithFallbackStatefully def

adjustWithDefaultStatefully_ :: (Default a, (k `Alters` a) f) => k -> StateT a f () -> f ()
adjustWithDefaultStatefully_ = adjustWithFallbackStatefully_ def

adjustWithMempty :: (Monoid a, (k `Alters` a) f) => k -> (a -> f a) -> f a
adjustWithMempty = adjustWithFallback mempty

adjustWithMempty_ :: (Monoid a, (k `Alters` a) f) => k -> (a -> f a) -> f ()
adjustWithMempty_ = adjustWithFallback_ mempty

adjustWithMemptyStatefully :: (Monoid a, (k `Alters` a) f) => k -> StateT a f () -> f a
adjustWithMemptyStatefully = adjustWithFallbackStatefully mempty

adjustWithMemptyStatefully_ :: (Monoid a, (k `Alters` a) f) => k -> StateT a f () -> f ()
adjustWithMemptyStatefully_ = adjustWithFallbackStatefully_ mempty