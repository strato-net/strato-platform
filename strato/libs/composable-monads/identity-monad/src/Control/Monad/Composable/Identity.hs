{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.Identity where

import Control.Monad.Change.Modify
import Control.Monad.Reader
import Network.HTTP.Client
import Network.HTTP.Client.TLS
import Servant.Client

data IdentityData = IdentityData
  { urlIdentityServer :: BaseUrl,
    httpManager' :: Manager
  }

type IdentityM = ReaderT IdentityData

type HasIdentity m = Accessible IdentityData m

runIdentitytM :: MonadIO m => String -> IdentityM m a -> m a
runIdentitytM urlIdentity f = do
  identityUrl <- liftIO $ parseBaseUrl urlIdentity
  mgr <- liftIO $ case baseUrlScheme identityUrl of
    Http -> newManager defaultManagerSettings
    Https -> newManager tlsManagerSettings
  runReaderT f $ IdentityData identityUrl mgr
