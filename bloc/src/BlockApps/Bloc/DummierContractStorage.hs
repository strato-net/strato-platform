{-#
  LANGUAGE
    QuasiQuotes
#-}

module BlockApps.Bloc.DummierContractStorage where

import Text.RawString.QQ

getContractXabiString::String->String
getContractXabiString name =
  case name of
   "Array" -> [r|

{"vars":{
  "int32Array":{"atBytes":288,"dynamic":true,"entry":{"signed":true,"type":"Int","bytes":4},"type":"Array"},

  "fixedUInt8Array":{"atBytes":256,"length":8,"entry":{"type":"Int","bytes":1},"type":"Array"},

  "uintArray":{"atBytes":320,"dynamic":true,"entry":{"type":"Int","bytes":32},"type":"Array"},"notice":{"atBytes":352,"dynamic":true,"type":"String"},

  "fixedUIntArray":{"atBytes":0,"length":8,"entry":{"type":"Int","bytes":32},"type":"Array"}
  }
}

|]

   "Types" -> [r|

{"types":{"ActionChoices":{"names":["GoLeft","GoRight","GoStraight","SitStill"],"type":"Enum","bytes":1}},"vars":{"theUint120":{"atBytes":800,"type":"Int","bytes":15},"theUint56":{"atBytes":693,"type":"Int","bytes":7},"theBytes4":{"atBytes":1466,"type":"Bytes","bytes":4},"theInt248":{"atBytes":608,"signed":true,"type":"Int","bytes":31},"theInt152":{"atBytes":224,"signed":true,"type":"Int","bytes":19},"theBytes26":{"atBytes":1920,"type":"Bytes","bytes":26},"theUint88":{"atBytes":736,"type":"Int","bytes":11},"theUint176":{"atBytes":992,"type":"Int","bytes":22},"theBytes16":{"atBytes":1600,"type":"Bytes","bytes":16},"theUint":{"atBytes":1376,"type":"Int","bytes":32},"theInt104":{"atBytes":96,"signed":true,"type":"Int","bytes":13},"theUint8":{"atBytes":672,"type":"Int","bytes":1},"theInt8":{"atBytes":1,"signed":true,"type":"Int","bytes":1},"theUint104":{"atBytes":768,"type":"Int","bytes":13},"theBytes20":{"atBytes":1728,"type":"Bytes","bytes":20},"theUint72":{"atBytes":712,"type":"Int","bytes":9},"theInt80":{"atBytes":49,"signed":true,"type":"Int","bytes":10},"theBytes2":{"atBytes":1461,"type":"Bytes","bytes":2},"theInt176":{"atBytes":320,"signed":true,"type":"Int","bytes":22},"theUint192":{"atBytes":1056,"type":"Int","bytes":24},"theInt16":{"atBytes":2,"signed":true,"type":"Int","bytes":2},"theUint200":{"atBytes":1088,"type":"Int","bytes":25},"theBytes27":{"atBytes":1952,"type":"Bytes","bytes":27},"theBytes5":{"atBytes":1472,"type":"Bytes","bytes":5},"theInt168":{"atBytes":288,"signed":true,"type":"Int","bytes":21},"theBytes11":{"atBytes":1523,"type":"Bytes","bytes":11},"theInt64":{"atBytes":32,"signed":true,"type":"Int","bytes":8},"theBytes8":{"atBytes":1490,"type":"Bytes","bytes":8},"theUint168":{"atBytes":960,"type":"Int","bytes":21},"theUint96":{"atBytes":747,"type":"Int","bytes":12},"theInt192":{"atBytes":384,"signed":true,"type":"Int","bytes":24},"theInt200":{"atBytes":416,"signed":true,"type":"Int","bytes":25},"theUint48":{"atBytes":687,"type":"Int","bytes":6},"theInt256":{"atBytes":640,"signed":true,"type":"Int","bytes":32},"theBytes3":{"atBytes":1463,"type":"Bytes","bytes":3},"theInt32":{"atBytes":7,"signed":true,"type":"Int","bytes":4},"theUint224":{"atBytes":1184,"type":"Int","bytes":28},"theBytes21":{"atBytes":1760,"type":"Bytes","bytes":21},"theBytes24":{"atBytes":1856,"type":"Bytes","bytes":24},"theInt136":{"atBytes":160,"signed":true,"type":"Int","bytes":17},"theBytes6":{"atBytes":1477,"type":"Bytes","bytes":6},"theUint32":{"atBytes":678,"type":"Int","bytes":4},"theUint144":{"atBytes":864,"type":"Int","bytes":18},"theInt48":{"atBytes":16,"signed":true,"type":"Int","bytes":6},"theUint152":{"atBytes":896,"type":"Int","bytes":19},"theUint248":{"atBytes":1280,"type":"Int","bytes":31},"theBytes32":{"atBytes":2112,"type":"Bytes","bytes":32},"theBytes10":{"atBytes":1513,"type":"Bytes","bytes":10},"theBytes9":{"atBytes":1504,"type":"Bytes","bytes":9},"theUint24":{"atBytes":675,"type":"Int","bytes":3},"theInt120":{"atBytes":128,"signed":true,"type":"Int","bytes":15},"theInt240":{"atBytes":576,"signed":true,"type":"Int","bytes":30},"theString":{"atBytes":2208,"dynamic":true,"type":"String"},"theInt24":{"atBytes":4,"signed":true,"type":"Int","bytes":3},"theUint232":{"atBytes":1216,"type":"Int","bytes":29},"theUint128":{"atBytes":815,"type":"Int","bytes":16},"theBytes15":{"atBytes":1582,"type":"Bytes","bytes":15},"theBytes7":{"atBytes":1483,"type":"Bytes","bytes":7},"theInt184":{"atBytes":352,"signed":true,"type":"Int","bytes":23},"theBool":{"atBytes":0,"type":"Bool"},"theBytes25":{"atBytes":1888,"type":"Bytes","bytes":25},"theInt72":{"atBytes":40,"signed":true,"type":"Int","bytes":9},"theUint80":{"atBytes":721,"type":"Int","bytes":10},"theAddress":{"atBytes":1408,"type":"Address"},"theInt216":{"atBytes":480,"signed":true,"type":"Int","bytes":27},"theInt88":{"atBytes":64,"signed":true,"type":"Int","bytes":11},"theBytes13":{"atBytes":1548,"type":"Bytes","bytes":13},"theUint184":{"atBytes":1024,"type":"Int","bytes":23},"theInt":{"atBytes":1344,"signed":true,"type":"Int","bytes":32},"myAddress":{"atBytes":1440,"type":"Address"},"theBytes31":{"atBytes":2080,"type":"Bytes","bytes":31},"theBytes28":{"atBytes":1984,"type":"Bytes","bytes":28},"theUint216":{"atBytes":1152,"type":"Int","bytes":27},"theUint112":{"atBytes":781,"type":"Int","bytes":14},"theInt96":{"atBytes":75,"signed":true,"type":"Int","bytes":12},"theBytes14":{"atBytes":1568,"type":"Bytes","bytes":14},"theInt160":{"atBytes":256,"signed":true,"type":"Int","bytes":20},"theUint64":{"atBytes":704,"type":"Int","bytes":8},"theUint208":{"atBytes":1120,"type":"Int","bytes":26},"theBytes":{"atBytes":2176,"dynamic":true,"type":"Bytes"},"theBytes22":{"atBytes":1792,"type":"Bytes","bytes":22},"theInt208":{"atBytes":448,"signed":true,"type":"Int","bytes":26},"theUint16":{"atBytes":673,"type":"Int","bytes":2},"theInt112":{"atBytes":109,"signed":true,"type":"Int","bytes":14},"theBytes19":{"atBytes":1696,"type":"Bytes","bytes":19},"theUint160":{"atBytes":928,"type":"Int","bytes":20},"theByte":{"atBytes":2144,"type":"Bytes","bytes":1},"theBytes30":{"atBytes":2048,"type":"Bytes","bytes":30},"theUint136":{"atBytes":832,"type":"Int","bytes":17},"choice":{"atBytes":2240,"typedef":"ActionChoices","type":"Enum","bytes":1,"names":["GoLeft","GoRight","GoStraight","SitStill"]},"theBytes29":{"atBytes":2016,"type":"Bytes","bytes":29},"theUint40":{"atBytes":682,"type":"Int","bytes":5},"theBytes12":{"atBytes":1536,"type":"Bytes","bytes":12},"theInt144":{"atBytes":192,"signed":true,"type":"Int","bytes":18},"theUint256":{"atBytes":1312,"type":"Int","bytes":32},"theInt40":{"atBytes":11,"signed":true,"type":"Int","bytes":5},"theInt224":{"atBytes":512,"signed":true,"type":"Int","bytes":28},"theBytes17":{"atBytes":1632,"type":"Bytes","bytes":17},"theBytes18":{"atBytes":1664,"type":"Bytes","bytes":18},"theBytes1":{"atBytes":1460,"type":"Bytes","bytes":1},"theInt128":{"atBytes":143,"signed":true,"type":"Int","bytes":16},"theUint240":{"atBytes":1248,"type":"Int","bytes":30},"theInt232":{"atBytes":544,"signed":true,"type":"Int","bytes":29},"theBytes23":{"atBytes":1824,"type":"Bytes","bytes":23},"theInt56":{"atBytes":22,"signed":true,"type":"Int","bytes":7}}}

|]

   "Consumer" -> [r|
{"funcs":{"setFeed":{"args":{"addr":{"type":"Address","index":0}},"selector":"55b775ea","vals":{}},"callFeed":{"args":{},"selector":"f198f5df","vals":{}}},"vars":{"feed":{"atBytes":0,"typedef":"InfoFeed","type":"Contract","bytes":20},"global":{"atBytes":32,"type":"Int","bytes":32}}}
|]

   "FixedArray" -> [r|
{"vars":{"x8":{"atBytes":256,"length":8,"entry":{"type":"Int","bytes":1},"type":"Array"},"notice":{"atBytes":288,"dynamic":true,"type":"String"},"x":{"atBytes":0,"length":8,"entry":{"type":"Int","bytes":32},"type":"Array"}}}
|]

   "mortal" -> [r|

{"funcs":{"kill":{"args":{},"selector":"41c0e1b5","vals":{}}},"vars":{"owner":{"atBytes":0,"type":"Address"}}}

|]

   "SimpleMultiSig" -> [r|

{"funcs":{"register":{"args":{"registerAlice1":{"type":"Address","index":0},"registerAlice2":{"type":"Address","index":1}},"selector":"aa677354","vals":{}},"withdraw":{"args":{"to":{"type":"Address","index":0}},"selector":"51cff8d9","vals":{}},"addSignature":{"args":{},"selector":"5614d3e0","vals":{}}},"vars":{"bob":{"atBytes":64,"type":"Address"},"signedYet":{"atBytes":192,"dynamic":true,"value":{"type":"Bool"},"key":{"type":"Address"},"type":"Mapping"},"error":{"atBytes":128,"type":"Bytes","bytes":32},"alice1":{"atBytes":0,"type":"Address"},"numSigned":{"atBytes":96,"type":"Int","bytes":32},"alice2":{"atBytes":32,"type":"Address"},"registeredYet":{"atBytes":160,"type":"Bool"}}}

|]

   "Struct" -> [r|

{"types":{"Animals":{"names":{"Dog":0,"Cat":1,"Pig":2},"type":"Enum","bytes":1},"Pet":{"type":"Struct","bytes":96,"fields":{"fleasAndTicks":{"atBytes":65,"type":"Bool"},"age":{"atBytes":64,"signed":true,"type":"Int","bytes":1},"animal":{"atBytes":0,"typedef":"Animals"},"name":{"atBytes":32,"dynamic":true,"type":"String"}}}},"vars":{"sammy":{"atBytes":0,"typedef":"Pet","type":"Struct","bytes":96}}}

|]

   "Enums" -> [r|

{"types":{"ActionChoices":{"names":{"GoLeft":0,"GoRight":1,"GoStraight":2,"SitStill":3},"type":"Enum","bytes":1}},"vars":{"defaultChoice":{"atBytes":1,"typedef":"ActionChoices","type":"Enum","bytes":1,"names":{"GoLeft":0,"GoRight":1,"GoStraight":2,"SitStill":3}},"choice":{"atBytes":0,"typedef":"ActionChoices","type":"Enum","bytes":1,"names":{"GoLeft":0,"GoRight":1,"GoStraight":2,"SitStill":3}}}}

|]

   "Greeter" -> [r|

{"funcs":{"kill":{"args":{},"selector":"41c0e1b5","vals":{}},"greet":{"args":{},"selector":"cfae3217","vals":{"#0":{"dynamic":true,"type":"String","index":0}}}},"constr":{"_greeting":{"dynamic":true,"type":"String","index":0}},"vars":{"owner":{"atBytes":0,"type":"Address"},"greeting":{"atBytes":32,"dynamic":true,"type":"String"}}}

|]

   "Payout" -> [r|

{"funcs":{"Setup":{"args":{},"selector":"58793050","vals":{}},"Dividend":{"args":{},"selector":"8df554b3","vals":{}}},"vars":{"Victor":{"atBytes":0,"type":"Address"},"Jim":{"atBytes":32,"type":"Address"},"Kieren":{"atBytes":64,"type":"Address"},"ownershipDistribution":{"atBytes":96,"dynamic":true,"value":{"type":"Int","bytes":32},"key":{"type":"Address"},"type":"Mapping"}}}

|]

   "SimpleStorage" -> [r|

{"funcs":{"set":{"args":{"x":{"type":"Int","index":0,"bytes":32}},"selector":"60fe47b1","vals":{}},"get":{"args":{},"selector":"6d4ce63c","vals":{"retVal":{"type":"Int","index":0,"bytes":32}}}},"vars":{"storedData":{"atBytes":0,"type":"Int","bytes":32}}}

|]

   "Struct2" -> [r|

{"types":{"Pet":{"type":"Struct","bytes":96,"fields":{"fleasAndTicks":{"atBytes":65,"type":"Bool"},"age":{"atBytes":64,"signed":true,"type":"Int","bytes":1},"animal":{"atBytes":0,"dynamic":true,"type":"String"},"name":{"atBytes":32,"dynamic":true,"type":"String"}}}},"vars":{"proclamation":{"atBytes":128,"dynamic":true,"type":"String"},"sammy":{"atBytes":32,"typedef":"Pet","type":"Struct","bytes":96},"x":{"atBytes":0,"signed":true,"type":"Int","bytes":32},"I":{"atBytes":160,"typedef":"Pet","type":"Struct","bytes":96}}}

|]

   "ErrorCodes" -> [r|

{"types":{"ErrorCodesEnum":{"names":{"NULL":0,"SUCCESS":1,"ERROR":2,"NOT_FOUND":3,"EXISTS":4,"RECURSIVE":5,"USERNAME_EXISTS":6,"STOREITEM_EXISTS":7,"INSUFFICIENT_BALANCE":8},"type":"Enum","bytes":1}},"vars":{"x":{"atBytes":0,"typedef":"ErrorCodesEnum","type":"Enum","bytes":1,"names":{"NULL":0,"SUCCESS":1,"ERROR":2,"NOT_FOUND":3,"EXISTS":4,"RECURSIVE":5,"USERNAME_EXISTS":6,"STOREITEM_EXISTS":7,"INSUFFICIENT_BALANCE":8}}}}

|]

   "InfoFeed" -> [r|

{"funcs":{"info":{"args":{},"selector":"370158ea","vals":{"ret":{"type":"Int","index":0,"bytes":32}}}}}

|]

   "SimpleDataFeed" -> [r|

{"funcs":{"update":{"args":{"newPrice":{"type":"Int","index":0,"bytes":32}},"selector":"82ab890a","vals":{}}},"vars":{"lastPrice":{"atBytes":0,"type":"Int","bytes":32}}}

|]

   "Stake" -> [r|

{"funcs":{"payout":{"args":{},"selector":"63bd1d4a","vals":{}},"addStakeHolder":{"args":{"stakeholder":{"type":"Address","index":0}},"selector":"11a76f37","vals":{}}},"vars":{"holdingTheBag":{"atBytes":64,"type":"Address"},"numStakeHolders":{"atBytes":96,"type":"Int","bytes":32},"stake":{"atBytes":0,"dynamic":true,"value":{"type":"Int","bytes":32},"key":{"type":"Address"},"type":"Mapping"},"sumStake":{"atBytes":160,"type":"Int","bytes":32},"stakeHolders":{"atBytes":32,"dynamic":true,"entry":{"type":"Address"},"type":"Array"},"currentStake":{"atBytes":128,"type":"Int","bytes":32}}}

|]


   x -> error $ "no contract is named " ++ x
