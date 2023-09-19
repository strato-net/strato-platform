{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

---This file gets all of the Oauth information from the OpenId Connect server
module Strato.VaultProxy.RawOauth where

import Data.Cache as C
import Data.Proxy
import qualified Data.Text as T
import Servant.API as SA
import Servant.Client
import Strato.VaultProxy.DataTypes

type ContentType' = T.Text

type Authorization = T.Text

type BlockAppsTokenRequest = [(T.Text, T.Text)]

type InitialCallForTokenLinkAPI =
  Get '[SA.JSON] RawOauth

type BlockAppsTokenAPI =
  SA.Header "Content-Type" ContentType'
    :> SA.Header "Authorization" Authorization
    :> ReqBody '[SA.JSON] BlockAppsTokenRequest
    :> Get '[SA.JSON] VaultToken

type VaultCache = Cache T.Text VaultToken

rawOAuthAPI :: Proxy InitialCallForTokenLinkAPI
rawOAuthAPI = Proxy

blockappsTokenApi :: Proxy BlockAppsTokenAPI
blockappsTokenApi = Proxy

getRawOauth :: ClientM RawOauth
getRawOauth = client rawOAuthAPI

connectRawOauth :: ClientM RawOauth
connectRawOauth = getRawOauth
