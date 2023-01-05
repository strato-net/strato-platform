{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

---This file gets all of the Oauth information from the OpenId Connect server
module Strato.VaultProxy.GetPing (
  connectGetPing
) where

import           Data.Proxy
import           Servant.API             as SA
import           Servant.Client

import Strato.VaultProxy.DataTypes

type InitialPingCall = Get '[SA.JSON] RawPing

rawPingAPI :: Proxy InitialPingCall
rawPingAPI = Proxy

getRawPing :: ClientM RawPing
getRawPing = client rawPingAPI

connectGetPing :: ClientM RawPing
connectGetPing = getRawPing