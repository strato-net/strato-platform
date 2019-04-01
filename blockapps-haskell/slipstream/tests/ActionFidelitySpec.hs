{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
module ActionFidelitySpec where

import Data.Aeson
import Data.Aeson.QQ
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.Either
import qualified Data.Map.Strict as M
import Data.Time.Clock.POSIX
import Test.QuickCheck
import Test.Hspec

import qualified Blockchain.Strato.Model.Action as BS
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.SHA
import Blockchain.SolidVM.Model
import qualified Slipstream.Data.Action as SS

convert :: BS.Action -> Either String SS.Action'
convert = eitherDecode . encode

emptyEVMData :: BS.ActionData
emptyEVMData = BS.ActionData (SHA 0) EVM (BS.ActionEVMDiff M.empty) []

emptySolidVMData :: BS.ActionData
emptySolidVMData = BS.ActionData (SHA 0) SolidVM (BS.ActionSolidVMDiff M.empty) []

emptyAction :: BS.Action
emptyAction = BS.Action (SHA 0) (posixSecondsToUTCTime 0) 0 (SHA 0) Nothing 0x0 M.empty Nothing

spec :: Spec
spec = describe "Action conversions" $ do
   it "should parse empty actions" $ do
      convert emptyAction `shouldSatisfy` isRight

   it "should parse empty Word256 actions" $ do
      convert emptyAction{BS._actionData=M.singleton 0x988 emptyEVMData}
          `shouldSatisfy` isRight

   it "should parse empty ByteString actions" $ do
      convert emptyAction{BS._actionData=M.singleton 0x988 emptySolidVMData}
          `shouldSatisfy` isRight

   it "should parse basic Word256 actions" $ do
    let diff = BS.ActionEVMDiff $ M.singleton 0xffffffffff 0xeeeeeeeeeeeeeee
        daytuh = emptyEVMData {BS._actionDataStorageDiffs = diff}
    convert emptyAction{BS._actionData = M.singleton 0x988 daytuh} `shouldSatisfy` isRight

   it "should parse basic bytestring actions" $ do
    let diff = BS.ActionSolidVMDiff $ M.singleton (B.replicate 34 0x6b) (B.replicate 33 0x76)
        daytuh = emptySolidVMData {BS._actionDataStorageDiffs = diff}
    convert emptyAction{BS._actionData = M.singleton 0x988 daytuh} `shouldSatisfy` isRight

   it "should convert bytestrings properly" $ do
     toJSON ("\x80\x60\x40" :: B.ByteString) `shouldBe` String "806040"

   it "should parse any actions" $ withMaxSuccess 25 $ property $ \a -> do
     convert a `shouldSatisfy` isRight

   it "should be backwards compatible" $ do
     let forceHash = SHA . bytesToWord256 . fst . B16.decode
         oldStyle = [aesonQQ| {
         "chainId": null,
         "data": {
           "2f6ff9d4a35c07f7b630fe1ce039bc45559b5fb6": {
             "diff": {
               "0000000000000000000000000000000000000000000000000000000000000000":
                 "000000000000000000000000000000000000000000000000000000005c703a07",
               "0000000000000000000000000000000000000000000000000000000000000001":
                 "76696e5f305f300000000000000000000000000000000000000000000000000e",
               "0000000000000000000000000000000000000000000000000000000000000004":
                 "73325f305f30000000000000000000000000000000000000000000000000000c",
               "0000000000000000000000000000000000000000000000000000000000000002":
                 "73305f305f30000000000000000000000000000000000000000000000000000c",
               "0000000000000000000000000000000000000000000000000000000000000005":
                 "73335f305f30000000000000000000000000000000000000000000000000000c",
               "0000000000000000000000000000000000000000000000000000000000000003":
                 "73315f305f30000000000000000000000000000000000000000000000000000c"
             },
             "data": [
               {
                 "gasPrice": 1,
                 "sender": "c2191df3032cb8ee72e37ab6bbc4e83f92b9911c",
                 "value": 0,
                 "input": "",
                 "owner": "2f6ff9d4a35c07f7b630fe1ce039bc45559b5fb6",
                 "output": "608060",
                 "type": "Create"
               }
             ],
             "codeHash": "86bc2e2a375e6ea377ae90026248f472fbeaa1354ef4424f568d01f3a48ab5b9"
           }
         },
         "sender": "c2191df3032cb8ee72e37ab6bbc4e83f92b9911c",
         "blockHash": "53fe605019e925357f1077cf753b17384e56379fa4dca1064cbb5e956d76e32f",
         "transactionHash": "3d5069c6b8f6e3922f8a98bef4f23c2d73794403172c12d6915d51ad47a9e827",
         "blockTimestamp": "2019-02-22T18:05:59Z",
         "blockNumber": 9,
         "metadata": {
           "name": "Vehicle",
           "src": "contract Vehicle {}"
         }
       }|]

     eitherDecode (encode oldStyle) `shouldBe` Right (SS.Action'
        { SS._blockHash = forceHash "53fe605019e925357f1077cf753b17384e56379fa4dca1064cbb5e956d76e32f"
        , SS._blockTimestamp = posixSecondsToUTCTime 1550858759
        , SS._blockNumber = 9
        , SS._transactionHash = forceHash "3d5069c6b8f6e3922f8a98bef4f23c2d73794403172c12d6915d51ad47a9e827"
        , SS._transactionChainId = Nothing
        , SS._transactionSender = 0xc2191df3032cb8ee72e37ab6bbc4e83f92b9911c
        , SS._actionData = M.singleton 0x2f6ff9d4a35c07f7b630fe1ce039bc45559b5fb6 $ SS.ActionData
          { SS._storageDiffs = BS.ActionEVMDiff . M.fromList $
            [ (0, 0x5c703a07)
            , (1, 0x76696e5f305f300000000000000000000000000000000000000000000000000e)
            , (2, 0x73305f305f30000000000000000000000000000000000000000000000000000c)
            , (3, 0x73315f305f30000000000000000000000000000000000000000000000000000c)
            , (4, 0x73325f305f30000000000000000000000000000000000000000000000000000c)
            , (5, 0x73335f305f30000000000000000000000000000000000000000000000000000c)
            ]
          , SS._codeHash = forceHash "86bc2e2a375e6ea377ae90026248f472fbeaa1354ef4424f568d01f3a48ab5b9"
          , SS._codeKind = EVM
          , SS._callData = [SS.CallData
            { SS._callType = SS.Create
            , SS._sender = 0xc2191df3032cb8ee72e37ab6bbc4e83f92b9911c
            , SS._owner = 0x2f6ff9d4a35c07f7b630fe1ce039bc45559b5fb6
            , SS._gasPrice = 1
            , SS._value = 0
            , SS._input = ""
            , SS._output = Just "\x60\x80\x60"
            }]
          }
        , SS._metadata = Just . M.fromList $ [("name", "Vehicle"), ("src", "contract Vehicle {}")]
      })
