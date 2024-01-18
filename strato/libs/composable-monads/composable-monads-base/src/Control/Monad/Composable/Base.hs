{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Control.Monad.Composable.Base (
  AccessibleEnv(..),
  accessEnvVar
  ) where

import Control.Monad.Reader (MonadTrans, lift)
import Control.Monad.Trans.Reader


class AccessibleEnv a f where
  accessEnv :: f a

instance {-# OVERLAPPING #-} (Monad m) => AccessibleEnv a (ReaderT a m) where
  accessEnv = ask

instance (Monad m, AccessibleEnv a m, MonadTrans t) => AccessibleEnv a (t m) where
  accessEnv = lift accessEnv

accessEnvVar :: (Monad m, AccessibleEnv a m) =>
                (a -> b) -> m b
accessEnvVar f = do
  env <- accessEnv
  return $ f env
