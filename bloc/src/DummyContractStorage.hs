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
       --("ownershipDistribution", TypeMapping TypeAddress (TypeInt (Just 32))) --atBytes: 96
       ("Setup", TypeFunction B.empty [] []),
       ("Dividend", TypeFunction B.empty [] [])
     ]

{-
"xabi":
       {
         "vars":
                {
                  "Victor":
                           {
                             "atBytes":0,
                             "type":"Address"
                           },
                  "Jim":
                        {
                          "atBytes":32,
                          "type":"Address"
                        },
                  "Kieren":
                           {
                             "atBytes":64,
                             "type":"Address"
                           },
                  "ownershipDistribution":
                                          {
                                            "atBytes":96,
                                            "dynamic":true,
                                            "value":
                                                    {
                                                      "type":"Int",
                                                      "bytes":32
                                                    },
                                            "key":
                                                  {
                                                    "type":"Address"
                                                  },
                                            "type":"Mapping"
                                          }
                }
       }
-}

     
-- TypeBool | TypeUInt (Maybe Int) | TypeInt (Maybe Int)
--  | TypeAddress | TypeFixed (Maybe (Int,Int)) | TypeUFixed (Maybe (Int,Int))
--  | TypeBytes (Maybe Int) | TypeString | TypeFunction [Type]
--  | TypeArray Type (Maybe Int) | TypeMapping Type Type
