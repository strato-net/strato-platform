{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.CoreAPI where

import           Control.Monad.Reader

import           Control.Monad.FT

import           Network.HTTP.Client

import           Servant.Client

data CoreAPIData =
  CoreAPIData {
    urlStrato :: BaseUrl,
    httpManager :: Manager
  }

type CoreAPIM = ReaderT CoreAPIData

type HasCoreAPI m = Gettable CoreAPIData m

runCoreAPIM :: MonadIO m => String -> CoreAPIM m a -> m a
runCoreAPIM urlString f = do
  mgr <- liftIO $ newManager defaultManagerSettings
  url <- liftIO $ parseBaseUrl urlString

  runReaderT f $ CoreAPIData url mgr

