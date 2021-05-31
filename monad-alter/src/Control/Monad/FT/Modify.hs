{-# LANGUAGE DefaultSignatures     #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE TypeOperators         #-}

module Control.Monad.FT.Modify
  ( Modifiable(..)
  , module Control.Monad.FT.Get
  , module Control.Monad.FT.Put
  ) where

import           Control.Monad                    (void)
import           Control.Monad.FT.Get
import           Control.Monad.FT.Put
import           Control.Monad.Trans.State        (execStateT, runStateT, StateT)

{- The Modifiable Typeclass
  `Modifiable a f` is a typeclass used to generalize Control.Monad.State-like functions to any monad f.
  The class has two type parameters:
    a - the state type, like the `s` in `State s a`
    f - the underlying monad, such as `State s a`
  `Modifiable a f` allows reusable code to be written for different contexts. For example,
  instances can be written for production monads, using calls to external databases;
  testing monads, where the Map-like structure is held in-memory;
  or hybrids, where the user wishes to implement a sophisticated caching system in-memory,
  and have fallback calls to the database. Using `Modifiable`, the memory management logic is
  separated from the backend-agnostic business logic.

  The Modifiable typeclass contains two basic sets of functions to represent State-like operations:
  `get` and `put`; and `modify`. Instances of Modifiable may choose to implement
  one or both of these sets, depending on the details of the underlying monad. For example,
  if connecting to a simple key-value store, which only supports get and put operations,
  it makes sense to only implement those respective functions in the monad's `Modifiable` instance,
  because there is no way to leverage the database's API to optimize the `modify` function.
  In this case, the defaults for `modify` is implemented using the composition of `get` and `put`.
  However, let's say the database we're connecting to supports an update function, which can be
  called without having to retrieve and replace the value associated with a certain key, then it
  would be more efficient to separately implement the `modify` function in the monad's `Modifiable`
  instance, rather than using the default.

  The Modifiable typeclass is essentially the same as the `MonadState` typeclass from the mtl library,
  without the functional dependency between the state type and the monad. To understand why this is
  desirable, consider the monad `State (Int, String)`. The state type is `(Int, String)`. The `MonadState`
  instance of this monad can only `get`, `put`, and `modify` both elements of the pair at once.
  If we know that our monad will always be memory-bound, this constraint is ok, because we can use
  lenses to operate on individual elements, and lazy evaluation prevents the entire data structure
  from being copied everytime. In this way, we can generalize all our `a -> State (Int, String) b`
  functions to be of type `MonadState (Int, String) m => a -> m b`. However, what if our monad was
  retrieving this data from an external data store? Using `MonadState` in this case would require us
  to retrieve both the `Int` and `String` components of our state each time we want to operate on it.
  In a larger, more complex monad, this can lead to a lot of overhead.
  Instead of writing our functions as `MonadState (Int, String) m => a -> m b`, we can now write them
  as `Modifiable (Int, String) m => a -> m b`, or, even better,
  `(Modifiable Int m, Modifiable String m) => a -> m b`. Despite the longer type signature for the
  function, the constraints are now decoupled from each other, and child functions can be written
  using a subset of these constraints. For example, we can write
  ```
    updateRecord :: (Modifiable Int m, Modifiable String m) => Int -> String -> m ()
    updateRecord i s = updateInt i >> updateString s
      where
        updateInt :: Modifiable Int m => Int -> m ()
        updateInt i = put (Proxy @Int) i

        updateString :: Modifiable String m => String -> m ()
        updateString i = put (Proxy @String) i
  ```

  Using `MonadState`, not only would we have to carry the constraint on both `Int` and `String` into both
  `updateInt` and `updateString`, we'd have to call `get` in both, because we'd have to retrieve the
  other half of the state to preserve it.
-}
class ( Monad f
      , Gettable a f
      , Puttable a f
      )
     => Modifiable a f where
  {- modifyReturning
     The most general function that can be applied to a State-like monad.
     Apply an effectful function to a state value `a`, and return the new value.
     From `modifyReturning`, we can derive every other function in the `Modifiable` typeclass.
     However, for many cases, defining `modifyReturning` by itself is not the most
     efficient implementation for the underlying monad.
  -}
  modifyReturning :: (a -> f (b, a)) -> f b
  default modifyReturning :: (a -> f (b, a)) -> f b
  modifyReturning f = get >>= f >>= \ba -> put (snd ba) >> return (fst ba)

  {- modify
     Version of modifyReturning that returns the result of the modification function.
  -}
  modify :: (a -> f a) -> f a
  default modify :: (a -> f a) -> f a
  modify f = modifyReturning (fmap (\a -> (a, a)) . f)

  {- modifyReturningPure
     Version of modifyReturning that takes a pure function instead of an effectful function.
  -}
  modifyReturningPure :: (a -> (b, a)) -> f b
  default modifyReturningPure :: (a -> (b, a)) -> f b
  modifyReturningPure f = modifyReturning (pure . f)

  {- modifyPure
     Version of modify that takes a pure function instead of an effectful function.
  -}
  modifyPure :: (a -> a) -> f a
  default modifyPure :: (a -> a) -> f a
  modifyPure f = modify (pure . f)

  {- modify_
     The same as `modify`, but ignore the return value.
  -}
  modify_ :: (a -> f a) -> f ()
  default modify_ :: (a -> f a) -> f ()
  modify_ = void . modify

  {- modifyPure_
     The same as `modify`, but ignore the return value.
  -}
  modifyPure_ :: (a -> a) -> f ()
  default modifyPure_ :: (a -> a) -> f ()
  modifyPure_ = void . modifyPure

  {- modifyReturningStatefully
     Same as `modifyReturing`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  modifyReturningStatefully :: StateT a f b -> f b
  default modifyReturningStatefully :: StateT a f b -> f b
  modifyReturningStatefully = modifyReturning . runStateT

  {- modifyStatefully
     Same as `modify`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  modifyStatefully :: StateT a f () -> f a
  default modifyStatefully :: StateT a f () -> f a
  modifyStatefully = modify . execStateT

  {- modifyStatefully_
     The same as `modify`, but ignore the return value.
  -}
  modifyStatefully_ :: StateT a f () -> f ()
  default modifyStatefully_ :: StateT a f () -> f ()
  modifyStatefully_ = void . modifyStatefully