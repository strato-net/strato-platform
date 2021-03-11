{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.Version (
  API,
  server
  ) where

import           Data.Aeson
import           GHC.Generics
import           Servant
import           Servant.Swagger.Tags

import           Versioning

type API = Tags "Strato"
           :> Summary "The Version of this Strato Peer."
--           :> Description ""
           :> "version" :> Get '[JSON] Value

server :: Applicative m => ServerT API m
server = getVersion

-------------------------

data Repo = Repo { name   :: String
                 , url    :: String
                 , sha    :: String
                 , branch :: String
                 } deriving (Show, Generic)

instance ToJSON Repo

getVersion :: Applicative m => m Value
getVersion = pure $ object ["monostrato" .= Repo "monostrato" "" $(gitHashMonostrato) $(gitBranchMonostrato)
                           --,"stack.yaml" .= ("stack" :: String, $(stackYaml) :: String) --(liftIO $ getStackInfo)
                           ]
