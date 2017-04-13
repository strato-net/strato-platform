module BlockApps.Bloc.Server.Search where

import Data.Text (Text)

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.API.Search
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Database.Queries
import BlockApps.Ethereum
import BlockApps.Solidity.Xabi

class Monad m => MonadSearchContract m where
  getSearchContract :: ContractName -> m [MaybeNamed Address]
  getSearchContractState :: ContractName -> m [SearchContractState]
  getSearchContractStateReduced :: ContractName -> [Text] -> m [SearchContractState]

instance MonadSearchContract Bloc where

  getSearchContract (ContractName contractName) = blocTransaction $
    map Unnamed <$> blocQuery (getSearchContractQuery contractName)

  getSearchContractState = undefined
  getSearchContractStateReduced = undefined
