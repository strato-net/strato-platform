{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Control.Monad.Composable.Notification where

import Control.Monad.Change.Modify
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Network.HTTP.Client
import Network.HTTP.Client.TLS
import Servant.Client

data NotificationData = NotificationData
  { urlNotificationServer :: BaseUrl,
    httpManager' :: Manager
  }

type NotificationM es = Eff (NotificationData ': es)

type HasNotification m = Accessible NotificationData m

runNotificationM :: String -> NotificationM es a -> Eff es a
runNotificationM urlNotification f = do
  notificationUrl <- liftIO $ parseBaseUrl urlNotification
  mgr <- liftIO $ case baseUrlScheme notificationUrl of
    Http -> newManager defaultManagerSettings
    Https -> newManager tlsManagerSettings
  provide (NotificationData notificationUrl mgr) f
