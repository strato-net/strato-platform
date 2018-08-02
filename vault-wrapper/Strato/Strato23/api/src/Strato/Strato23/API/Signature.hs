{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.API.Signature where

import           Servant.API
import           GHC.Generics
import           Data.Aeson.Types

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature = "strato" :> "v2.3" :> "signature" :> Post '[JSON] SignatureDetails

data SignatureDetails = SignatureDetails {
  r :: String
  , s :: String
  , v :: String
} deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails