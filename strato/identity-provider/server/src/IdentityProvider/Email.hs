{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

-- welcome-email-related code goes here

module IdentityProvider.Email where

import BlockApps.Logging
import Control.Monad.Change.Modify (access)
import Control.Monad.Composable.Notification
import Control.Monad.IO.Class
import Data.Aeson
import Data.ByteString
import Data.Proxy
import qualified Data.Text as T
import GHC.Generics
import Network.HTTP.Client hiding (Proxy)
import Network.HTTP.Client.TLS
import Network.HTTP.Types.Header (hAuthorization, hContentType)
import NotificationServer.API
import NotificationServer.Client
import Servant.Client hiding (manager)

newtype SendgridAPIKey = SendgridAPIKey {apiKey :: ByteString} deriving (Show)

-- this section defines the JSON sent in the body to sendgrid --
-- if it seems esoteric, that is because it is --
-- I do not know where these field names came from but oh well --
data SendgridRequestBody = SendgridRequestBody
  { list_ids :: [String],
    contacts :: [SendgridContact]
  }
  deriving (Show, Generic, ToJSON, FromJSON)

data SendgridContact = SendgridContact
  { email :: String,
    first_name :: String,
    custom_fields :: SendgridCustomField
  }
  deriving (Show, Generic, ToJSON, FromJSON)

newtype SendgridCustomField = SendgridCustomField
  { e1_T :: String -- uuid
  }
  deriving (Show, Generic, ToJSON, FromJSON)

sendWelcomeEmail :: (MonadIO m, MonadLogger m) => String -> String -> String -> SendgridAPIKey -> m ()
sendWelcomeEmail email' name uuid key = do
  manager <- liftIO $ newManager tlsManagerSettings
  templateRequest <- liftIO $ parseRequest "https://api.sendgrid.com/v3/marketing/contacts"
  let rHead = [(hContentType, "application/json"), (hAuthorization, "Bearer " <> apiKey key)]
      request =
        templateRequest
          { method = "PUT",
            requestHeaders = rHead,
            requestBody =
              RequestBodyLBS $
                encode
                  SendgridRequestBody
                    { list_ids = ["d3fe3b27-9d4b-4333-89c7-926d345ddcb6"],
                      contacts =
                        [ SendgridContact
                            { email = email',
                              first_name = name,
                              custom_fields = SendgridCustomField uuid
                            }
                        ]
                    }
          }
  response <- liftIO $ httpLbs request manager
  $logInfoS "sendWelcomeEmail" $ T.pack $ "Sendgrid response for welcome email was " <> show (responseStatus response)
  return ()

subscribeUser :: (MonadIO m, MonadLogger m, HasNotification m) => T.Text -> T.Text -> m ()
subscribeUser auth user = do
  NotificationData url mgr <- access Proxy
  eResp <- liftIO $ runClientM (putSubscribe ("Bearer " <> auth) (Username user)) (mkClientEnv mgr url)
  case eResp of 
    Right _ -> $logInfoS "subscribeUser" $ "Successfully subscribed user " <> user
    Left err -> $logErrorS "subscribeUser" $ "Error while trying to subscribe" <> user <> ": " <> (T.pack $ show err)