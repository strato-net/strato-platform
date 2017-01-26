{-# LANGUAGE
    DataKinds
  , FlexibleInstances
  , MultiParamTypeClasses
  , OverloadedStrings
  , TypeApplications
  , TypeOperators
#-}

module BlockApps.Bloc.API.Address where

import Data.Proxy
import Servant.API
import Servant.Client

import BlockApps.Bloc.API.Utils
import BlockApps.Data

type GetAddresses = "addresses" :> Get '[HTMLifiedJSON] [Address]
getAddresses :: ClientM [Address]
getAddresses = client (Proxy @ GetAddresses)

-- GET /addresses/:address/pending
type GetAddressesPending = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> Get '[JSON] NoContent
getAddressesPending :: Address -> ClientM NoContent
getAddressesPending = client (Proxy @ GetAddressesPending)

-- GET /addresses/:address/pending/remove/:time
type GetAddressesPendingRemove = "addresses"
  :> Capture "address" Address
  :> "pending"
  :> "remove"
  :> Capture "time" Int
  :> Get '[JSON] NoContent
getAddressesPendingRemove :: Address -> Int -> ClientM NoContent
getAddressesPendingRemove = client (Proxy @ GetAddressesPendingRemove)
