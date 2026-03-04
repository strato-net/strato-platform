{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Strato.Auth.ClientCredentials
  ( ClientCredentialsConfig(..)
  , clientCredentialsConfig
  , clientCredentialsPath
  ) where

import Data.Aeson (FromJSON, ToJSON)
import qualified Data.Text as T
import qualified Data.Yaml as YAML
import GHC.Generics (Generic)
import System.IO.Unsafe (unsafePerformIO)

-- | OAuth client credentials for service-to-service authentication
data ClientCredentialsConfig = ClientCredentialsConfig
  { discoveryUrl :: T.Text
  , clientId :: T.Text
  , clientSecret :: T.Text
  } deriving (Show, Eq, Generic)

instance FromJSON ClientCredentialsConfig
instance ToJSON ClientCredentialsConfig

-- | Standard location for client credentials file
clientCredentialsPath :: FilePath
clientCredentialsPath = "secrets/oauth_credentials.yaml"

-- | Client credentials loaded from the standard location
{-# NOINLINE clientCredentialsConfig #-}
clientCredentialsConfig :: ClientCredentialsConfig
clientCredentialsConfig = unsafePerformIO $ YAML.decodeFileThrow clientCredentialsPath
