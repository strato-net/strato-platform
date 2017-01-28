{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Search where

import Data.Aeson
import Data.Aeson.Casing
import Data.HashMap.Strict (HashMap)
import Data.Proxy
import Data.Text (Text)
import Generic.Random.Generic
import GHC.Generics
import Servant.API
import Servant.Client
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data

class Monad m => MonadSearchContract m where
  getSearchContract :: ContractName -> m UnstructuredJSON
  getSearchContractState :: ContractName -> m [SearchContractState]
  getSearchContractStateReduced :: ContractName -> [Text] -> m [SearchContractState]
instance MonadSearchContract ClientM where
  getSearchContract = client (Proxy @ GetSearchContract)
  getSearchContractState = client (Proxy @ GetSearchContractState)
  getSearchContractStateReduced = client (Proxy @ GetSearchContractStateReduced)
instance MonadSearchContract Bloc where
  getSearchContract = undefined
  getSearchContractState = undefined
  getSearchContractStateReduced = undefined

-- GET /search/:contractName
type GetSearchContract = "search"
  :> Capture "contractName" ContractName
  :> Get '[OctetStream] UnstructuredJSON

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
  , searchcontractstateState :: HashMap Text UnstructuredJSON
  } deriving (Eq, Show, Generic)
instance ToJSON SearchContractState where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance FromJSON SearchContractState where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToSample SearchContractState where
  toSamples _ = noSamples
instance Arbitrary SearchContractState where
  arbitrary = genericArbitrary
