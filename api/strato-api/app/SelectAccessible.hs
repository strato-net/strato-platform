{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

{-# OPTIONS -fno-warn-orphans #-}

module SelectAccessible where

import           Control.Monad.FT
import           Control.Monad.Reader            (MonadTrans, lift)
import           Control.Monad.Trans.Reader

instance {-# OVERLAPPING #-} (Monad m) => Gettable a (ReaderT a m) where
  get = ask

instance (Monad m, Monad (t m), Gettable a m, MonadTrans t) => Gettable a (t m) where
  get = lift get
