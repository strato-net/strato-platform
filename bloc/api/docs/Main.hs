{-# LANGUAGE
    DataKinds
  , OverloadedStrings
#-}

module Main where

import Control.Lens ((&), (.~), (?~))
import BlockApps.Bloc.API (blocApi)
import Data.Swagger
import Servant
import Servant.Swagger
import Servant.Swagger.UI
import Network.Wai.Handler.Warp

type SwaggerizedAPI = SwaggerSchemaUI "swagger-ui" "swagger.json"

swaggerizedAPI :: Proxy SwaggerizedAPI
swaggerizedAPI = Proxy

iamSwagger :: Swagger
iamSwagger = toSwagger blocApi
    & info.title   .~ "Bloc API"
    & info.version .~ "0.1"
    & info.description ?~ "This is the API for the BlocH"
    & host ?~ Host "localhost" (Just 8000)

server :: Server SwaggerizedAPI
server = swaggerSchemaUIServer iamSwagger

app :: Application
app = serve swaggerizedAPI server

main :: IO ()
main = run 8080 app
