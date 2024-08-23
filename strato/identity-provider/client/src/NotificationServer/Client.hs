{-# LANGUAGE TypeApplications #-}
module NotificationServer.Client
    (putSubscribe, postNotify)
where

import Data.Proxy
import Data.Text (Text)
import NotificationServer.API
import Servant.Client

putSubscribe :: Text -> Username -> ClientM Text
putSubscribe = client (Proxy @PutSubscribe)

postNotify :: Text -> Maybe Text -> NotifyBody -> ClientM Text
postNotify = client (Proxy @PostNotify)