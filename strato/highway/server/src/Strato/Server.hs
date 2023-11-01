{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Server where

import Control.Lens ((&), (.~), (?~))
import Data.Proxy
import Data.Swagger as Swag
import Servant
import Servant.Swagger (toSwagger)
import Strato.Strato23.API
import Strato.Strato23.Monad
import Strato.Strato23.Server.Key
import Strato.Strato23.Server.Password
import Strato.Strato23.Server.Ping
import Strato.Strato23.Server.Signature
import Strato.Strato23.Server.User

highwayWrapper :: ServerT HighwayWrapperAPI HighwayM
highwayWrapper =
  getS3File
    :<|> putS3File

serveHighwayWrapper :: HighwayWrapperEnv -> Server HighwayWrapperAPI
serveHighwayWrapper env = hoistServer serverProxy (enterHighwayWrapper env) highwayWrapper

serverProxy :: Proxy HighwayWrapperAPI
serverProxy = Proxy

highwayWrapperSwagger :: Swagger
highwayWrapperSwagger =
  toSwagger (Proxy @HighwayWrapperAPI)
    & info . title .~ "Highway Wrapper API"
    & info . Swag.version .~ "2.3"
    & info . description ?~ "This is the V2.3 API for Highway Wrapper"
    & basePath ?~ "/strato/v2.3"

type HighwayWrapperDocsAPI = "swagger.json" :> Get '[JSON] Swagger
