{-# OPTIONS_GHC -fno-warn-unused-binds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DataKinds  #-}
{-# LANGUAGE DeriveGeneric  #-}
{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.API where

import           Servant
import           GHC.Generics
import           Data.Aeson.Types

type StratoAPI = 
  "users" :> Get '[JSON] [User]

data User = User
  { name :: String
  , age :: Int
  , email :: String
  } deriving (Eq, Show, Generic)

instance ToJSON User
instance FromJSON User