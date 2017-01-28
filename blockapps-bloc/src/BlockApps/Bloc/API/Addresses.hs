{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE
    DataKinds
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Addresses where

import Data.Proxy
import Servant.API
import Servant.Client
import Servant.Docs

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Data

class Monad m => MonadAddresses m where
  getAddresses :: m [Address]
  getAddressesPending :: Address -> m NoContent
  getAddressesPendingRemove :: Address -> Int -> m NoContent
instance MonadAddresses ClientM where
  getAddresses = client (Proxy @ GetAddresses)
  getAddressesPending = client (Proxy @ GetAddressesPending)
  getAddressesPendingRemove = client (Proxy @ GetAddressesPendingRemove)
instance MonadAddresses Bloc where
  getAddresses = undefined
  getAddressesPending = undefined
  getAddressesPendingRemove = undefined

type GetAddresses = "addresses" :> Get '[HTMLifiedJSON] [Address]

-- GET /addresses/:address/pending
type GetAddressesPending = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> Get '[JSON] NoContent

-- GET /addresses/:address/pending/remove/:time
type GetAddressesPendingRemove = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> "remove"
  :> Capture "time" Int
  :> Get '[JSON] NoContent
instance ToCapture (Capture "time" Int) where
  toCapture _ = DocCapture "time" "a unix timestamp"
