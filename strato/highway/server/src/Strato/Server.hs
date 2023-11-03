{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Server where

--import Control.Lens ((&), (.~), (?~))
import Control.Monad.Logger
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Resource
import Data.Proxy
--import Data.Swagger as Swag
import Servant
import Servant.Multipart
import Servant.Server
--import Servant.Swagger (toSwagger)

import API
import Blockchain.Strato.Model.Keccak256
import Strato.API
import Strato.Monad
import Strato.Server.GetS3File
import Strato.Server.PutS3File


--highwayWrapper :: ServerT HighwayWrapperAPI HighwayM
--highwayWrapper :: (Keccak256 -> LoggingT IO ()) :<|> (MultipartData Mem -> LoggingT IO ())
highwayWrapper =
  getS3File
    :<|> putS3File
  --(getS3File :: Keccak256 -> LoggingT IO ())
  --  :<|> (putS3File :: MultipartData Mem -> LoggingT IO ())

--serveHighwayWrapper :: HighwayWrapperEnv -> Server HighwayWrapperAPI
--serveHighwayWrapper env = hoistServer serverProxy (enterHighwayWrapper env) highwayWrapper

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
