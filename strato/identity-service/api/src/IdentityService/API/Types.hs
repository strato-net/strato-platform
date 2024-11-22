{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module IdentityService.API.Types
  ( PutIdentityRequest(..),
    PutIdentityResponse(..),
    PostUsernameAvailableRequest(..),
    OryMessages(..),
    successOryMessage,
    errorOryMessage
  )
where

import BlockApps.X509
import Blockchain.Strato.Model.Secp256k1
import Control.Applicative ((<|>))
import Data.Aeson hiding (Success, Error)
import GHC.Generics

newtype PutIdentityRequest = PutIdentityRequest (Either (Signed SubjectAndCert) (Signed (Signed SubjectAndCert)))

newtype PutIdentityResponse = PutIdentityResponse X509Certificate

newtype PostUsernameAvailableRequest = PostUsernameAvailableRequest {username :: String} deriving Generic

newtype OryMessages = OryMessages [OryMessage]
data OryMessage = OryMessage {
  instance_ptr :: String,
  messages :: [OryMessageDetail]
} deriving Generic
data OryMessageDetail = OryMessageDetail Int String OryMessageType
data OryMessageType = Error | Info | Success deriving Generic

instance ToJSON PutIdentityRequest where
  toJSON (PutIdentityRequest (Left sub)) = toJSON sub
  toJSON (PutIdentityRequest (Right ssub)) = toJSON ssub

instance FromJSON PutIdentityRequest where
  parseJSON o = fmap PutIdentityRequest $ (Left <$> parseJSON o) <|> (Right <$> parseJSON o)

instance ToJSON PutIdentityResponse where
  toJSON (PutIdentityResponse b) = toJSON b

instance FromJSON PutIdentityResponse where
  parseJSON = fmap PutIdentityResponse . parseJSON

instance ToJSON PostUsernameAvailableRequest where
instance FromJSON PostUsernameAvailableRequest where


instance ToJSON OryMessages where
  toJSON (OryMessages ms) = object ["messages" .= ms]
instance FromJSON OryMessages where
  parseJSON = withObject "OryMessages" $ \v -> OryMessages <$> v .: "messages"

instance ToJSON OryMessage where
instance FromJSON OryMessage where

instance ToJSON OryMessageDetail where
  toJSON (OryMessageDetail i t t') = 
    object [
      "id" .= i,
      "text" .= t,
      "type" .= show t'
    ]
instance FromJSON OryMessageDetail where
  parseJSON = withObject "OryMessageDetail" $ \v -> do 
    i <- v .: "id"
    t <- v .: "text"
    t' <- v .: "type"
    return $ OryMessageDetail i t t'

instance ToJSON OryMessageType where
instance FromJSON OryMessageType where
instance Show OryMessageType where 
  show Error = "error"
  show Info = "info"
  show Success = "success"

successOryMessage :: OryMessages
successOryMessage = OryMessages [OryMessage "#/username" [OryMessageDetail 1 "" Success]]

errorOryMessage :: String -> OryMessages
errorOryMessage errString = 
  OryMessages [
    OryMessage 
      "#/username" 
      [OryMessageDetail 2 errString Error]
    ]