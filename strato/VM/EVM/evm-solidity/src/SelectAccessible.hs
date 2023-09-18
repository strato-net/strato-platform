{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

{-# OPTIONS -fno-warn-orphans #-}

module SelectAccessible where

import Control.Monad.Change.Modify
import Control.Monad.Reader (MonadTrans, lift)
import Control.Monad.Trans.Reader

instance {-# OVERLAPPING #-} (Monad m) => Accessible a (ReaderT a m) where
  access _ = ask

instance (Monad m, Accessible a m, MonadTrans t) => Accessible a (t m) where
  access p = lift (access p)
