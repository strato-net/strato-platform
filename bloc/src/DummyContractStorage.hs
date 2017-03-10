{-# LANGUAGE
    OverloadedStrings
#-}

module DummyContractStorage where

import qualified Data.ByteString as B
import Data.Text (Text)
import qualified Data.Text as T

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Ethereum
import BlockApps.SolidityVarReader

getVariablesAndTypes::ContractName->MaybeNamed Address->Bloc [(Text, Type)]
getVariablesAndTypes (ContractName contractName) _ =
  case contractName of
   "x" -> return [("fred", TypeInt Nothing)]
   "Payout" ->
     return
     [
       ("Victor", TypeAddress),
       ("Jim", TypeAddress),
       ("Kieren", TypeAddress),
       ("ownershipDistribution", TypeMapping TypeAddress (TypeUInt Nothing)),
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
   "SimpleMultiSig" ->
     return
     [
       ("alice1", TypeAddress),
       ("alice2", TypeAddress),
       ("bob", TypeAddress),
       ("numSigned", TypeUInt Nothing),
       ("error", TypeBytes (Just 32)),
       ("registeredYet", TypeBool),
       ("signedYet", TypeMapping TypeAddress TypeBool),
       ("register", TypeFunction "aa677354" [("registerAlice1", TypeAddress), ("registerAlice2", TypeAddress)] []),
       ("withdraw", TypeFunction "51cff8d9" [("to", TypeAddress)] []),
       ("addSignature", TypeFunction "5614d3e0" [] [])
     ]
   "Greeter" ->
     return
     [
       ("owner", TypeAddress),
       ("greeting", TypeString),
       ("kill", TypeFunction "41c0e1b5" [] []),
       ("greet", TypeFunction "cfae3217" [] [(Nothing, TypeString)])
       --Do we include constuctors?
       -- ("constr", TypeFunction "" [("_greeting", TypeString)] [])
     ]
   "mortal" ->
     return
     [
       ("owner", TypeAddress),
       ("kill", TypeFunction "41c0e1b5" [] [])
     ]
   "SimpleDataFeed" ->
     return
     [
       ("lastPrice", TypeUInt Nothing),
       ("update", TypeFunction "82ab890a" [("newPrice", TypeUInt Nothing)] [])
     ]
   "SimpleStorage" ->
     return
     [
       ("storedData", TypeUInt Nothing),
       ("set", TypeFunction "60fe47b1" [("x", TypeUInt Nothing)] []),
       ("get", TypeFunction "6d4ce63c" [] [(Just "retVal", TypeUInt Nothing)])
     ]
   "Consumer" ->
     return
     [
       ("feed", TypeContract),
       ("global", TypeUInt Nothing),
       ("setFeed", TypeFunction "55b775ea" [("addr", TypeAddress)] []),
       ("callFeed", TypeFunction "f198f5df" [] [])
     ]

   "InfoFeed" ->
     return
     [
       ("info", TypeFunction "370158ea" [] [(Just "ret", TypeUInt Nothing)])
     ]
   x -> error $ "You fool, there is no '" ++ T.unpack x ++ "' contract"

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

SimpleMultiSig-
"vars":{
  "bob":{"atBytes":64,"type":"Address"},
  "signedYet":{"atBytes":192,"dynamic":true,"value":{"type":"Bool"},"key":{"type":"Address"},"type":"Mapping"},
  "error":{"atBytes":128,"type":"Bytes","bytes":32},
  "alice1":{"atBytes":0,"type":"Address"},
  "numSigned":{"atBytes":96,"type":"Int","bytes":32},
  "alice2":{"atBytes":32,"type":"Address"},
  "registeredYet":{"atBytes":160,"type":"Bool"}
}
"funcs":{
  "register":{"args":{
        "registerAlice1":{"type":"Address","index":0,"name":"registerAlice1"},
        "registerAlice2":{"type":"Address","index":1,"name":"registerAlice2"}},
        "selector":"aa677354","vals":{}},
  "withdraw":{"args":{
                "to":{"type":"Address","index":0,"name":"to"}
              },"selector":"51cff8d9","vals":{}},
  "addSignature":{"args":{},"selector":"5614d3e0","vals":{}}
}











Greeter-
"funcs":{
  "kill":{"args":{},"selector":"41c0e1b5","vals":{}},
  "greet":{"args":{},"selector":"cfae3217","vals":{"#0":{"dynamic":true,"type":"String","index":0}}}},
  "constr":{"_greeting":{"dynamic":true,"type":"String","index":0}}
"vars":{
  "owner":{"atBytes":0,"type":"Address"},
  "greeting":{"atBytes":32,"dynamic":true,"type":"String"}
}


mortal-
"funcs":{
  "kill":{"args":{},"selector":"41c0e1b5","vals":{}}
}
"vars":{
  "owner":{"atBytes":0,"type":"Address"}
}


SimpleDataFeed-
"funcs":{
  "update":{
    "args":{
      "newPrice":{"type":"Int","index":0,"bytes":32}
    },"selector":"82ab890a","vals":{}}},
"vars":{
  "lastPrice":{"atBytes":0,"type":"Int","bytes":32}
}

SimpleStorage-
"funcs":{
  "set":{"args":{"x":{"type":"Int","index":0,"bytes":32}},"selector":"60fe47b1","vals":{}},
  "get":{"args":{},"selector":"6d4ce63c","vals":{"retVal":{"type":"Int","index":0,"bytes":32}}}
}
"vars":{
  "storedData":{"atBytes":0,"type":"Int","bytes":32}
}

Consumer-
"funcs":{
  "setFeed":{"args":{"addr":{"type":"Address","index":0}},"selector":"55b775ea","vals":{}},
  "callFeed":{"args":{},"selector":"f198f5df","vals":{}}},
"vars":{
  "feed":{"atBytes":0,"typedef":"InfoFeed","type":"Contract","bytes":20},
  "global":{"atBytes":32,"type":"Int","bytes":32}
}

InfoFeed-
"funcs":{
  "info":{"args":{},"selector":"370158ea","vals":{"ret":{"type":"Int","index":0,"bytes":32}}}
}






-}

     
-- TypeBool | TypeUInt (Maybe Int) | TypeInt (Maybe Int)
--  | TypeAddress | TypeFixed (Maybe (Int,Int)) | TypeUFixed (Maybe (Int,Int))
--  | TypeBytes (Maybe Int) | TypeString | TypeFunction [Type]
--  | TypeArray Type (Maybe Int) | TypeMapping Type Type


getAddress::ContractName->MaybeNamed Address->Address
getAddress (ContractName "Payout") _ = Address 0x953ac16faebbe2ce2136814cee884d82f0ecb1aa
getAddress (ContractName "Stake") _ = Address 0xbcca0649c1c41486e95ca1a8287e2a5f7000a8aa
getAddress (ContractName "SimpleMultiSig") _ = Address 0x944368b7c7dbf16e97236e2ecf80df7f7c30ae88
getAddress (ContractName "Consumer") _ = Address 0x687f7a384cf998eca6afadb67d76f3ffa9e0741d
--getAddress (ContractName "Greeter") _ = Address 0x659bb9a5757636aa4c2449d625f97df26b83e9b2
getAddress (ContractName "Greeter") _ = Address 0x5aff991928b540be39eae2d94a99c8f9305e2599
--getAddress (ContractName "mortal") _ = Address 0x
getAddress (ContractName "InfoFeed") _ = Address 0xf503bdf764474ab89130511860229dc0ed9c2bd6
getAddress (ContractName "SimpleDataFeed") _ = Address 0x3fbbcae9815773e8820bb53a855c2ae8cb75e9c0
getAddress (ContractName "SimpleStorage") _ = Address 0x12ed0ad1f6838d49502fc34458f1bee7222d4ba3
getAddress (ContractName x) _ = error $ "You fool, there is no '" ++ T.unpack x ++ "' contract"
