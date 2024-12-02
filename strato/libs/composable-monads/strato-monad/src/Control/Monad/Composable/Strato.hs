{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.Strato where

import Control.Monad.Change.Modify
import Control.Monad.Reader
import Network.HTTP.Client
import Network.HTTP.Client.TLS
import Servant.Client

data StratoData = StratoData
  { urlVaultWrapper :: BaseUrl,
    httpManager :: Manager
  }

type StratoM = ReaderT StratoData

type HasStrato m = Accessible StratoData m

runStratoM :: MonadIO m => String -> StratoM m a -> m a
runStratoM url f = do
  stratoUrl <- liftIO $ parseBaseUrl url
  mgr <- liftIO $ case baseUrlScheme stratoUrl of
    Http -> newManager defaultManagerSettings
    Https -> newManager tlsManagerSettings

  runReaderT f $ StratoData stratoUrl mgr
