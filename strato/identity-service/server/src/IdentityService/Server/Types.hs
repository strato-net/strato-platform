{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module IdentityService.Server.Types where

import BlockApps.X509 hiding (isValid)
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Monad.Change.Modify
import Control.Monad.Reader
import Data.Text (Text)
import Servant.Client hiding (manager, responseBody)
import Strato.Strato23.API
import UnliftIO hiding (Handler)

data IdentityError
  = IdentityError Text
  | ExistingIdentity Text
  deriving (Show, Exception)

data IdentityServerData = IdentityServerData
  { issuer :: Issuer, -- issuer of signing cert
    issuerCert :: X509Certificate, -- the signing cert
    issuerPrivKey :: PrivateKey,
    nodeUrl :: BaseUrl,
    userRegAddr :: Address,
    userRegCodeHash :: Maybe Keccak256,
    userTableName :: String,
    tokenEndpoint :: String,
    clientId :: String,
    clientSecret :: String
  }

instance Monad m => Accessible IdentityServerData (ReaderT IdentityServerData m) where
  access _ = ask