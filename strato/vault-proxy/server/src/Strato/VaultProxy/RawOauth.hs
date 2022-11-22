---This file gets all of the Oauth information from the OpenId Connect server

import Strato.VaultProxy.DataTypes
import Data.Text        as T

type ContentType' = T.Text
type Authorization = T.Text
type BlockAppsTokenRequest = [(T.Text, T.Text)]
-- type AccessToken = (ClientM VaultToken, Int64)

type InitialCallForTokenLinkAPI =
    Get '[SA.JSON] RawOauth

type BlockAppsTokenAPI = 
  SA.Header "Content-Type" ContentType'
  :> SA.Header "Authorization" Authorization
  :> ReqBody '[SA.JSON] BlockAppsTokenRequest
  :> Get '[SA.JSON] VaultToken

type VaultCache = Cache T.Text VaultToken

type VaultProxyAPI = Auth '[SAA.JWT, SAA.BasicAuth] Types.User :> "vault-proxy" :> VaultAPI

rawOAuthAPI :: Proxy InitialCallForTokenLinkAPI
rawOAuthAPI = Proxy

blockappsTokenApi :: Proxy BlockAppsTokenAPI
blockappsTokenApi = Proxy

getRawOauth :: ClientM RawOauth
getRawOauth = client rawOAuthAPI

connectRawOauth :: ClientM RawOauth
connectRawOauth = getRawOauth
