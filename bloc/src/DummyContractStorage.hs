{-# LANGUAGE
    OverloadedStrings
#-}

module DummyContractStorage where

import qualified Data.ByteString as B
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
   "x" -> return [("fred", TypeInt Nothing)]
   "Payout" ->
     return
     [
       ("Victor", TypeAddress), --atBytes: 0
       ("Jim", TypeAddress), --atBytes: 32
       ("Kieren", TypeAddress), --atBytes: 64
       ("ownershipDistribution", TypeMapping TypeAddress (TypeUInt Nothing)), --atBytes: 96
       ("Setup", TypeFunction B.empty [] []),
       ("Dividend", TypeFunction B.empty [] [])
     ]
   "Stake" ->
     return
     [
       ("stake", TypeMapping TypeAddress (TypeUInt Nothing)),
       ("stakeHolders", TypeArray TypeAddress Nothing),
       ("holdingTheBag", TypeAddress),
       ("numStakeHolders", TypeUInt Nothing),
       ("currentStake", TypeUInt Nothing),
       ("sumStake", TypeUInt Nothing),
       ("payout", TypeFunction "63bd1d4a" [] []),
       ("addStakeHolder", TypeFunction "11a76f37" [("stakeholder", TypeAddress)] [])
     ]
  
{-

Payout-
"vars": {
  "Victor": {"atBytes":0, "type":"Address"},
  "Jim": {"atBytes":32, "type":"Address"},
  "Kieren": {"atBytes":64, "type":"Address"},
  "ownershipDistribution": {
    "atBytes":96,
    "dynamic":true,
    "value":{"type":"Int","bytes":32},
    "key":{"type":"Address"},
    "type":"Mapping"
  }
}


Stake-
"vars": {
  "holdingTheBag":{"atBytes":64,"type":"Address"},
  "numStakeHolders":{"atBytes":96,"type":"Int","bytes":32},
  "stake":{"atBytes":0,"dynamic":true,"value":{"type":"Int","bytes":32},"key":{"type":"Address"},"
type":"Mapping"},
  "sumStake":{"atBytes":160,"type":"Int","bytes":32},
  "stakeHolders":{"atBytes":32,"dynamic":true,"entry":{"type":"Address"},"type":"Array"},
  "currentStake":{"atBytes":128,"type":"Int","bytes":32}
}











-}

     
-- TypeBool | TypeUInt (Maybe Int) | TypeInt (Maybe Int)
--  | TypeAddress | TypeFixed (Maybe (Int,Int)) | TypeUFixed (Maybe (Int,Int))
--  | TypeBytes (Maybe Int) | TypeString | TypeFunction [Type]
--  | TypeArray Type (Maybe Int) | TypeMapping Type Type


getAddress::ContractName->MaybeNamed Address->Address
getAddress (ContractName "Payout") _ = Address 0x953ac16faebbe2ce2136814cee884d82f0ecb1aa
getAddress (ContractName "Stake") _ = Address 0xbcca0649c1c41486e95ca1a8287e2a5f7000a8aa
        
