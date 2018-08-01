{-# OPTIONS_GHC -fno-warn-unused-binds #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DataKinds  #-}
{-# LANGUAGE DeriveGeneric  #-}
{-# LANGUAGE TypeApplications #-}

module Strato.Strato23.API where

import           Servant
import           GHC.Generics
import           Data.Aeson.Types

type StratoAPI = "_ping" :> Get '[JSON] String
  :<|> Header "X-User" String :> "strato" :> "v2.3" :> "signature" :> Post '[JSON] SignatureDetails

data SignatureDetails = SignatureDetails {
  r :: String
  , s :: String
  , v :: String
} deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails