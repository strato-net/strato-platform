{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeOperators         #-}

module BlockApps.Bloc.API.Search where

import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Map.Strict                  (Map)
import           Data.Text                        (Text)
import           Generic.Random.Generic
import           GHC.Generics
import           Servant.API
import           Servant.Docs

import           Test.QuickCheck
import           Test.QuickCheck.Instances        ()

import           BlockApps.Bloc.API.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.SolidityValue
import           BlockApps.Solidity.Xabi

--------------------------------------------------------------------------------
-- | Routes and Types
--------------------------------------------------------------------------------

-- GET /search/:contractName
type GetSearchContract = "search"
  :> Capture "contractName" ContractName
  :> Get '[OctetStream, JSON] [MaybeNamed Address]

-- GET /search/:contractName/state
type GetSearchContractState = "search"
  :> Capture "contractName" ContractName
  :> "state"
  :> Get '[JSON] [SearchContractState]

-- GET /search/:contractName/state/reduced
type GetSearchContractStateReduced = "search"
  :> Capture "contractName" ContractName
  :> "state"
  :> "reduced"
  :> QueryParams "props" Text
  :> Get '[JSON] [SearchContractState]
instance ToParam (QueryParams "props" Text) where
  toParam _ = DocQueryParam "props" ["id","value"] "Names of contract variables" List

data SearchContractState = SearchContractState
  { searchcontractstateAddress :: Address
  , searchcontractstateState   :: Map Text SolidityValue
  } deriving (Eq, Show, Generic)
instance ToJSON SearchContractState where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON SearchContractState where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample SearchContractState where
  toSamples _ = noSamples
instance Arbitrary SearchContractState where
  arbitrary = genericArbitrary uniform
