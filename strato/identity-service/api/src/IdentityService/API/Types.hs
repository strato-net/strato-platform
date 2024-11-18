{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityService.API.Types
  ( PutIdentityRequest(..),
    PutIdentityResponse(..)
  )
where

import BlockApps.X509
import Blockchain.Strato.Model.Secp256k1
import Control.Applicative ((<|>))
import Data.Aeson

newtype PutIdentityRequest = PutIdentityRequest (Either (Signed SubjectAndCert) (Signed (Signed SubjectAndCert)))

newtype PutIdentityResponse = PutIdentityResponse X509Certificate

instance ToJSON PutIdentityRequest where
  toJSON (PutIdentityRequest (Left sub)) = toJSON sub
  toJSON (PutIdentityRequest (Right ssub)) = toJSON ssub

instance FromJSON PutIdentityRequest where
  parseJSON o = fmap PutIdentityRequest $ (Left <$> parseJSON o) <|> (Right <$> parseJSON o)

instance ToJSON PutIdentityResponse where
  toJSON (PutIdentityResponse b) = toJSON b

instance FromJSON PutIdentityResponse where
  parseJSON = fmap PutIdentityResponse . parseJSON