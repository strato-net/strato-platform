{-# LANGUAGE
    OverloadedStrings
#-}

module BlockApps.Bloc.DummyContractStorage (
  getContract,
  getAddress
  ) where

import qualified Data.ByteString as B
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Map as Map

import BlockApps.Bloc.API.Utils
import BlockApps.Bloc.Monad
import BlockApps.Contract
import BlockApps.Ethereum
import BlockApps.Types

getContract::ContractName->MaybeNamed Address->Bloc Contract
getContract contractName address = do
  vars <- getVariablesAndTypes contractName address
  return Contract {
    storageVars=Map.fromList vars
    }


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
   "Types" ->
     return
     [
       ("theBool", TypeBool), --0

       ("theInt8", TypeInt (Just 8)), --1
       ("theInt16", TypeInt (Just 16)), --2
       ("theInt24", TypeInt (Just 24)), --4
       ("theInt32", TypeInt (Just 32)), --7
       ("theInt40", TypeInt (Just 40)), --11
       ("theInt48", TypeInt (Just 48)), --16
       ("theInt56", TypeInt (Just 56)), --22
       ("theInt64", TypeInt (Just 64)), --32
       ("theInt72", TypeInt (Just 72)), --40
       ("theInt80", TypeInt (Just 80)), --49
       ("theInt88", TypeInt (Just 88)), --64
       ("theInt96", TypeInt (Just 96)), --75
       ("theInt104", TypeInt (Just 104)), --96
       ("theInt112", TypeInt (Just 112)), --109
       ("theInt120", TypeInt (Just 120)), --128
       ("theInt128", TypeInt (Just 128)), --143
       ("theInt136", TypeInt (Just 136)), --160
       ("theInt144", TypeInt (Just 144)), --192
       ("theInt152", TypeInt (Just 152)), --224
       ("theInt160", TypeInt (Just 160)), --256
       ("theInt168", TypeInt (Just 168)), --288
       ("theInt176", TypeInt (Just 176)), --320
       ("theInt184", TypeInt (Just 184)), --352
       ("theInt192", TypeInt (Just 192)), --384
       ("theInt200", TypeInt (Just 200)), --416
       ("theInt208", TypeInt (Just 208)), --448
       ("theInt216", TypeInt (Just 216)), --480
       ("theInt224", TypeInt (Just 224)), --512
       ("theInt232", TypeInt (Just 232)), --544
       ("theInt240", TypeInt (Just 240)), --576
       ("theInt248", TypeInt (Just 248)), --608
       ("theInt256", TypeInt (Just 256)), --640

       ("theUInt8", TypeUInt (Just 8)), --672
       ("theUInt16", TypeUInt (Just 16)), --673
       ("theUInt24", TypeUInt (Just 24)), --675
       ("theUInt32", TypeUInt (Just 32)), --678
       ("theUInt40", TypeUInt (Just 40)), --682
       ("theUInt48", TypeUInt (Just 48)), --687
       ("theUInt56", TypeUInt (Just 56)), --693
       ("theUInt64", TypeUInt (Just 64)), --704
       ("theUInt72", TypeUInt (Just 72)), --712
       ("theUInt80", TypeUInt (Just 80)), --721
       ("theUInt88", TypeUInt (Just 88)), --736
       ("theUInt96", TypeUInt (Just 96)), --747
       ("theUInt104", TypeUInt (Just 104)), --768
       ("theUInt112", TypeUInt (Just 112)), --781
       ("theUInt120", TypeUInt (Just 120)), --800
       ("theUInt128", TypeUInt (Just 128)), --815
       ("theUInt136", TypeUInt (Just 136)), --832
       ("theUInt144", TypeUInt (Just 144)), --864
       ("theUInt152", TypeUInt (Just 152)), --896
       ("theUInt160", TypeUInt (Just 160)), --928
       ("theUInt168", TypeUInt (Just 168)), --960
       ("theUInt176", TypeUInt (Just 176)), --992
       ("theUInt184", TypeUInt (Just 184)), --1024
       ("theUInt192", TypeUInt (Just 192)), --1056
       ("theUInt200", TypeUInt (Just 200)), --1088
       ("theUInt208", TypeUInt (Just 208)), --1120
       ("theUInt216", TypeUInt (Just 216)), --1152
       ("theUInt224", TypeUInt (Just 224)), --1184
       ("theUInt232", TypeUInt (Just 232)), --1216
       ("theUInt240", TypeUInt (Just 240)), --1248
       ("theUInt248", TypeUInt (Just 248)), --1280
       ("theUInt256", TypeUInt (Just 256)), --1312

       ("theInt", TypeInt Nothing), --1344

       ("theUint", TypeInt Nothing), --1376

       ("theAddress", TypeAddress), --1408

       ("myAddress", TypeAddress), --1440

       ("theBytes1", TypeBytes (Just 1)), --1460
       ("theBytes2", TypeBytes (Just 2)), --1461
       ("theBytes3", TypeBytes (Just 3)), --1463
       ("theBytes4", TypeBytes (Just 4)), --1466
       ("theBytes5", TypeBytes (Just 5)), --1472
       ("theBytes6", TypeBytes (Just 6)), --1477
       ("theBytes7", TypeBytes (Just 7)), --1483
       ("theBytes8", TypeBytes (Just 8)), --1490
       ("theBytes9", TypeBytes (Just 9)), --1504
       ("theBytes10", TypeBytes (Just 10)), --1513
       ("theBytes11", TypeBytes (Just 11)), --1523
       ("theBytes12", TypeBytes (Just 12)), --1536
       ("theBytes13", TypeBytes (Just 13)), --1548
       ("theBytes14", TypeBytes (Just 14)), --1568
       ("theBytes15", TypeBytes (Just 15)), --1582
       ("theBytes16", TypeBytes (Just 16)), --1600
       ("theBytes17", TypeBytes (Just 17)), --1632
       ("theBytes18", TypeBytes (Just 18)), --1664
       ("theBytes19", TypeBytes (Just 19)), --1696
       ("theBytes20", TypeBytes (Just 20)), --1728
       ("theBytes21", TypeBytes (Just 21)), --1760
       ("theBytes22", TypeBytes (Just 22)), --1792
       ("theBytes23", TypeBytes (Just 23)), --1824
       ("theBytes24", TypeBytes (Just 24)), --1856
       ("theBytes25", TypeBytes (Just 25)), --1888
       ("theBytes26", TypeBytes (Just 26)), --1920
       ("theBytes27", TypeBytes (Just 27)), --1952
       ("theBytes28", TypeBytes (Just 28)), --1984
       ("theBytes29", TypeBytes (Just 29)), --2016
       ("theBytes30", TypeBytes (Just 30)), --2048

       ("theBytes32", TypeBytes (Just 32)), --2112

       ("theByte", TypeBytes (Just 1)), --2144

       ("theBytes", TypeBytes Nothing), --2176

       ("theString", TypeString) --2208

--  ("choice", "typedef":"ActionChoices",TypeEnum,"bytes":1,"names":["GoLeft","GoRight","GoStraight","SitStill"]} --2240

     ]

   "Enums" ->
     return
     [
       ("choice", TypeEnum "ActionChoices"),
       ("defaultChoice", TypeEnum "ActionChoices")
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













Types-

"xabi":{"types":{"ActionChoices":{"names":["GoLeft","GoRight","GoStraight","SitStill"],"type":"Enum","bytes":1}},


"vars":{
  "theUint120":{"atBytes":800,"type":"Int","bytes":15},
  "theUint56":{"atBytes":693,"type":"Int","bytes":7},
  "theBytes4":{"atBytes":1466,"type":"Bytes","bytes":4},
  "theInt248":{"atBytes":608,"signed":true,"type":"Int","bytes":31},
  "theInt152":{"atBytes":224,"signed":true,"type":"Int","bytes":19},
  "theBytes26":{"atBytes":1920,"type":"Bytes","bytes":26},
  "theUint88":{"atBytes":736,"type":"Int","bytes":11},
  "theUint176":{"atBytes":992,"type":"Int","bytes":22},
  "theBytes16":{"atBytes":1600,"type":"Bytes","bytes":16},
  "theUint":{"atBytes":1376,"type":"Int","bytes":32},
  "theInt104":{"atBytes":96,"signed":true,"type":"Int","bytes":13},
  "theUint8":{"atBytes":672,"type":"Int","bytes":1},
  "theInt8":{"atBytes":1,"signed":true,"type":"Int","bytes":1},
  "theUint104":{"atBytes":768,"type":"Int","bytes":13},
  "theBytes20":{"atBytes":1728,"type":"Bytes","bytes":20},
  "theUint72":{"atBytes":712,"type":"Int","bytes":9},
  "theInt80":{"atBytes":49,"signed":true,"type":"Int","bytes":10},
  "theBytes2":{"atBytes":1461,"type":"Bytes","bytes":2},
  "theInt176":{"atBytes":320,"signed":true,"type":"Int","bytes":22},
  "theUint192":{"atBytes":1056,"type":"Int","bytes":24},
  "theInt16":{"atBytes":2,"signed":true,"type":"Int","bytes":2},
  "theUint200":{"atBytes":1088,"type":"Int","bytes":25},
  "theBytes27":{"atBytes":1952,"type":"Bytes","bytes":27},
  "theBytes5":{"atBytes":1472,"type":"Bytes","bytes":5},
  "theInt168":{"atBytes":288,"signed":true,"type":"Int","bytes":21},
  "theBytes11":{"atBytes":1523,"type":"Bytes","bytes":11},
  "theInt64":{"atBytes":32,"signed":true,"type":"Int","bytes":8},
  "theBytes8":{"atBytes":1490,"type":"Bytes","bytes":8},
  "theUint168":{"atBytes":960,"type":"Int","bytes":21},
  "theUint96":{"atBytes":747,"type":"Int","bytes":12},
  "theInt192":{"atBytes":384,"signed":true,"type":"Int","bytes":24},
  "theInt200":{"atBytes":416,"signed":true,"type":"Int","bytes":25},
  "theUint48":{"atBytes":687,"type":"Int","bytes":6},
  "theInt256":{"atBytes":640,"signed":true,"type":"Int","bytes":32},
  "theBytes3":{"atBytes":1463,"type":"Bytes","bytes":3},
  "theInt32":{"atBytes":7,"signed":true,"type":"Int","bytes":4},
  "theUint224":{"atBytes":1184,"type":"Int","bytes":28},
  "theBytes21":{"atBytes":1760,"type":"Bytes","bytes":21},
  "theBytes24":{"atBytes":1856,"type":"Bytes","bytes":24},
  "theInt136":{"atBytes":160,"signed":true,"type":"Int","bytes":17},
  "theBytes6":{"atBytes":1477,"type":"Bytes","bytes":6},
  "theUint32":{"atBytes":678,"type":"Int","bytes":4},
  "theUint144":{"atBytes":864,"type":"Int","bytes":18},
  "theInt48":{"atBytes":16,"signed":true,"type":"Int","bytes":6},
  "theUint152":{"atBytes":896,"type":"Int","bytes":19},
  "theUint248":{"atBytes":1280,"type":"Int","bytes":31},
  "theBytes32":{"atBytes":2112,"type":"Bytes","bytes":32},
  "theBytes10":{"atBytes":1513,"type":"Bytes","bytes":10},
  "theBytes9":{"atBytes":1504,"type":"Bytes","bytes":9},
  "theUint24":{"atBytes":675,"type":"Int","bytes":3},
  "theInt120":{"atBytes":128,"signed":true,"type":"Int","bytes":15},
  "theInt240":{"atBytes":576,"signed":true,"type":"Int","bytes":30},
  "theString":{"atBytes":2208,"dynamic":true,"type":"String"},
  "theInt24":{"atBytes":4,"signed":true,"type":"Int","bytes":3},
  "theUint232":{"atBytes":1216,"type":"Int","bytes":29},
  "theUint128":{"atBytes":815,"type":"Int","bytes":16},
  "theBytes15":{"atBytes":1582,"type":"Bytes","bytes":15},
  "theBytes7":{"atBytes":1483,"type":"Bytes","bytes":7},
  "theInt184":{"atBytes":352,"signed":true,"type":"Int","bytes":23},
  "theBool":{"atBytes":0,"type":"Bool"},
  "theBytes25":{"atBytes":1888,"type":"Bytes","bytes":25},
  "theInt72":{"atBytes":40,"signed":true,"type":"Int","bytes":9},
  "theUint80":{"atBytes":721,"type":"Int","bytes":10},
  "theAddress":{"atBytes":1408,"type":"Address"},
  "theInt216":{"atBytes":480,"signed":true,"type":"Int","bytes":27},
  "theInt88":{"atBytes":64,"signed":true,"type":"Int","bytes":11},
  "theBytes13":{"atBytes":1548,"type":"Bytes","bytes":13},
  "theUint184":{"atBytes":1024,"type":"Int","bytes":23},
  "theInt":{"atBytes":1344,"signed":true,"type":"Int","bytes":32},
  "myAddress":{"atBytes":1440,"type":"Address"},
  "theBytes31":{"atBytes":2080,"type":"Bytes","bytes":31},
  "theBytes28":{"atBytes":1984,"type":"Bytes","bytes":28},
  "theUint216":{"atBytes":1152,"type":"Int","bytes":27},
  "theUint112":{"atBytes":781,"type":"Int","bytes":14},
  "theInt96":{"atBytes":75,"signed":true,"type":"Int","bytes":12},
  "theBytes14":{"atBytes":1568,"type":"Bytes","bytes":14},
  "theInt160":{"atBytes":256,"signed":true,"type":"Int","bytes":20},
  "theUint64":{"atBytes":704,"type":"Int","bytes":8},
  "theUint208":{"atBytes":1120,"type":"Int","bytes":26},
  "theBytes":{"atBytes":2176,"dynamic":true,"type":"Bytes"},
  "theBytes22":{"atBytes":1792,"type":"Bytes","bytes":22},
  "theInt208":{"atBytes":448,"signed":true,"type":"Int","bytes":26},
  "theUint16":{"atBytes":673,"type":"Int","bytes":2},
  "theInt112":{"atBytes":109,"signed":true,"type":"Int","bytes":14},
  "theBytes19":{"atBytes":1696,"type":"Bytes","bytes":19},
  "theUint160":{"atBytes":928,"type":"Int","bytes":20},
  "theByte":{"atBytes":2144,"type":"Bytes","bytes":1},
  "theBytes30":{"atBytes":2048,"type":"Bytes","bytes":30},
  "theUint136":{"atBytes":832,"type":"Int","bytes":17},
  "choice":{"atBytes":2240,"typedef":"ActionChoices","type":"Enum","bytes":1,"names":["GoLeft","GoRight","GoStraight","SitStill"]},
  "theBytes29":{"atBytes":2016,"type":"Bytes","bytes":29},
  "theUint40":{"atBytes":682,"type":"Int","bytes":5},
  "theBytes12":{"atBytes":1536,"type":"Bytes","bytes":12},
  "theInt144":{"atBytes":192,"signed":true,"type":"Int","bytes":18},
  "theUint256":{"atBytes":1312,"type":"Int","bytes":32},
  "theInt40":{"atBytes":11,"signed":true,"type":"Int","bytes":5},
  "theInt224":{"atBytes":512,"signed":true,"type":"Int","bytes":28},
  "theBytes17":{"atBytes":1632,"type":"Bytes","bytes":17},
  "theBytes18":{"atBytes":1664,"type":"Bytes","bytes":18},
  "theBytes1":{"atBytes":1460,"type":"Bytes","bytes":1},
  "theInt128":{"atBytes":143,"signed":true,"type":"Int","bytes":16},
  "theUint240":{"atBytes":1248,"type":"Int","bytes":30},
  "theInt232":{"atBytes":544,"signed":true,"type":"Int","bytes":29},
  "theBytes23":{"atBytes":1824,"type":"Bytes","bytes":23},
  "theInt56":{"atBytes":22,"signed":true,"type":"Int","bytes":7}}
}




Enums-
"types":{
  "ActionChoices":{"names":{"GoLeft":0,"GoRight":1,"GoStraight":2,"SitStill":3},"type":"Enum","bytes":1}
}

"vars":{
  "defaultChoice":{"atBytes":1,"typedef":"ActionChoices","type":"Enum","bytes":1,"names":{"GoLeft":0,"GoRight":1,"GoStraight":2,"SitStill":3}},
  "choice":{"atBytes":0,"typedef":"ActionChoices","type":"Enum","bytes":1,"names":{"GoLeft":0,"GoRight":1,"GoStraight":2,"SitStill":3}}
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
--getAddress (ContractName "Greeter") _ = Address 0x5aff991928b540be39eae2d94a99c8f9305e2599
getAddress (ContractName "Greeter") _ = Address 0x8907e6c85af389574dc13c3496ff77dbdb937d2a
--getAddress (ContractName "mortal") _ = Address 0x
getAddress (ContractName "InfoFeed") _ = Address 0xf503bdf764474ab89130511860229dc0ed9c2bd6
getAddress (ContractName "SimpleDataFeed") _ = Address 0x3fbbcae9815773e8820bb53a855c2ae8cb75e9c0
getAddress (ContractName "SimpleStorage") _ = Address 0x12ed0ad1f6838d49502fc34458f1bee7222d4ba3
getAddress (ContractName "Types") _ = Address 0x3275bd5d58093c5a1a849c797f103a2e2430c0d5
--getAddress (ContractName "Enums") _ = Address 0xbd4d76e9c5923661a92db8064c816b758c85649e
getAddress (ContractName "Enums") _ = Address 0xe5abb969f22ecfad07a4c25264b7de22a641a1ef
getAddress (ContractName x) _ = error $ "You fool, there is no '" ++ T.unpack x ++ "' contract"
