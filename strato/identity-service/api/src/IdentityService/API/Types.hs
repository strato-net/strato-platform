{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeOperators #-}

module IdentityService.API.Types
  ( PostIdentityRequest(..),
    PostIdentityResponse(..)
  )
where

import BlockApps.X509
import Blockchain.Strato.Model.Secp256k1
import Control.Applicative ((<|>))
import Data.Aeson

newtype PostIdentityRequest = PostIdentityRequest (Either (Signed SubjectAndCert) (Signed (Signed SubjectAndCert)))

newtype PostIdentityResponse = PostIdentityResponse X509Certificate

instance ToJSON PostIdentityRequest where
  toJSON (PostIdentityRequest (Left sub)) = toJSON sub
  toJSON (PostIdentityRequest (Right ssub)) = toJSON ssub

instance FromJSON PostIdentityRequest where
  parseJSON o = fmap PostIdentityRequest $ (Left <$> parseJSON o) <|> (Right <$> parseJSON o)

instance ToJSON PostIdentityResponse where
  toJSON (PostIdentityResponse b) = toJSON b

instance FromJSON PostIdentityResponse where
  parseJSON = fmap PostIdentityResponse . parseJSON