{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Bloc22.Server.Search where

import           BlockApps.Bloc22.API.Search
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId

getSearchContract :: ContractName -> Bloc [Greedy Address ChainId]
getSearchContract (ContractName contractName) = blocTransaction $
  map (uncurry greedy) <$> blocQuery (getSearchContractQuery contractName)
  where greedy a = \case
          Nothing -> One a
          Just c -> Both a c
