{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell   #-}

module ProcessorSpec where

import qualified Data.ByteString as B
import Test.Hspec
import Text.RawString.QQ

import Blockchain.Strato.Model.Address
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
      "data": [
        {
          "gasPrice": 1,
          "sender": "eb6b5070bad6eb2efec046fb00179395ee308608",
          "value": 0,
          "input": "",
          "owner": "95b0195a59bdb49db4c8ffacbd93dc67857fbe82",
          "output": "608060405260043610603f576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168063c5d7802e146044575b600080fd5b348015604f57600080fd5b506056606c565b6040518082815260200191505060405180910390f35b600054815600a165627a7a72305820639e7d28b71a1ef617bf71da6ad97c06640d12a4d4778298c9d027fdf29cc1c00029",
          "type": "Create"
        }
      ],
      "codeHash": {
        "kind": "EVM",
        "digest": "794bb2542a58e85323a2d871316b5b2ce24fd089d22ab6e1ab3608927ea7b189"
      },
      "codeKind": "EVM"
    },
    "eb6b5070bad6eb2efec046fb00179395ee308608": {
      "diff": {
        "0000000000000000000000000000000000000000000000000000000000000000": "00000000000000000000000095b0195a59bdb49db4c8ffacbd93dc67857fbe82"
      },
      "data": [
        {
          "gasPrice": 1,
          "sender": "d18abf689702c2c4b00ca666fd2e38f87d4944e9",
          "value": 0,
          "input": "",
          "owner": "eb6b5070bad6eb2efec046fb00179395ee308608",
          "output": "6080604052600080fd00a165627a7a7230582090e070e4b8b3df7093ff1a80d3cb4ba05124a560a39709332610169c318757e30029",
          "type": "Create"
        }
      ],
      "codeHash": {
        "kind": "EVM",
        "digest": "2d04e92a4bf8c25d551bbc54cf020e4396c99f14c1d4f3f7cd18788cca84fb11"
      },
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
             "eventContractAddress" : "2e385b6a3aea46d4172df98617b5385c13b7100d",
             "eventName" : "Vehicle Event",
             "eventArgs" : ["x", "y"]
           }
         ]
}
|]

spec :: Spec
spec = do

  it "can create multiple actions from a single message" $ do
    -- The ActionDatas have different codehashes, and so should be processed indepedently
    map fst (parseActions [messageToSplit]) `shouldBe`
      [ (Address 0x95b0195a59bdb49db4c8ffacbd93dc67857fbe82, Nothing)
      , (Address 0xeb6b5070bad6eb2efec046fb00179395ee308608, Nothing)]
