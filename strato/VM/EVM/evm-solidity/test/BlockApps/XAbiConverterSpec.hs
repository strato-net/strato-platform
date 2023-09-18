{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module BlockApps.XAbiConverterSpec where

import qualified BlockApps.Solidity.Struct as Struct
import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
import BlockApps.Solidity.Xabi
import BlockApps.XAbiConverter
import Data.Aeson
import qualified Data.ByteString.Lazy as ByteString
import qualified Data.Map.Strict as M
import Data.Maybe
import Test.Hspec
import Text.RawString.QQ

spec :: Spec
spec =
  describe "Xabi" $ do
    it "should convert a first pass xabi to a contract, then to a second pass xabi" $ do
      let firstPass = fromMaybe undefined $ decode firstPassString
          secondPass = fromMaybe undefined $ decode secondPassString :: Xabi
      contractToXabi "MyContract" (either undefined id $ xAbiToContract firstPass) `shouldBe` secondPass
    it "should derive the correct size of a struct definition ending with a single-byte type" $ do
      let tdefs = TypeDefs M.empty M.empty
          fields =
            [ (("exceptionID", SimpleType typeUInt), Nothing),
              (("exceptionType", SimpleType typeUInt), Nothing),
              (("exceptionLevel", SimpleType typeUInt), Nothing),
              (("stateType", SimpleType typeUInt), Nothing),
              (("state", SimpleType typeUInt), Nothing),
              (("timeoutLength", SimpleType typeUInt), Nothing),
              (("minValue", SimpleType typeUInt), Nothing),
              (("maxValue", SimpleType typeUInt), Nothing),
              (("isWarning", SimpleType $ TypeBool), Nothing)
            ]
      Struct.size (fieldsToStruct tdefs fields) `shouldBe` fromIntegral (32 * length fields)

secondPassString :: ByteString.ByteString
secondPassString =
  [r|

   {
      "funcs":{
         "isReader":{
            "args":{
               "reader":{
                  "type":"Address",
                  "index":0
               }
            },
            "selector":"69a7ddf7",
            "vals":{
               "#0":{
                  "type":"Bool",
                  "index":0
               }
            }
         },
         "addReader":{
            "args":{
               "reader":{
                  "type":"Address",
                  "index":0
               }
            },
            "selector":"afd8b1d1",
            "vals":{

            }
         },
         "getContents":{
            "args":{

            },
            "selector":"23677ae2",
            "vals":{
               "#0":{
                  "dynamic":true,
                  "type":"String",
                  "index":0
               }
            }
         },
         "transfer":{
            "args":{
               "_owner":{
                  "type":"Address",
                  "index":0
               }
            },
            "selector":"1a695230",
            "vals":{

            }
         },
         "isOwner":{
            "args":{
               "addr":{
                  "type":"Address",
                  "index":0
               }
            },
            "selector":"2f54bf6e",
            "vals":{
               "#0":{
                  "type":"Bool",
                  "index":0
               }
            }
         }
      },
      "constr":{
         "args":{
           "_author":{
               "type":"Address",
               "index":1
           },
           "_userOwner":{
               "type":"Address",
               "index":0
           },
           "_hash":{
               "type":"Bytes",
               "index":2,
               "bytes":32
           },
           "_contents":{
               "dynamic":true,
               "type":"String",
               "index":4
           },
           "_tags":{
               "dynamic":true,
               "entry":{
                 "type":"Bytes",
                 "bytes":32
               },
               "type":"Array",
               "index":3
           }
         },
         "vals":{}
      },
      "vars":{
         "hash":{
            "atBytes":160,
            "type":"Bytes",
            "bytes":32
         },
         "contents":{
            "atBytes":192,
            "dynamic":true,
            "type":"String"
         },
         "readers":{
            "atBytes":32,
            "dynamic":true,
            "value":{
               "type":"Bool"
            },
            "key":{
               "type":"Address"
            },
            "type":"Mapping"
         },
         "owner":{
            "atBytes":0,
            "type":"Address"
         },
         "author":{
            "atBytes":96,
            "type":"Address"
         },
         "userOwner":{
            "atBytes":64,
            "type":"Address"
         },
         "tags":{
            "atBytes":128,
            "dynamic":true,
            "entry":{
               "type":"Bytes",
               "bytes":32
            },
            "type":"Array"
         }
      }
   }

|]

firstPassString :: ByteString.ByteString
firstPassString =
  [r|


   {
      "funcs":{
         "isReader":{
            "args":{
               "reader":{
                  "type":"Address",
                  "index":0
               }
            },
            "vals":{
               "#0":{
                  "type":"Bool",
                  "index":0
               }
            }
         },
         "addReader":{
            "args":{
               "reader":{
                  "type":"Address",
                  "index":0
               }
            },
            "vals":{
            }
         },
         "getContents":{
            "args":{
            },
            "vals":{
               "#0":{
                  "dynamic":true,
                  "type":"String",
                  "index":0
               }
            }
         },
         "transfer":{
            "args":{
               "_owner":{
                  "type":"Address",
                  "index":0
               }
            },
            "vals":{
            }
         },
         "isOwner":{
            "args":{
               "addr":{
                  "type":"Address",
                  "index":0
               }
            },
            "vals":{
               "#0":{
                  "type":"Bool",
                  "index":0
               }
            }
         }
      },
      "types":{
         "Owned":{
            "type":"Contract",
            "bytes":0
         },
         "StorageBlob":{
            "type":"Contract",
            "bytes":0
         },
         "ReadPermissioned":{
            "type":"Contract",
            "bytes":0
         },
         "IdentityAccessManager":{
            "type":"Contract",
            "bytes":0
         },
         "BasicUserStorage":{
            "type":"Contract",
            "bytes":0
         },
         "Login":{
            "type":"Contract",
            "bytes":0
         }
      },
      "constr":{
         "args":{
           "_author":{
               "type":"Address",
               "index":1
           },
           "_userOwner":{
               "type":"Address",
               "index":0
           },
           "_hash":{
               "type":"Bytes",
               "index":2,
               "bytes":32
           },
           "_contents":{
               "dynamic":true,
               "type":"String",
               "index":4
           },
           "_tags":{
               "dynamic":true,
               "entry":{
                 "type":"Bytes",
                 "bytes":32
               },
               "type":"Array",
               "index":3
           }
         },
         "vals":{}
      },
      "vars":{
         "hash":{
            "atBytes":96,
            "dynamic":false,
            "type":"Bytes",
            "bytes":32,
            "public":false
         },
         "contents":{
            "atBytes":128,
            "dynamic":true,
            "type":"String",
            "public":false
         },
         "readers":{
            "atBytes":0,
            "dynamic":true,
            "value":{
               "type":"Bool"
            },
            "key":{
               "type":"Address"
            },
            "type":"Mapping",
            "public":false
         },
         "owner":{
            "atBytes":0,
            "type":"Address",
            "public":false
         },
         "author":{
            "atBytes":32,
            "type":"Address",
            "public":false
         },
         "userOwner":{
            "atBytes":0,
            "type":"Address",
            "public":false
         },
         "tags":{
            "atBytes":64,
            "dynamic":true,
            "entry":{
               "dynamic":false,
               "type":"Bytes",
               "bytes":32
            },
            "type":"Array",
            "public":false
         }
      }
   }

|]
