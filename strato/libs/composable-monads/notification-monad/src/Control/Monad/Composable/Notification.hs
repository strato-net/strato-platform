{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.Notification where

import Control.Monad.Change.Modify
import Control.Monad.Reader
import Network.HTTP.Client
import Network.HTTP.Client.TLS
import Servant.Client

data NotificationData = NotificationData
  { urlNotificationServer :: BaseUrl,
    httpManager' :: Manager
  }

type NotificationM = ReaderT NotificationData

type HasNotification m = Accessible NotificationData m

runNotificationM :: MonadIO m => String -> NotificationM m a -> m a
runNotificationM urlNotification f = do
  notificationUrl <- liftIO $ parseBaseUrl urlNotification
  mgr <- liftIO $ case baseUrlScheme notificationUrl of
    Http -> newManager defaultManagerSettings
    Https -> newManager tlsManagerSettings
  runReaderT f $ NotificationData notificationUrl mgr
