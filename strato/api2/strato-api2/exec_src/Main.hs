{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}
 
module Main where

import           Control.Lens.Operators
import           Control.Monad.Trans.Except
import           Data.Proxy
import           Data.Swagger
import           HFlags
import           Network.Wai
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Cors
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Middleware.RequestLogger
import           Servant
import           Servant.Swagger
import           Servant.Swagger.UI
import           UnliftIO                        hiding (Handler)


import           API
import           BlockApps.Logging
import           BlockApps.Init
import           Control.Monad.Composable.SQL    hiding (SQLM)
import           Control.Monad.Composable.Vault  hiding (httpManager)
import           Error404Paths
import           Options                         ()
import           SelectAccessible                ()
import           SQLM

hoistCoreServer :: SQLEnv -> Server API
hoistCoreServer sqlEnv = hoistServer (Proxy :: Proxy API) (convertErrors runM) server
  where
    convertErrors r x = Handler $ do
      y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e
    runM f =
      runLoggingT .
        runSQLMUsingEnv sqlEnv .
        runVaultM "http://vault-proxy:8000/strato/v2.3" $ f

api :: Proxy API
api = Proxy

main :: IO ()
main = do
  _ <- $initHFlags "STRATO API"

  let theDoc = toSwagger (Proxy :: Proxy API)
               & info.title .~ "STRATO API"
               & info.description ?~
               "This is the great STRATO API, which let's \
               \ you query the blockchain."
               & info.version .~ "2.0"

  --print theDoc
  blockappsInit "core-api"

  sqlEnv <- createSQLEnv
  
  run 3001 $ app sqlEnv theDoc

type DocAPI =   "docs" :> "v2.0" :> SwaggerSchemaUI "swagger-ui" "swagger.json"

app :: SQLEnv -> Swagger -> Application
app sqlEnv theDoc = 
  prometheus def{prometheusInstrumentApp = False}
  $ instrumentApp "core-api"
  $ logStdoutDev
  $ cors (const $ Just simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]})
--  $ serve (Proxy :: Proxy (API :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
  $ addPathsTo404
  $ serve (Proxy :: Proxy (API :<|> DocAPI))
  $ hoistCoreServer sqlEnv :<|> swaggerSchemaUIServer theDoc
