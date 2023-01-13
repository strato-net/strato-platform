{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}


module Handlers.Cert (
  API,
  server,
  RecordLocation(..)
  ) where

import           Data.Aeson
--import           Data.ByteString                     (ByteString)
import           Data.Swagger.Schema
import           GHC.Generics
import           Servant
import           Servant.Swagger.Tags

import           Blockchain.Data.Json                ()
import           Handlers.Record                     (RecordLocation(..))

data Cert =
  Cert String
  deriving (Generic)

instance ToSchema Cert where
instance FromJSON Cert where


type API = Tags "Users"
           :> Summary "Register an x509 cert on the blockchain"
           :> Description "Create a new cert, and register it on the blockchain.  Users need to be registered before they can post transactions, join private chains, and even connect to the blockchain.  Cert should be uploaded as a single PEM encoded string."
           :> "cert" :> ReqBody '[JSON] Cert :> Post '[JSON] RecordLocation

server :: Monad m => ServerT API m
server = postCert

---------------------

postCert :: Monad m =>
            Cert -> m RecordLocation
postCert _ = return $ PrivateRecord 0 0 0

