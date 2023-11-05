{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Server where

--import Control.Lens ((&), (.~), (?~))
import Data.Proxy
--import Data.Swagger as Swag
import Servant
--import Servant.Swagger (toSwagger)
import API
import Strato.Monad
import Strato.Server.GetS3File
import Strato.Server.PutS3File


highwayWrapper :: ServerT HighwayWrapperAPI HighwayM
highwayWrapper =
  getS3File
    :<|> putS3File

serveHighwayWrapper :: HighwayWrapperEnv -> Server HighwayWrapperAPI
serveHighwayWrapper env = hoistServer serverProxy (enterHighwayWrapper env) highwayWrapper

serverProxy :: Proxy HighwayWrapperAPI
serverProxy = Proxy

{-
highwayWrapperSwagger :: Swagger
highwayWrapperSwagger =
  toSwagger (Proxy @HighwayWrapperAPI)
    & info . title .~ "Highway Wrapper API"
    & info . Swag.version .~ "2.3"
    & info . description ?~ "This is the V2.3 API for Highway Wrapper"
    & basePath ?~ "/strato/v2.3"

type HighwayWrapperDocsAPI = "swagger.json" :> Get '[JSON] Swagger
-}
