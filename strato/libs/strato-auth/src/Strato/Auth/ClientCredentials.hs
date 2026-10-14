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
import Data.Maybe (fromMaybe)
import System.Environment (lookupEnv)
import System.IO.Unsafe (unsafePerformIO)

-- | OAuth client credentials for service-to-service authentication
data ClientCredentialsConfig = ClientCredentialsConfig
  { discoveryUrl :: T.Text
  , clientId :: T.Text
  , clientSecret :: T.Text
  } deriving (Show, Eq, Generic)

instance FromJSON ClientCredentialsConfig
instance ToJSON ClientCredentialsConfig

-- | Standard location for the client credentials file, relative to the
-- working directory; @$STRATO_OAUTH_CREDENTIALS@ overrides it so a process
-- can run outside a node directory (the API tier container).
clientCredentialsPath :: IO FilePath
clientCredentialsPath = fromMaybe "secrets/oauth_credentials.yaml" <$> lookupEnv "STRATO_OAUTH_CREDENTIALS"

-- | Client credentials loaded from the standard location
{-# NOINLINE clientCredentialsConfig #-}
clientCredentialsConfig :: ClientCredentialsConfig
clientCredentialsConfig = unsafePerformIO $ YAML.decodeFileThrow =<< clientCredentialsPath
