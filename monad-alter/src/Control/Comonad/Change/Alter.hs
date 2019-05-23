{-# LANGUAGE MultiParamTypeClasses #-}

module Control.Comonad.Change.Alter
  ( CoAlters(..)
  ) where

import Control.Comonad
import Control.Monad (void)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Proxy

class (Ord k, Comonad w) => CoAlters k a w where
  coalterMany :: Proxy a -> [k] -> (w (Map k a) -> Map k a) -> w (Map k a)

  coalter :: Proxy a -> k -> (w (Maybe a) -> Maybe a) -> w (Maybe a)
  coalter p k f = M.lookup k <$> coalterMany p [k] (maybe M.empty (M.singleton k) . f . fmap (M.lookup k))

  coalter_ :: Proxy a -> k -> (w (Maybe a) -> Maybe a) -> w ()
  coalter_ p k = void . coalter p k

  coupdate :: Proxy a -> k -> (w a -> Maybe a) -> w (Maybe a)
  coupdate p k f = coalter p k $ \wma -> case extract wma of
                                          Nothing -> Nothing
                                          Just _ -> f (fromJust <$> wma)

  coupdate_ :: Proxy a -> k -> (w a -> Maybe a) -> w ()
  coupdate_ p k = void . coupdate p k

  coadjust :: Proxy a -> k -> (w a -> a) -> w a
  coadjust p k f = fromJust <$> coupdate p k (Just . f)

  coadjust_ :: Proxy a -> k -> (w a -> a) -> w ()
  coadjust_ p k = void . coadjust p k

  corepsert :: Proxy a -> k -> (w (Maybe a) -> a) -> w a
  corepsert p k f = fromJust <$> coalter p k (Just . f)

  corepsert_ :: Proxy a -> k -> (w (Maybe a) -> a) -> w ()
  corepsert_ p k = void . corepsert p k

  colookup :: Proxy a -> k -> w (Maybe a)
  colookup p k = coalter p k extract

  coinsert :: Proxy a -> k -> a -> w ()
  coinsert p k a = corepsert_ p k (const a)

  codelete :: Proxy a -> k -> w ()
  codelete p k = coalter_ p k (const Nothing)
