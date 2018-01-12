module BlockApps.Bloc21.Server.Addresses where

import           BlockApps.Bloc21.Database.Queries
import           BlockApps.Bloc21.Monad
import           BlockApps.Ethereum

getAddresses :: Bloc [Address]
getAddresses = blocTransaction $ blocQuery getAddressesQuery
