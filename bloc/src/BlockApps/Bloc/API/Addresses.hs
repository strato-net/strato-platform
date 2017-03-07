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

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Database.Queries
import BlockApps.Ethereum

class Monad m => MonadAddresses m where
  getAddresses :: m [Address]
instance MonadAddresses ClientM where
  getAddresses = client (Proxy @ GetAddresses)
instance MonadAddresses Bloc where
  getAddresses = blocQuery getAddressesQuery

type GetAddresses = "addresses" :> Get '[HTMLifiedJSON] [Address]
