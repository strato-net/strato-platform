{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE DeriveGeneric  #-}

module Strato.Strato23.API.Signature where

import           Servant.API
import           GHC.Generics
import           Data.Aeson.Types
import           Data.Text

--------------------------------------------------------------------------------
-- Routes and Types
--------------------------------------------------------------------------------
type PostSignature = "strato" :> "v2.3" :> "signature" :> Header "X-USER-UNIQUE-NAME" Text :> Post '[JSON] SignatureDetails

data SignatureDetails = SignatureDetails {
  r :: String
  , s :: String
  , v :: String
  , k :: Maybe Text
} deriving (Eq, Show, Generic)

instance ToJSON SignatureDetails
instance FromJSON SignatureDetails