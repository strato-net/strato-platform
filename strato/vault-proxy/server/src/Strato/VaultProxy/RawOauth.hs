{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

---This file gets all of the Oauth information from the OpenId Connect server
module Strato.VaultProxy.RawOauth where


-- import           Control.Concurrent.STM
-- import           Control.Lens
-- import           Control.Monad.Catch
-- import           Control.Monad.Composable.VaultProxy
-- import           Control.Monad.IO.Class
-- import           Control.Monad.Reader
-- import           Control.Monad.Change.Modify
-- import           Data.Aeson  
-- import           Data.Aeson.Types
-- import           Data.ByteString.Base64
import           Data.Cache               as C
-- import           Data.Cache.Internal      as C
-- import           Data.Maybe
import           Data.Proxy
-- import qualified Data.Scientific         as Scientific
import qualified Data.Text               as T
-- import           Data.Text.Encoding      as TE
-- import           GHC.Generics
-- import           Network.HTTP.Client     as HTC hiding (Proxy)
-- import           Network.HTTP.Req        as R
import           Servant.API             as SA
-- import           Servant.Auth            as SAA
-- import           Servant.Auth.Server     as SAS
import           Servant.Client
-- import           Servant.Server          as SS
-- import           System.Clock
-- import           Text.URI                as URI
-- import           Yesod.Core.Types        as YC

import Strato.VaultProxy.DataTypes
-- import Data.Text        as T

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

-- type VaultProxyAPI = Auth '[SAA.JWT, SAA.BasicAuth] Types.User :> "vault-proxy" :> VaultAPI

rawOAuthAPI :: Proxy InitialCallForTokenLinkAPI
rawOAuthAPI = Proxy

blockappsTokenApi :: Proxy BlockAppsTokenAPI
blockappsTokenApi = Proxy

getRawOauth :: ClientM RawOauth
getRawOauth = client rawOAuthAPI

connectRawOauth :: ClientM RawOauth
connectRawOauth = getRawOauth
