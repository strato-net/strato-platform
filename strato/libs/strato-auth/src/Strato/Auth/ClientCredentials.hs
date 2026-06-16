{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Strato.Auth.ClientCredentials
  ( ClientCredentialsConfig(..)
  , clientCredentialsConfig
  , clientCredentialsPath
  , loadClientCredentials
  ) where

import Control.Exception (throwIO)
import Data.Aeson (FromJSON, ToJSON)
import qualified Data.ByteString as BS
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
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

-- | Client credentials loaded from the standard location. Lazily evaluated:
-- processes that only ever use 'runWithUserToken' (e.g. strato-api) never force
-- this, so a missing default credentials file is not an error for them.
{-# NOINLINE clientCredentialsConfig #-}
clientCredentialsConfig :: ClientCredentialsConfig
clientCredentialsConfig = unsafePerformIO $ loadClientCredentials clientCredentialsPath

-- | Load client credentials from an explicit path. Used to give the sequencer
-- and the p2p/discover pair distinct vault identities within one container.
--
-- Accepts two on-disk formats:
--
--   * YAML object — @discoveryUrl@/@clientId@/@clientSecret@ keys (what
--     'doit.sh' and strato-login write).
--   * Shell/env style — @OAUTH_DISCOVERY_URL=@/@OAUTH_CLIENT_ID=@/
--     @OAUTH_CLIENT_SECRET=@ lines (the same names used as container env vars),
--     since that's the form operators naturally reach for when hand-writing the
--     per-role files in ~/.secrets.
--
-- YAML is tried first; on failure we try the env form, and if that doesn't yield
-- all three fields we re-raise the original YAML parse error so the message
-- still points at the real file.
loadClientCredentials :: FilePath -> IO ClientCredentialsConfig
loadClientCredentials path = do
  bytes <- BS.readFile path
  case YAML.decodeEither' bytes of
    Right cfg -> pure cfg
    Left yamlErr -> case parseEnvCredentials (TE.decodeUtf8 bytes) of
      Just cfg -> pure cfg
      Nothing  -> throwIO yamlErr

-- | Parse @KEY=VALUE@ lines into a 'ClientCredentialsConfig'. Surrounding
-- quotes on values are stripped; missing any required key yields 'Nothing'.
parseEnvCredentials :: T.Text -> Maybe ClientCredentialsConfig
parseEnvCredentials txt =
  ClientCredentialsConfig
    <$> lookup' "OAUTH_DISCOVERY_URL"
    <*> lookup' "OAUTH_CLIENT_ID"
    <*> lookup' "OAUTH_CLIENT_SECRET"
  where
    kvs =
      [ (T.strip k, unquote (T.strip (T.drop 1 rest)))
      | line <- T.lines txt
      , let (k, rest) = T.breakOn "=" line
      , not (T.null rest)
      ]
    lookup' k = lookup k kvs
    unquote v
      | T.length v >= 2 && T.head v == '"'  && T.last v == '"'  = T.dropEnd 1 (T.drop 1 v)
      | T.length v >= 2 && T.head v == '\'' && T.last v == '\'' = T.dropEnd 1 (T.drop 1 v)
      | otherwise = v
