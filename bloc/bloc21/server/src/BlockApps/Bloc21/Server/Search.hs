{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Bloc21.Server.Search where

import           Control.Monad.Except
import           Data.Text                       (Text)

import           BlockApps.Bloc21.API.Search
import           BlockApps.Bloc21.API.Utils
import           BlockApps.Bloc21.Database.Queries
import           BlockApps.Bloc21.Monad
import           BlockApps.Ethereum
import           BlockApps.Solidity.Xabi

getSearchContract :: ContractName -> Bloc [MaybeNamed Address]
getSearchContract (ContractName contractName) = blocTransaction $
  map Unnamed <$> blocQuery (getSearchContractQuery contractName)

getSearchContractState :: ContractName -> Bloc [SearchContractState]
getSearchContractState _ = throwError $ Unimplemented "getSearchContractState"

getSearchContractStateReduced :: ContractName -> [Text] -> Bloc [SearchContractState]
getSearchContractStateReduced _ _ = throwError $ Unimplemented "getSearchContractStateReduced"
