{-# LANGUAGE
    OverloadedStrings
#-}

module DummyContractStorage where

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Queries
import BlockApps.Ethereum
import BlockApps.Solidity
import BlockApps.SolidityVarReader
import BlockApps.Strato.Client
import BlockApps.Strato.Types

getVariablesAndTypes::ContractName->MaybeNamed Address->Bloc [(String, Type)]
getVariablesAndTypes (ContractName contractName) _ =
  case contractName of
   "Payout" -> return []



     
