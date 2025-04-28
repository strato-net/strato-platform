{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

{-# OPTIONS -fno-warn-orphans #-}

module SelectAccessible where

import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.Reader (MonadTrans, lift)
import Control.Monad.Trans.Reader

instance {-# OVERLAPPING #-} (Monad m) => Accessible a (ReaderT a m) where
  access _ = ask

instance (Monad m, Accessible a m, MonadTrans t) => Accessible a (t m) where
  access p = lift (access p)

instance (Monad m, Selectable k v m, MonadTrans t) => Selectable k v (t m) where
  select p = lift . select p

instance (Monad m, Replaceable k v m, MonadTrans t) => Replaceable k v (t m) where
  replace p k = lift . replace p k

instance (Monad m, Outputs m a, MonadTrans t) => Outputs (t m) a where
  output = lift . output

instance (Monad m, Awaitable a m, MonadTrans t) => Awaitable a (t m) where
  await = lift await