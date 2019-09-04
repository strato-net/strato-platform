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

{- The Alters Typeclass
  (k `Alters` a) f is a typeclass used to generalize Data.Map-like functions to any monad f.
  The class has three type parameters:
    k - the key type, like the `k` in `Map k a`
    a - the value type, like the `a` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
  (k `Alters` a) f allows reusable code to be written for different contexts. For example,
  instances can be written for production monads, using calls to external databases;
  testing monads, where the Map-like structure is held in-memory;
  or hybrids, where the user wishes to implement a sophisticated caching system in-memory,
  and have fallback calls to the database. Using `Alters`, the memory management logic is
  separated from the backend-agnostic business logic.

  The Alters typeclass contains two basic sets of functions to represent Map-like operations:
  `lookup`, `insert`, and `delete`; and `alter`. Instances of Alters may choose to implement
  one or both of these sets, depending on the details of the underlying monad. For example,
  if connecting to a simple key-value store, which only supports lookup, insert, and delete,
  it makes sense to only implement those respective functions in the monad's `Alters` instance,
  because there is no way to leverage the database's API to optimize more complex functions.
  In this case, the defaults for composite functions like `alter`, `adjust`, and `update` are
  implemented using combinations of `lookup`, `insert`, and `delete`. However, let's say the
  database we're connecting to supports an update function, which can be called without having
  to retrieve and replace the value associated with a certain key, then it would be more
  efficient to separately implement the `update` or `adjust` functions in the monad's `Alters`
  instance, rather than using the default, which is the composition of `lookup` and `insert`.
  Now, let's say the backend supports some more advanced query language, such as SQL, which
  supports complex CRUD operations, as well as functions to modify data in-place. In this case,
  it might make more sense to implement `alter` and/or `alterMany`, instead of, or in addition to,
  the standard `lookup`, `insert`, and `delete` functions, because `alterMany` may be written as
  a SQL query to update millions of rows in a table, without the Haskell code ever having to see
  that data. This is why all of the functions in the Alters typeclass are inside the class, rather
  than top-level functions with an `Alters` constraint.
-}
class (Ord k, Monad f) => Alters k a f where

  {- alterMany
     Apply an effectful function to a `Map k a`, and return the new Map.
     The default instance is a combination of `{lookup, insert, delete}Many`.
     Could also be implemented as the list version of `alter`
  -}
  alterMany :: Proxy a -> [k] -> (Map k a -> f (Map k a)) -> f (Map k a)
  alterMany p ks f = do
    m <- lookupMany p ks
    m' <- f m
    deleteMany p . M.keys $ m M.\\ m'
    insertMany p m'
    return m'

  {- alter
     The most general function that can be applied to a Map-like structure.
     Apply an effectful function to a `Maybe a`, which represents a value that may or may not
     exist in a `Map k a`, at a given key `k`, and return a `Maybe a`, which represents whether
     to insert the new value in the Map. From `alter`, we can derive every other function in the
     `Alters` typeclass. However, for many cases, defining `alter` by itself is not the most
     efficient implementation for the underlying monad. The default instance is implemented as
     the singleton version of `alterMany`, but could also be implemented as a combination of
     `lookup`, `insert`, and `delete`.
  -}
  alter :: Proxy a -> k -> (Maybe a -> f (Maybe a)) -> f (Maybe a)
  alter p k f = M.lookup k <$> alterMany p [k] (M.alterF f k)

  {- lookupMany
     Take a list of keys, and return a `Map k a` of the keys and their values existing in the
     underlying monad `f`. The default instance is implemented as the list version of `lookup`,
     but could also be implemented as `alterMany` on the identity function.
  -}
  lookupMany :: Proxy a -> [k] -> f (Map k a)
  lookupMany p ks = M.fromList . catMaybes <$> forM ks (\k -> fmap (k,) <$> lookup p k)

  {- lookup
     Lookup the corresponding value for a given key `k` in the underlying monad `f`
  -}
  lookup :: Proxy a -> k -> f (Maybe a)
  lookup p k = alter p k pure

  {- insertMany
     Take a `Map k a`, and insert/overwrite its entries in the underlying monad `f`.
     The default instance is implemented as the list version of `insert`,
     but could also be implemented as `alterMany` on the `const . Just` function.
  -}
  insertMany :: Proxy a -> Map k a -> f ()
  insertMany p m = forM_ (M.assocs m) . uncurry $ insert p

  {- insert
     Insert the corresponding key/value pair in the underlying monad `f`
  -}
  insert :: Proxy a -> k -> a -> f ()
  insert p k a = alter_ p k (pure . const (Just a))

  {- deleteMany
     Take a list of keys, and delete the corresponding entries in the underlying monad `f`.
     The default instance is implemented as the list version of `delete`,
     but could also be implemented as `alterMany` on the `const Nothing` function.
  -}
  deleteMany :: Proxy a -> [k] -> f ()
  deleteMany p ks = forM_ ks $ delete p

  {- delete
     Delete the corresponding entry for the key `k` in the underlying monad `f`
  -}
  delete :: Proxy a -> k -> f ()
  delete p k = alter_ p k (pure . const Nothing)

  {-# MINIMAL alterMany
            | alter
            | lookupMany, insertMany, deleteMany
            | lookup, insert, delete
    #-}

  {- alterMany_
     Same as `alterMany` except it discards the return value.
  -}
  alterMany_ :: Proxy a -> [k] -> (Map k a -> f (Map k a)) -> f ()
  alterMany_ p ks = void . alterMany p ks

  {- alter_
     Same as `alter` except it discards the return value.
  -}
  alter_ :: Proxy a -> k -> (Maybe a -> f (Maybe a)) -> f ()
  alter_ p k = void . alter p k

  {- lookupWithDefault
     Lookup the corresponding value for a given key `k` in the underlying monad `f`,
     and return `def` if the entry for key `k` is not found.
     Requires a `Default` instance on the value type `a`.
  -}
  lookupWithDefault :: Default a => Proxy a -> k -> f a
  lookupWithDefault p k = fromMaybe def <$> lookup p k

  {- lookupWithMempty
     Lookup the corresponding value for a given key `k` in the underlying monad `f`,
     and return `mempty` if the entry for key `k` is not found.
     Requires a `Monoid` instance on the value type `a`.
  -}
  lookupWithMempty :: Monoid a => Proxy a -> k -> f a
  lookupWithMempty p k = fromMaybe mempty <$> lookup p k

  {- update
     Apply an effectful function on an existing key/value pair in the underlying monad `f`.
     If the entry for key `k` does not exist in the underlying monad beforehand, the function
     is not applied. If the function returns `Nothing`, the entry for key `k` is deleted from
     the underlying monad.
  -}
  update :: Proxy a -> k -> (a -> f (Maybe a)) -> f (Maybe a)
  update p k f = alter p k $ \case
    Just a -> f a
    Nothing -> pure Nothing

  {- update_
     Same as `update` except it discards the return value.
  -}
  update_ :: Proxy a -> k -> (a -> f (Maybe a)) -> f ()
  update_ p k = void . update p k

  {- updateStatefully
     Same as `update`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  updateStatefully :: Proxy a -> k -> StateT a f (Maybe a) -> f (Maybe a)
  updateStatefully p k = update p k . evalStateT

  {- updateStatefully_
     Same as `updateStatefully` except it discards the return value.
  -}
  updateStatefully_ :: Proxy a -> k -> StateT a f (Maybe a) -> f ()
  updateStatefully_ p k = void . updateStatefully p k

  {- adjust
     Apply an effectful function on an existing key/value pair in the underlying monad `f`.
     If the entry for key `k` does not exist in the underlying monad beforehand, the function
     is not applied. Unlike `update`, `adjust` returns an `a` instead of a `Maybe a`, which
     means that the entry for key `k` cannot be deleted from the underlying monad by calling
     `adjust`.
  -}
  adjust :: Proxy a -> k -> (a -> f a) -> f a
  adjust p k f = fmap fromJust $ update p k (fmap Just . f)

  {- adjust_
     Same as `adjust` except it discards the return value.
  -}
  adjust_ :: Proxy a -> k -> (a -> f a) -> f ()
  adjust_ p k = void . adjust p k

  {- adjustStatefully
     Same as `adjust`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
  -}
  adjustStatefully :: Proxy a -> k -> StateT a f () -> f a
  adjustStatefully p k = adjust p k . execStateT

  {- adjustStatefully_
     Same as `adjustStatefully` except it discards the return value.
  -}
  adjustStatefully_ :: Proxy a -> k -> StateT a f () -> f ()
  adjustStatefully_ p k = void . adjustStatefully p k

  {- adjustWithDefault
     Adjust the corresponding value for a given key `k` in the underlying monad `f`,
     If the entry for key `k` does not exist in the underlying monad beforehand, `def`
     is passed to the function. This ensures that the entry for key `k` will exist
     in the underlying monad after calling `adjustWithDefault`.
     Requires a `Default` instance on the value type `a`.
  -}
  adjustWithDefault :: Default a => Proxy a -> k -> (a -> f a) -> f a
  adjustWithDefault p k f = fmap fromJust $ alter p k (fmap Just . f . fromMaybe def)

  {- adjustWithDefault_
     Same as `adjustWithDefault` except it discards the return value.
     Requires a `Default` instance on the value type `a`.
  -}
  adjustWithDefault_ :: Default a => Proxy a -> k -> (a -> f a) -> f ()
  adjustWithDefault_ p k = void . adjustWithDefault p k

  {- adjustWithDefaultStatefully
     Same as `adjustWithDefault`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
     Requires a `Default` instance on the value type `a`.
  -}
  adjustWithDefaultStatefully :: Default a => Proxy a -> k -> StateT a f () -> f a
  adjustWithDefaultStatefully p k = adjustWithDefault p k . execStateT

  {- adjustWithDefaultStatefully_
     Same as `adjustWithDefaultStatefully` except it discards the return value.
     Requires a `Default` instance on the value type `a`.
  -}
  adjustWithDefaultStatefully_ :: Default a => Proxy a -> k -> StateT a f () -> f ()
  adjustWithDefaultStatefully_ p k = void . adjustWithDefaultStatefully p k

  {- adjustWithMempty
     Adjust the corresponding value for a given key `k` in the underlying monad `f`,
     If the entry for key `k` does not exist in the underlying monad beforehand, `mempty`
     is passed to the function. This ensures that the entry for key `k` will exist
     in the underlying monad after calling `adjustWithMempty`.
     Requires a `Monoid` instance on the value type `a`.
  -}
  adjustWithMempty :: Monoid a => Proxy a -> k -> (a -> f a) -> f a
  adjustWithMempty p k f = fmap fromJust $ alter p k (fmap Just . f . fromMaybe mempty)

  {- adjustWithMempty_
     Same as `adjustWithMempty` except it discards the return value.
     Requires a `Monoid` instance on the value type `a`.
  -}
  adjustWithMempty_ :: Monoid a => Proxy a -> k -> (a -> f a) -> f ()
  adjustWithMempty_ p k = void . adjustWithMempty p k

  {- adjustWithMemptyStatefully
     Same as `adjustWithMempty`, but run in a stateful context.
     This is useful when applying complex functions to the value, especially when the using
     lenses to operate on specific fields in the record type.
     Requires a `Monoid` instance on the value type `a`.
  -}
  adjustWithMemptyStatefully :: Monoid a => Proxy a -> k -> StateT a f () -> f a
  adjustWithMemptyStatefully p k = adjustWithMempty p k . execStateT

  {- adjustWithMemptyStatefully_
     Same as `adjustWithMemptyStatefully` except it discards the return value.
     Requires a `Monoid` instance on the value type `a`.
  -}
  adjustWithMemptyStatefully_ :: Monoid a => Proxy a -> k -> StateT a f () -> f ()
  adjustWithMemptyStatefully_ p k = void . adjustWithMemptyStatefully p k

  {- repsert
     Insert a key/value pair into the underlying monad `f`, but use the existing value,
     whether it exists or not, as a parameter to an effectful function to determine
     the new value. This is a generalization of `adjustWith{Default,Mempty}`, where a custom
     value may be supplied if the entry for key `k` doesn't already exist in the underlying
     monad `f`.
  -}
  repsert :: Proxy a -> k -> (Maybe a -> f a) -> f a
  repsert p k f = fmap fromJust $ alter p k (fmap Just . f)

  {- repsert_
     Same as `repsert` except it discards the return value.
  -}
  repsert_ :: Proxy a -> k -> (Maybe a -> f a) -> f ()
  repsert_ p k = void . repsert p k

  {- exists
     Returns a Bool representing whether the entry for a given key `k` exists in the
     underlying monad `f`. Although this is trivially implemented as `isJust <$> lookup p k`,
     in cases where the backend can make this determination without returning the value itself,
     utilizing this capability can be substantially more performant for large values.
  -}
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


{- The Selectable Typeclass
  `Selectable k a f` is a typeclass used to generalize the Data.Map function `lookup` to any monad f.
  The class has three type parameters:
    k - the key type, like the `k` in `Map k a`
    a - the value type, like the `a` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
  Use this typeclass instead of `Alters` when `lookup` functionality is all that is needed.
  TODO: implement an `exists` equivalent for `Selectable`.
-}
class (Ord k, Monad f) => Selectable k a f where
  {- selectMany
     Take a list of keys, and return a `Map k a` of the keys and their values existing in the
     underlying monad `f`.
     This function is analogous to the `lookupMany` function in `Alters`.
  -}
  selectMany :: Proxy a -> [k] -> f (Map k a)
  selectMany p ks = M.fromList . catMaybes <$> forM ks (\k -> fmap (k,) <$> select p k)

  {- select
     Lookup the corresponding value for a given key `k` in the underlying monad `f`
     This function is analogous to the `lookup` function in `Alters`
  -}
  select :: Proxy a -> k -> f (Maybe a)
  select p k = M.lookup k <$> selectMany p [k]

  {-# MINIMAL selectMany | select #-}

  {- selectWithDefault
     Lookup the corresponding value for a given key `k` in the underlying monad `f`,
     and return `def` if the entry for key `k` is not found.
     Requires a `Default` instance on the value type `a`.
     This function is analogous to the `lookupWithDefault` function in `Alters`
  -}
  selectWithDefault :: (Default a, Functor f) => Proxy a -> k -> f a
  selectWithDefault p k = fromMaybe def <$> select p k

  {- selectWithMempty
     Lookup the corresponding value for a given key `k` in the underlying monad `f`,
     and return `mempty` if the entry for key `k` is not found.
     Requires a `Monoid` instance on the value type `a`.
     This function is analogous to the `lookupWithMempty` function in `Alters`
  -}
  selectWithMempty :: (Monoid a, Functor f) => Proxy a -> k -> f a
  selectWithMempty p k = fromMaybe mempty <$> select p k

{- The Replaceable Typeclass
  `Replaceable k a f` is a typeclass used to generalize the Data.Map function `insert` to any monad f.
  The class has three type parameters:
    k - the key type, like the `k` in `Map k a`
    a - the value type, like the `a` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
  Use this typeclass instead of `Alters` when `insert` functionality is all that is needed.
  NB: This typeclass may not be useful in real-world applications, but is provided for completeness.
  TODO: implement a `replaceMany` function, analogous to `insertMany`.
-}
class Replaceable k a f where
  {- replace
     Insert the corresponding key/value pair in the underlying monad `f`.
     This function is analogous to the `insert` function in `Alters`.
  -}
  replace :: Proxy a -> k -> a -> f ()

{- The Removable Typeclass
  `Removable k a f` is a typeclass used to generalize the Data.Map function `delete` to any monad f.
  The class has three type parameters:
    k - the key type, like the `k` in `Map k a`
    a - the value type, like the `a` in `Map k a`
    f - the underlying monad, such as `State (Map k a)`
  Use this typeclass instead of `Alters` when `delete` functionality is all that is needed.
  NB: This typeclass may not be useful in real-world applications, but is provided for completeness.
  TODO: implement a `removeMany` function, analogous to `deleteMany`.
-}
class Removable k a f where
  {- remove
     Delete the corresponding entry for the key `k` in the underlying monad `f`.
     This function is analogous to the `insert` function in `Alters`.
  -}
  remove :: Proxy a -> k -> f ()
