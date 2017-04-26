module BlockApps.Bloc.Server.Addresses where

import           BlockApps.Bloc.Database.Queries
import           BlockApps.Bloc.Monad
import           BlockApps.Ethereum

getAddresses :: Bloc [Address]
getAddresses = blocTransaction $ blocQuery getAddressesQuery
