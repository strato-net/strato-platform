{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.ComposeTypes
  ( ComposeFile(..)
  , Service(..)
  , Healthcheck(..)
  , Logging(..)
  , LoggingOptions(..)
  ) where

import Data.Aeson ()
import Data.Aeson.TH
import Data.Default
import Data.Map (Map)
import GHC.Generics
import Prelude hiding (init)

-- | Logging options (max-size, max-file)
data LoggingOptions = LoggingOptions
  { max_size :: Maybe String
  , max_file :: Maybe String
  } deriving stock (Show, Eq, Generic)
    deriving anyclass (Default)

deriveJSON defaultOptions
  { omitNothingFields = True
  , fieldLabelModifier = map (\c -> if c == '_' then '-' else c)
  } ''LoggingOptions

-- | Logging configuration
data Logging = Logging
  { driver :: String
  , options :: Maybe LoggingOptions
  } deriving stock (Show, Eq, Generic)
    deriving anyclass (Default)

deriveJSON defaultOptions { omitNothingFields = True } ''Logging

-- | Healthcheck configuration
data Healthcheck = Healthcheck
  { test :: [String]
  , interval :: Maybe String
  , timeout :: Maybe String
  , retries :: Maybe Int
  } deriving stock (Show, Eq, Generic)
    deriving anyclass (Default)

deriveJSON defaultOptions { omitNothingFields = True } ''Healthcheck

-- | Service definition
data Service = Service
  { image :: String
  , build :: Maybe String
  , depends_on :: Maybe [String]
  , environment :: Maybe (Map String String)  -- Map format: KEY: value
  , volumes :: Maybe [String]
  , ports :: Maybe [String]
  , command :: Maybe [String]
  , user :: Maybe String
  , restart :: Maybe String
  , init :: Maybe Bool
  , healthcheck :: Maybe Healthcheck
  , logging :: Maybe Logging
  , extra_hosts :: Maybe [String]
  } deriving stock (Show, Eq, Generic)
    deriving anyclass (Default)

deriveJSON defaultOptions { omitNothingFields = True } ''Service

-- | Top-level docker-compose.yml structure
data ComposeFile = ComposeFile
  { services :: Map String Service
  } deriving stock (Show, Eq, Generic)
    deriving anyclass (Default)

deriveJSON defaultOptions { omitNothingFields = True } ''ComposeFile
