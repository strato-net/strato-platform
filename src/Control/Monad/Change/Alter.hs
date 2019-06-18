{-# LANGUAGE AllowAmbiguousTypes   #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RankNTypes            #-}
{-# LANGUAGE TupleSections         #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE UndecidableInstances  #-}

module Control.Monad.Change.Alter
  ( Alters(..)
  , Maps(..)
  , Selectable(..)
  , Replaceable(..)
  , Removable(..)
  , module Data.Proxy
  ) where

import           Control.Lens
import           Control.Monad
import           Control.Monad.Change.Modify
import           Control.Monad.Trans.State   (evalStateT, execStateT, StateT)
import           Data.Default
import qualified Data.IntMap                 as IM
import           Data.Map.Strict             (Map)
import qualified Data.Map.Strict             as M
import           Data.Maybe
import           Data.Proxy
import           Prelude                     hiding (lookup)

class (Ord k, Monad f) => Alters k a f where

  alterMany :: Proxy a -> [k] -> (Map k a -> f (Map k a)) -> f (Map k a)
  alterMany p ks f = do
    m <- lookupMany p ks
    m' <- f m
    deleteMany p . M.keys $ m M.\\ m'
    insertMany p m'
    return m'

  alter :: Proxy a -> k -> (Maybe a -> f (Maybe a)) -> f (Maybe a)
  alter p k f = M.lookup k <$> alterMany p [k] (M.alterF f k)

  lookupMany :: Proxy a -> [k] -> f (Map k a)
  lookupMany p ks = M.fromList . catMaybes <$> forM ks (\k -> fmap (k,) <$> lookup p k)

  lookup :: Proxy a -> k -> f (Maybe a)
  lookup p k = alter p k pure

  insertMany :: Proxy a -> Map k a -> f ()
  insertMany p m = forM_ (M.assocs m) . uncurry $ insert p

  insert :: Proxy a -> k -> a -> f ()
  insert p k a = alter_ p k (pure . const (Just a))

  deleteMany :: Proxy a -> [k] -> f ()
  deleteMany p ks = forM_ ks $ delete p

  delete :: Proxy a -> k -> f ()
  delete p k = alter_ p k (pure . const Nothing)

  {-# MINIMAL alterMany
            | alter
            | lookupMany, insertMany, deleteMany
            | lookup, insert, delete
    #-}

  alterMany_ :: Proxy a -> [k] -> (Map k a -> f (Map k a)) -> f ()
  alterMany_ p ks = void . alterMany p ks

  alter_ :: Proxy a -> k -> (Maybe a -> f (Maybe a)) -> f ()
  alter_ p k = void . alter p k

  lookupWithDefault :: Default a => Proxy a -> k -> f a
  lookupWithDefault p k = fromMaybe def <$> lookup p k

  lookupWithMempty :: Monoid a => Proxy a -> k -> f a
  lookupWithMempty p k = fromMaybe mempty <$> lookup p k

  update :: Proxy a -> k -> (a -> f (Maybe a)) -> f (Maybe a)
  update p k f = alter p k $ \case
    Just a -> f a
    Nothing -> pure Nothing

  update_ :: Proxy a -> k -> (a -> f (Maybe a)) -> f ()
  update_ p k = void . update p k

  updateStatefully :: Proxy a -> k -> StateT a f (Maybe a) -> f (Maybe a)
  updateStatefully p k = update p k . evalStateT

  updateStatefully_ :: Proxy a -> k -> StateT a f (Maybe a) -> f ()
  updateStatefully_ p k = void . updateStatefully p k

  adjust :: Proxy a -> k -> (a -> f a) -> f a
  adjust p k f = fmap fromJust $ update p k (fmap Just . f)

  adjust_ :: Proxy a -> k -> (a -> f a) -> f ()
  adjust_ p k = void . adjust p k

  adjustStatefully :: Proxy a -> k -> StateT a f () -> f a
  adjustStatefully p k = adjust p k . execStateT

  adjustStatefully_ :: Proxy a -> k -> StateT a f () -> f ()
  adjustStatefully_ p k = void . adjustStatefully p k

  adjustWithDefault :: Default a => Proxy a -> k -> (a -> f a) -> f a
  adjustWithDefault p k f = fmap fromJust $ alter p k (fmap Just . f . fromMaybe def)

  adjustWithDefault_ :: Default a => Proxy a -> k -> (a -> f a) -> f ()
  adjustWithDefault_ p k = void . adjustWithDefault p k

  adjustWithDefaultStatefully :: Default a => Proxy a -> k -> StateT a f () -> f a
  adjustWithDefaultStatefully p k = adjustWithDefault p k . execStateT

  adjustWithDefaultStatefully_ :: Default a => Proxy a -> k -> StateT a f () -> f ()
  adjustWithDefaultStatefully_ p k = void . adjustWithDefaultStatefully p k

  adjustWithMempty :: Monoid a => Proxy a -> k -> (a -> f a) -> f a
  adjustWithMempty p k f = fmap fromJust $ alter p k (fmap Just . f . fromMaybe mempty)

  adjustWithMempty_ :: Monoid a => Proxy a -> k -> (a -> f a) -> f ()
  adjustWithMempty_ p k = void . adjustWithMempty p k

  adjustWithMemptyStatefully :: Monoid a => Proxy a -> k -> StateT a f () -> f a
  adjustWithMemptyStatefully p k = adjustWithMempty p k . execStateT

  adjustWithMemptyStatefully_ :: Monoid a => Proxy a -> k -> StateT a f () -> f ()
  adjustWithMemptyStatefully_ p k = void . adjustWithMemptyStatefully p k

  repsert :: Proxy a -> k -> (Maybe a -> f a) -> f a
  repsert p k f = fmap fromJust $ alter p k (fmap Just . f)

  repsert_ :: Proxy a -> k -> (Maybe a -> f a) -> f ()
  repsert_ p k = void . repsert p k

  exists :: Proxy a -> k -> f Bool
  exists p k = isJust <$> lookup p k



class Maps k a b where
  that :: Proxy a -> k -> Lens' b (Maybe a)

instance Ord k => (k `Maps` a) (Map k a) where
  that _ k = lens (M.lookup k) (flip (maybe (M.delete k) (M.insert k)))

instance (Int `Maps` a) (IM.IntMap a) where
  that _ k = lens (IM.lookup k) (flip (maybe (IM.delete k) (IM.insert k)))

instance (Ord k, b `Has` (Map k a)) => (k `Maps` a) b where
  that _ k = this (Proxy :: Proxy (Map k a)) . at k

instance b `Has` (IM.IntMap a) => (Int `Maps` a) b where
  that _ k = this (Proxy :: Proxy (IM.IntMap a)) . at k



class (Ord k, Monad f) => Selectable k a f where
  selectMany :: Proxy a -> [k] -> f (Map k a)
  selectMany p ks = M.fromList . catMaybes <$> forM ks (\k -> fmap (k,) <$> select p k)

  select :: Proxy a -> k -> f (Maybe a)
  select p k = M.lookup k <$> selectMany p [k]

  {-# MINIMAL selectMany | select #-}

  selectWithDefault :: (Default a, Functor f) => Proxy a -> k -> f a
  selectWithDefault p k = fromMaybe def <$> select p k

  selectWithMempty :: (Monoid a, Functor f) => Proxy a -> k -> f a
  selectWithMempty p k = fromMaybe mempty <$> select p k

class Replaceable k a f where
  replace :: Proxy a -> k -> a -> f ()

class Removable k a f where
  remove :: Proxy a -> k -> f ()
