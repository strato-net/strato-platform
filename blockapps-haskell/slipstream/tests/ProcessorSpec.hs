{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell   #-}

module ProcessorSpec where

import qualified Data.ByteString as B
import Test.Hspec
import Text.RawString.QQ

import Blockchain.Strato.Model.Account
import Slipstream.Processor

messageToSplit :: B.ByteString
messageToSplit = [r|
{
  "chainId": null,
  "data": {
    "95b0195a59bdb49db4c8ffacbd93dc67857fbe82": {
      "diff": {
        "0000000000000000000000000000000000000000000000000000000000000000": "0000000000000000000000000000000000000000000000000000000000001dc8"
      },
      "types": ["Create"],
      "codeHash": {
        "kind": "EVM",
        "digest": "794bb2542a58e85323a2d871316b5b2ce24fd089d22ab6e1ab3608927ea7b189"
      },
      "organization": "",
      "application": "",
      "codeKind": "EVM"
    },
    "eb6b5070bad6eb2efec046fb00179395ee308608": {
      "diff": {
        "0000000000000000000000000000000000000000000000000000000000000000": "00000000000000000000000095b0195a59bdb49db4c8ffacbd93dc67857fbe82"
      },
      "types": ["Create"],
      "codeHash": {
        "kind": "EVM",
        "digest": "2d04e92a4bf8c25d551bbc54cf020e4396c99f14c1d4f3f7cd18788cca84fb11"
      },
      "organization": "",
      "application": "",
      "codeKind": "EVM"
    }
  },
  "sender": "d18abf689702c2c4b00ca666fd2e38f87d4944e9",
  "blockHash": "1c3347ba8d9ccd9279df945107abc9385f16d31f6671cfc744234d504d517df7",
  "transactionHash": "c4a10600b73d11db293d047f7b3c8cf6bd4d5b37e581134f09eaa02bb4071943",
  "blockTimestamp": "2019-04-11T14:40:59Z",
  "blockNumber": 3,
  "metadata": {
    "name": "Y",
    "src": "\ncontract X {\n  uint public z = 7624;\n}\n\ncontract Y {\n  X x;\n  constructor() public {\n    x = new X();\n  }\n}\n"
  },
  "events" : 
         [ { "eventContractName" : "Vehicle",
             "eventContractOrganization": "",
             "eventContractApplication": "",
             "eventContractAccount" : "2e385b6a3aea46d4172df98617b5385c13b7100d",
             "eventName" : "Vehicle Event",
             "eventArgs" : [["field", "value"], ["anotherField", "anotherValue"]]
           }
         ]
}
|]

messageToSplit2 :: B.ByteString
messageToSplit2 = [r|
{
  "chainId": null,
  "data": {
    "95b0195a59bdb49db4c8ffacbd93dc67857fbe82": {
      "diff": {
        "0000000000000000000000000000000000000000000000000000000000000000": "0000000000000000000000000000000000000000000000000000000000001dc8"
      },
      "types": ["Create"],
      "codeHash": {
        "name": "MyAmazingName",
        "kind": "SolidVM",
        "digest": "794bb2542a58e85323a2d871316b5b2ce24fd089d22ab6e1ab3608927ea7b189"
      },
      "organization": "Superduper",
      "application": "OutOfSpace",
      "codeKind": "SolidVM"
    },
    "eb6b5070bad6eb2efec046fb00179395ee308608": {
      "diff": {
        "0000000000000000000000000000000000000000000000000000000000000000": "00000000000000000000000095b0195a59bdb49db4c8ffacbd93dc67857fbe82"
      },
      "types": ["Create"],
      "codeHash": {
        "name": "MyAmazingName2",
        "kind": "SolidVM",
        "digest": "2d04e92a4bf8c25d551bbc54cf020e4396c99f14c1d4f3f7cd18788cca84fb11"
      },
      "organization": "Superduper2",
      "application": "OutOfSpace2",
      "codeKind": "SolidVM"
    }
  },
  "sender": "d18abf689702c2c4b00ca666fd2e38f87d4944e9",
  "blockHash": "1c3347ba8d9ccd9279df945107abc9385f16d31f6671cfc744234d504d517df7",
  "transactionHash": "c4a10600b73d11db293d047f7b3c8cf6bd4d5b37e581134f09eaa02bb4071943",
  "blockTimestamp": "2019-04-11T14:40:59Z",
  "blockNumber": 3,
  "metadata": {
    "name": "Y",
    "src": "\ncontract X {\n  uint public z = 7624;\n}\n\ncontract Y {\n  X x;\n  constructor() public {\n    x = new X();\n  }\n}\n"
  },
  "events" : 
         [ { "eventContractName" : "Vehicle",
             "eventContractOrganization": "Superduper3",
             "eventContractApplication": "OutOfSpace3",
             "eventContractAccount" : "2e385b6a3aea46d4172df98617b5385c13b7100d",
             "eventName" : "Vehicle Event",
             "eventArgs" : [["field", "value"], ["anotherField", "anotherValue"]]
           }
         ]
}
|]

spec :: Spec
spec = do

  it "can create multiple actions from a single message" $ do
    -- The ActionDatas have different codehashes, and so should be processed indepedently
    map fst (parseActions [messageToSplit]) `shouldBe`
      [ (Account 0x95b0195a59bdb49db4c8ffacbd93dc67857fbe82 Nothing)
      , (Account 0xeb6b5070bad6eb2efec046fb00179395ee308608 Nothing)]
  it "can create multiple actions from a single message 2" $ do
    map fst (parseActions [messageToSplit2]) `shouldBe`
      [ (Account 0x95b0195a59bdb49db4c8ffacbd93dc67857fbe82 Nothing)
      , (Account 0xeb6b5070bad6eb2efec046fb00179395ee308608 Nothing)]
