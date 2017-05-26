{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE TypeOperators              #-}
{-# LANGUAGE TypeApplications           #-}

module Main where

import           Network.Wai.Handler.Warp
import           Servant
import           Servant.Swagger
import qualified BlockApps.Strato.API as Strato
import           Control.Lens.Operators
import           Data.Proxy()
import           Data.Swagger
import           Network.Wai.Middleware.Cors (cors, corsRequestHeaders,
                                              simpleCorsResourcePolicy,
                                              simpleHeaders)
                                        
-- | API for serving @swagger.json@.
type SwaggerAPI = "swagger.json" :> Get '[JSON] Swagger

stratoSwagger :: Swagger
stratoSwagger = toSwagger (Proxy @Strato.API)
  & info.title   .~ "Strato API"
  & info.version .~ "1.2"
  & info.description ?~ "This is the strato api"
  & info.license ?~ ("MIT" & url ?~ URL "http://mit.com")
  & host ?~ "strato-int.centralus.cloudapp.azure.com" -- remove this 
  & basePath ?~ "/strato-api/eth/v1.2/"

server :: Server SwaggerAPI 
server = return stratoSwagger

main :: IO ()
main = do
    putStrLn "Running on port 8000"
    run 8000 $ cors (const $ Just policy) $ serve (Proxy :: Proxy SwaggerAPI) server
  where
    policy = simpleCorsResourcePolicy
      { corsRequestHeaders = simpleHeaders }
