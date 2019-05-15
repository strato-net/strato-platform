{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE Rank2Types            #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE UndecidableInstances  #-}

module Control.Monad.Change.Modify
  ( Modifiable(..)
  , Has(..)
  , Accessible(..)
  , accesses
  , module Data.Proxy
  ) where

import           Control.Lens
import           Control.Monad             (void)
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.State (execStateT, StateT)
import qualified Control.Monad.Trans.State as State
import           Data.Proxy

class Monad f => Modifiable a f where
  modify :: Proxy a -> (a -> f a) -> f a
  modify p f = get p >>= f >>= \a -> put p a >> return a

  get :: Modifiable a f => Proxy a -> f a
  get p = modify p pure

  put :: Modifiable a f => Proxy a -> a -> f ()
  put p a = modify_ p (pure . const a)

  {-# MINIMAL modify | get, put #-}

  modify_ :: Modifiable a f => Proxy a -> (a -> f a) -> f ()
  modify_ p = void . modify p

  modifyStatefully :: Proxy a -> StateT a f () -> f a
  modifyStatefully p = modify p . execStateT

  modifyStatefully_ :: Proxy a -> StateT a f () -> f ()
  modifyStatefully_ p = void . modifyStatefully p



class Has b a where
  this :: Proxy a -> Lens' b a

instance a `Has` a where
  this _ = lens id (const id)

instance (Identity a) `Has` a where
  this _ = lens runIdentity (const Identity)

instance {-# OVERLAPPABLE #-} (Monad m, b `Has` a) => Modifiable a (StateT b m) where
  get p   = use (this p)
  put p s = assign (this p) s



class Accessible a f where
  access :: Proxy a -> f a

accesses :: (Functor f, Accessible a f) => Proxy a -> (a -> b) -> f b
accesses = flip fmap . access



instance Monad m => Accessible a (StateT a m) where
  access = const State.get

instance Monad m => Accessible a (ReaderT a m) where
  access = const ask
