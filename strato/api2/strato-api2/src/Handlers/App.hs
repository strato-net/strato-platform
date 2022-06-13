{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-redundant-constraints #-}

module Handlers.App (
  API,
  server
  ) where

--import           Control.Lens.Operators
import           Data.Aeson
--import           Data.ByteString                     (ByteString)
import           Data.Swagger
--import           Data.Swagger.Schema
import           GHC.Generics
import           Servant
import           Servant.Swagger.Tags

import           Blockchain.Data.Json                ()
import           Handlers.Record                     (RecordLocation(..))

newtype AppPackage =
  AppPackage String
  deriving (Generic)

instance ToSchema AppPackage where
instance FromJSON AppPackage where
  
data AppInfo =
  AppInfo {
    name :: String
  } deriving (Generic)

instance ToSchema AppInfo where
instance ToJSON AppInfo where
  

type API = Tags "Contracts"
           :> Summary "Get list of Apps"
           :> Description "Apps are named contract bundles deployed by all participants on the network."
           :> "app" :> Get '[JSON] [AppInfo]
           
           :<|> Tags "Contracts"
           :> Summary "Upload a new App"
           :> Description "Apps bundles are uploaded as a single zip file."
           :> "app" :> ReqBody '[JSON] AppPackage :> Post '[JSON] RecordLocation

server :: Monad m =>
          ServerT API m
server = getApp :<|>  postApp

---------------------

getApp :: Monad m =>
           m [AppInfo]
getApp = error "'GET /app' not implemented"

postApp :: Monad m =>
            AppPackage -> m RecordLocation
postApp _ = error "'POST /app' not implemented"

