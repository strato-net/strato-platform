{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}

module Main where

import           BlockApps.Bloc22.API       (blocApi)
import           Control.Lens             ((&), (.~), (?~))
import           Data.Swagger
import           Data.String
import           Network.Wai.Handler.Warp
import           Servant
import           Servant.Swagger
import           Servant.Swagger.UI

type SwaggerizedAPI = SwaggerSchemaUI "swagger-ui" "swagger.json"

swaggerizedAPI :: Proxy SwaggerizedAPI
swaggerizedAPI = Proxy

blocHost :: IsString string => string
blocHost = "localhost"

blocPort :: Num x => x
blocPort = 8000

blocPath :: FilePath
blocPath = "/bloc/v2.2"

docPort :: Num x => x
docPort = 8080

blocSwagger :: Swagger
blocSwagger = toSwagger blocApi
    & info.title   .~ "Bloc API"
    & info.version .~ "2.2"
    & info.description ?~ "This is the API for the BlocH"
    & host ?~ Host blocHost (Just blocPort)
    & basePath .~ Just blocPath

docServer :: Server SwaggerizedAPI
docServer = swaggerSchemaUIServer blocSwagger

docApp :: Application
docApp = serve swaggerizedAPI docServer

main :: IO ()
main = run docPort docApp
