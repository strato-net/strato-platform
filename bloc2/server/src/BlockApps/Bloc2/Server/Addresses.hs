module BlockApps.Bloc2.Server.Addresses where

import           BlockApps.Bloc2.Database.Queries
import           BlockApps.Bloc2.Monad
import           BlockApps.Ethereum

getAddresses :: Bloc [Address]
getAddresses = blocTransaction $ blocQuery getAddressesQuery
