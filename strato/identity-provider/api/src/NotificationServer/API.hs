{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TypeOperators #-}

module NotificationServer.API 
    (
        NotificationServerAPI,
        PutSubscribe,
        PostNotify,
        Username(..),
        NotifyBody(..)
    )
where

import Data.Aeson
import Data.Text (Text)
import GHC.Generics
import Servant.API

newtype Username = Username {username :: Text} deriving (Show, Generic)
instance ToJSON Username where
instance FromJSON Username where

data NotifyBody = NotifyBody {recipients :: [Text], message :: Text} -- recipients [Username] instead?
    deriving (Show, Generic)
instance ToJSON NotifyBody where
instance FromJSON NotifyBody where

type PutSubscribe = 
    "subscribe"
        :> Header' '[Required, Strict] "Authorization" Text
        :> ReqBody '[JSON] Username
        :> Put '[PlainText] Text
type PostNotify =
    "notify"
        :> Header' '[Required, Strict] "Authorization" Text
        :> QueryParam "method" Text
        :> ReqBody '[JSON] NotifyBody
        :> Post '[PlainText] Text

type NotificationServerAPI = PutSubscribe :<|> PostNotify