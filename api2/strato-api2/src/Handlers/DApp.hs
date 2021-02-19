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

module Handlers.DApp (
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

newtype DAppPackage =
  DAppPackage String
  deriving (Generic)

instance ToSchema DAppPackage where
instance FromJSON DAppPackage where
  
data DAppInfo =
  DAppInfo {
    name :: String
    } deriving (Generic)

instance ToSchema DAppInfo where
instance ToJSON DAppInfo where
  

type API = Tags "Contracts"
           :> Summary "Get list of DApps"
           :> Description "DApps are named contract bundles deployed by all participants on the network."
           :> "dapp" :> Get '[JSON] [DAppInfo]
           
           :<|> Tags "Contracts"
           :> Summary "Upload a new DApp"
           :> Description "DApps bundles are uploaded as a single zip file."
           :> "dapp" :> ReqBody '[JSON] DAppPackage :> Post '[JSON] RecordLocation

server :: Monad m =>
          ServerT API m
server = getDApp :<|>  postDApp

---------------------

getDApp :: Monad m =>
           m [DAppInfo]
getDApp = error "'GET /dapp' not implemented"

postDApp :: Monad m =>
            DAppPackage -> m RecordLocation
postDApp _ = error "'POST /dapp' not implemented"

