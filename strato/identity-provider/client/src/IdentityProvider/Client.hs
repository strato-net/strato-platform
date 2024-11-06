{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeApplications #-}

module IdentityProvider.Client
  ( getPing,
    putIdentity,
  )
where

import API.Parametric
import Blockchain.Strato.Model.Address
import Data.Text
import IdentityProvider.API
import Servant.API
import Servant.Client

getPing :: ClientM Int
getPing = client (Proxy @GetPingIdentity)

putIdentity :: 
  ServerEmbed ExternalHeaders
  (Maybe Text ->
   Maybe Bool ->
   ClientM Address)
putIdentity = client (Proxy @(PutIdentity '[Required, Strict] ExternalHeaders))
