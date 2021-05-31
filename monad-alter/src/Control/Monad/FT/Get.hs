{-# LANGUAGE MultiParamTypeClasses #-}

module Control.Monad.FT.Get
  ( Gettable(..)
  , gets
  ) where

{- The Gettable Typeclass
  `Gettable a f` is a typeclass used to generalize the Control.Monad.State function
  `get` to any type constructor f.
  The class has two type parameters:
    a - the value type, like the `s` in `State s a`
    f - the underlying type constructor, such as `State s`
-}
class Monad f => Gettable a f where
  get :: f a

gets :: Gettable a f => (a -> b) -> f b
gets = flip fmap get