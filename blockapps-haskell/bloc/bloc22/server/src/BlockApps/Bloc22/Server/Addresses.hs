module BlockApps.Bloc22.Server.Addresses where

import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum

getAddresses :: Bloc [Address]
getAddresses = blocTransaction $ blocQuery getAddressesQuery
