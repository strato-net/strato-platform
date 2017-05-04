{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Bloc20.Server.Search where

import           Control.Monad.Except
import           Data.Text                       (Text)

import           BlockApps.Bloc20.API.Search
import           BlockApps.Bloc20.API.Utils
import           BlockApps.Bloc20.Database.Queries
import           BlockApps.Bloc20.Monad
import           BlockApps.Ethereum
import           BlockApps.Solidity.Xabi

getSearchContract :: ContractName -> Bloc [MaybeNamed Address]
getSearchContract (ContractName contractName) = blocTransaction $
  map Unnamed <$> blocQuery (getSearchContractQuery contractName)

getSearchContractState :: ContractName -> Bloc [SearchContractState]
getSearchContractState _ = throwError $ Unimplemented "getSearchContractState"

getSearchContractStateReduced :: ContractName -> [Text] -> Bloc [SearchContractState]
getSearchContractStateReduced _ _ = throwError $ Unimplemented "getSearchContractStateReduced"
