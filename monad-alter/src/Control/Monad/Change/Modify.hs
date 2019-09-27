{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE TypeOperators         #-}

module Control.Monad.Change.Modify
  ( Modifiable(..)
  , Has(..)
  , Accessible(..)
  , accesses
  , Inputs(..)
  , inputs
  , Outputs(..)
  , genericOutputsStringIO
  , Awaits(..)
  , Yields(..)
  , module Data.Proxy
  ) where

import           Control.Lens
import           Control.Monad                    (void, mapM_)
import           Control.Monad.IO.Class
import           Control.Monad.Trans.State        (execStateT, StateT)
import           Data.Proxy

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
class Monad f => Modifiable a f where
  {- modify
     The most general function that can be applied to a State-like monad.
     Apply an effectful function to a state value `a`, and return the new value.
     From `modify`, we can derive every other function in the `Modifiable` typeclass.
     However, for many cases, defining `modify` by itself is not the most
     efficient implementation for the underlying monad.
  -}
  modify :: Proxy a -> (a -> f a) -> f a
  modify p f = get p >>= f >>= \a -> put p a >> return a

  {- get
     Get a state value `a` from the underlying monad `f`.
  -}
  get :: Proxy a -> f a
  get p = modify p pure

  {- put
     Put a state value `a` into the underlying monad `f`.
  -}
  put :: Proxy a -> a -> f ()
  put p a = modify_ p (pure . const a)

  {-# MINIMAL modify | get, put #-}

  {- modify_
     The same as `modify`, but ignore the return value.
  -}
  modify_ :: Proxy a -> (a -> f a) -> f ()
  modify_ p = void . modify p

  {- modifyStatefully
     Same as `modify`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  modifyStatefully :: Proxy a -> StateT a f () -> f a
  modifyStatefully p = modify p . execStateT

  {- modifyStatefully_
     The same as `modify`, but ignore the return value.
  -}
  modifyStatefully_ :: Proxy a -> StateT a f () -> f ()
  modifyStatefully_ p = void . modifyStatefully p



class Has b a where
  this :: Proxy a -> Lens' b a

instance a `Has` a where
  this _ = lens id (const id)

instance (Identity a) `Has` a where
  this _ = lens runIdentity (const Identity)



{- The Accessible Typeclass
  `Accessible a f` is a typeclass used to generalize the Control.Monad.State function
  `get` to any monad f.
  The class has two type parameters:
    a - the value type, like the `s` in `State s a`
    f - the underlying monad, such as `State s a`
  Use this typeclass instead of `Modifiable` when `get` functionality is all that is needed.
-}
class Accessible a f where
  access :: Proxy a -> f a

accesses :: (Functor f, Accessible a f) => Proxy a -> (a -> b) -> f b
accesses = flip fmap . access

class Inputs f a where
  input :: f a

inputs :: (Functor f, Inputs f a) => (a -> b) -> f b
inputs f = f <$> input

class Outputs f a where
  output :: a -> f ()

genericOutputsStringIO :: MonadIO m => String -> m ()
genericOutputsStringIO = liftIO . putStrLn

{- The Awaits Typeclass
  (f `Awaits` a) is a typeclass used to generalize the `await` function from streaming
  libraries like Pipes and Conduit to any monad f.
  The class has two type parameters:
    f - the underlying monad, such as `ConduitT i o m r`
    a - the value type being awaited, like the `i` in `ConduitT i o m r`
-}
class Awaits f a where
  await :: f (Maybe a)
  {-# MINIMAL await #-}

  awaitForever :: Monad f => (a -> f ()) -> f ()
  awaitForever f = await >>= \case
    Nothing -> return ()
    Just a -> f a >> awaitForever f

{- The Yields Typeclass
  (f `Yields` a) is a typeclass used to generalize the `yield` function from streaming
  libraries like Pipes and Conduit to any monad f.
  The class has two type parameters:
    f - the underlying monad, such as `ConduitT i o m r`
    a - the value type being awaited, like the `o` in `ConduitT i o m r`
-}
class Yields f a where
  yield :: a -> f ()
  {-# MINIMAL yield #-}

  yieldMany :: Monad f => [a] -> f ()
  yieldMany = mapM_ yield
