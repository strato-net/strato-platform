{-# LANGUAGE
    OverloadedStrings
#-}

module DummyContractStorage where

import Data.Text (Text)

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Bloc.Queries
import BlockApps.Ethereum
import BlockApps.Solidity
import BlockApps.SolidityVarReader
import BlockApps.Strato.Client
import BlockApps.Strato.Types

getVariablesAndTypes::ContractName->MaybeNamed Address->Bloc [(Text, Type)]
getVariablesAndTypes (ContractName contractName) _ =
  case contractName of
   "Payout" -> return [("fred", TypeInt Nothing)]



     
-- TypeBool | TypeUInt (Maybe Int) | TypeInt (Maybe Int)
--  | TypeAddress | TypeFixed (Maybe (Int,Int)) | TypeUFixed (Maybe (Int,Int))
--  | TypeBytes (Maybe Int) | TypeString | TypeFunction [Type]
--  | TypeArray Type (Maybe Int) | TypeMapping Type Type
