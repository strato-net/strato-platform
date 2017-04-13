module BlockApps.Bloc.Server.Addresses where

import BlockApps.Bloc.Monad
import BlockApps.Bloc.Database.Queries
import BlockApps.Ethereum

class Monad m => MonadAddresses m where
  getAddresses :: m [Address]

instance MonadAddresses Bloc where
  getAddresses = blocTransaction $ blocQuery getAddressesQuery
