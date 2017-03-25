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

   x -> error $ "no contract is named " ++ x
