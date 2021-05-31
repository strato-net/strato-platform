{-# LANGUAGE MultiParamTypeClasses #-}

module Control.Monad.FT.Put
  ( Puttable(..)
  ) where

{- The Puttable Typeclass
  `Puttable a f` is a typeclass used to generalize the Control.Monad.State function
  `put` to any type constructor f.
  The class has two type parameters:
    a - the value type, like the `s` in `State s a`
    f - the underlying type constructor, such as `State s`
  Use this typeclass instead of `Modifiable` when `put` functionality is all that is needed.
-}
class Monad f => Puttable a f where
  put :: a -> f ()