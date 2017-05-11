{-# LANGUAGE
      OverloadedStrings
    , QuasiQuotes
#-}


module BlockApps.XAbiConverterSpec where

import           Test.Hspec
import           Data.Aeson
import qualified Data.ByteString.Lazy as ByteString
--import           Data.List
import qualified Data.Map as Map
import           Data.Maybe
import           BlockApps.Solidity.Xabi
--import           BlockApps.Solidity.Xabi.Type
import           BlockApps.XAbiConverter

import Text.RawString.QQ

spec :: Spec
spec =
  describe "Xabi" $ do
    it "should convert a first pass xabi to a contract, then to a second pass xabi" $ do
      let firstPass = fromMaybe undefined $ decode firstPassString
          secondPass = fromMaybe undefined $ decode secondPassString::Xabi
      --We don't yet put constructors in the contract to xabi conversion, so I remove this field for the test.
      (contractToXabi $ either undefined id $ xAbiToContract firstPass) `shouldBe` secondPass{xabiConstr=Map.empty}

secondPassString::ByteString.ByteString
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
      "vars":{  
         "hash":{  
            "atBytes":160,
            "type":"Bytes",
            "bytes":32,
            "public":true
         },
         "contents":{  
            "atBytes":192,
            "dynamic":true,
            "type":"String",
            "public":true
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
            "type":"Mapping",
            "public":true
         },
         "owner":{  
            "atBytes":0,
            "type":"Address",
            "public":true
         },
         "author":{  
            "atBytes":96,
            "type":"Address",
            "public":true
         },
         "userOwner":{  
            "atBytes":64,
            "type":"Address",
            "public":true
         },
         "tags":{  
            "atBytes":128,
            "dynamic":true,
            "entry":{  
               "type":"Bytes",
               "bytes":32
            },
            "type":"Array",
            "public":true
         }
      }
   }

|]


firstPassString::ByteString.ByteString
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
         "_author":{  
            "type":"Address",
            "index":1
         },
         "_userOwner":{  
            "type":"Address",
            "index":0
         },
         "_hash":{  
            "dynamic":false,
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
               "dynamic":false,
               "type":"Bytes",
               "bytes":32
            },
            "type":"Array",
            "index":3
         }
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



