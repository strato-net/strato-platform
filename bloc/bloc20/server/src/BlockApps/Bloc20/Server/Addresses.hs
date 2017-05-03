module BlockApps.Bloc20.Server.Addresses where

import           BlockApps.Bloc20.Database.Queries
import           BlockApps.Bloc20.Monad
import           BlockApps.Ethereum

getAddresses :: Bloc [Address]
getAddresses = blocTransaction $ blocQuery getAddressesQuery
