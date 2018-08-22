{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Bloc22.Server.Search where

import           BlockApps.Bloc22.API.Search
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum
import           BlockApps.Solidity.Xabi

getSearchContract :: ContractName -> Bloc [Greedy (MaybeNamed Address) ChainId]
getSearchContract (ContractName contractName) = blocTransaction $
  map (\(a,c) -> greedy (Unnamed a) c) <$> blocQuery (getSearchContractQuery contractName)
  where greedy a = \case
          Nothing -> One a
          Just c -> Both a c
