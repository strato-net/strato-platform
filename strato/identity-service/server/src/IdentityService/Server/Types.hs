{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module IdentityService.Server.Types where

import BlockApps.X509 hiding (isValid)
import Blockchain.Strato.Model.Keccak256
import Control.Monad.Change.Modify
import Control.Monad.Reader
import Data.Text (Text)
import Servant.Client hiding (manager, responseBody)
import Strato.Strato23.API
import UnliftIO hiding (Handler)

data IdentityError
  = IdentityError Text
  deriving (Show, Exception)

data IdentityServerData = IdentityServerData
  { issuer :: Issuer, -- issuer of signing cert
    issuerCert :: X509Certificate, -- the signing cert
    nodeUrl :: BaseUrl,
    userRegAddr :: Address,
    userRegCodeHash :: Maybe Keccak256,
    userTableName :: String
  }

instance Monad m => Accessible IdentityServerData (ReaderT IdentityServerData m) where
  access _ = ask