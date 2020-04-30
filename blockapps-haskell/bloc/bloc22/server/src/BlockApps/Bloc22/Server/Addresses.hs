module BlockApps.Bloc22.Server.Addresses where

import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           Blockchain.Strato.Model.Address

getAddresses :: Bloc [Address]
getAddresses = blocTransaction $ blocQuery getAddressesQuery
