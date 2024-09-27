{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module ActionFidelitySpec where

import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action
import Data.Aeson
import Data.Aeson.QQ
import qualified Data.ByteString as B
import Data.Either
import qualified Data.Map.Strict as M
import qualified Data.Map.Ordered as OMap
import qualified Data.Sequence as S
import Data.Time.Clock.POSIX
import qualified LabeledError
import Test.Hspec
import Test.QuickCheck

convert :: Action -> Either String Action -- 🤔
convert = eitherDecode . encode

emptyEVMData :: Action.ActionData
emptyEVMData = Action.ActionData (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0) mempty "LambdaCorp1" Nothing "Clozure1" "Clozure1 address" EVM (Action.EVMDiff M.empty) M.empty [] [] []

emptySolidVMData :: Action.ActionData
emptySolidVMData = Action.ActionData (SolidVMCode "ContractName" $ unsafeCreateKeccak256FromWord256 0) mempty "LambdaCorp2" Nothing "Clozure2" "Clozure2 address" SolidVM (Action.SolidVMDiff M.empty) M.empty [] [] []

emptyAction :: Action
emptyAction = Action.Action (unsafeCreateKeccak256FromWord256 0) (posixSecondsToUTCTime 0) 0 (unsafeCreateKeccak256FromWord256 0) Nothing (Account 0x0 Nothing) OMap.empty Nothing S.empty S.empty

spec :: Spec
spec = describe "Action conversions" $ do
  it "should parse empty actions" $ do
    convert emptyAction `shouldSatisfy` isRight

  it "should parse empty Word256 actions" $ do
    convert emptyAction {Action._actionData = OMap.singleton ((Account 0x988 Nothing), emptyEVMData)}
      `shouldSatisfy` isRight

  it "should parse empty ByteString actions" $ do
    convert emptyAction {Action._actionData = OMap.singleton ((Account 0x988 Nothing), emptySolidVMData)}
      `shouldSatisfy` isRight

  it "should parse basic Word256 actions" $ do
    let diff = Action.EVMDiff $ M.singleton 0xffffffffff 0xeeeeeeeeeeeeeee
        daytuh = emptyEVMData {Action._actionDataStorageDiffs = diff}
    convert emptyAction {Action._actionData = OMap.singleton ((Account 0x988 Nothing), daytuh)} `shouldSatisfy` isRight

  it "should parse basic bytestring actions" $ do
    let diff = Action.SolidVMDiff $ M.singleton (B.replicate 34 0x6b) (B.replicate 33 0x76)
        daytuh = emptySolidVMData {Action._actionDataStorageDiffs = diff}
    convert emptyAction {Action._actionData = OMap.singleton ((Account 0x988 Nothing), daytuh)} `shouldSatisfy` isRight

  it "should convert bytestrings properly" $ do
    toJSON ("\x80\x60\x40" :: B.ByteString) `shouldBe` String "806040"

  it "should parse any actions" $
    withMaxSuccess 25 $
      property $ \a -> do
        convert a `shouldSatisfy` isRight

  it "should be backwards compatible" $ do
    let forceHash = unsafeCreateKeccak256FromByteString . LabeledError.b16Decode "slipstream/ActionFidelitySpec.hs"
        oldStyle =
          [aesonQQ| {
         "chainId": null,
         "data": {
           "omapData": [
             [ "2f6ff9d4a35c07f7b630fe1ce039bc45559b5fb6", {
                 "codeCollection": {
                   "_contracts": {},
                   "_flFuncs": {},
                   "_flConstants": {},
                   "_flEnums": {},
                   "_flStructs": {},
                   "_flErrors": {},
                   "_pragmas": [],
                   "_imports": []
                 },
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
                 "types": ["Create"],
                 "codeHash": "86bc2e2a375e6ea377ae90026248f472fbeaa1354ef4424f568d01f3a48ab5b9",
                 "creator": "BlockApps1",
                 "cc_creator":"BlockApps0",
                 "root" : "ClothingUTXO",
                 "application": "LogisticsEngine1",
                 "abstracts": [],
                 "mappings": [],
                 "arrays": []
               }
             ]
           ]
         },
         "sender": "c2191df3032cb8ee72e37ab6bbc4e83f92b9911c",
         "blockHash": "53fe605019e925357f1077cf753b17384e56379fa4dca1064cbb5e956d76e32f",
         "transactionHash": "3d5069c6b8f6e3922f8a98bef4f23c2d73794403172c12d6915d51ad47a9e827",
         "blockTimestamp": "2019-02-22T18:05:59Z",
         "blockNumber": 9,
         "metadata": {
           "name": "Vehicle",
           "src": "contract Vehicle {}"
         },
         "events" : 
         [ { "eventBlockHash": "0000000000000000000000000000000000000000000000000000000000000000",
             "eventContractCreator": "BlockApps2",
             "eventContractRoot": "ClothingUTXO",
             "eventContractApplication": "LogisticsEngine2",
             "eventContractName" : "Vehicle",
             "eventContractAccount" : "2e385b6a3aea46d4172df98617b5385c13b7100d",
             "eventName" : "Vehicle Event",
             "eventArgs" : [["field", "value", "String"], ["anotherField", "anotherValue","String"]]
           }
         ]
       }|]

    eitherDecode (encode oldStyle)
      `shouldBe` Right
        ( Action.Action
            { Action._blockHash = forceHash "53fe605019e925357f1077cf753b17384e56379fa4dca1064cbb5e956d76e32f",
              Action._blockTimestamp = posixSecondsToUTCTime 1550858759,
              Action._blockNumber = 9,
              Action._transactionHash = forceHash "3d5069c6b8f6e3922f8a98bef4f23c2d73794403172c12d6915d51ad47a9e827",
              Action._transactionChainId = Nothing,
              Action._transactionSender = Account 0xc2191df3032cb8ee72e37ab6bbc4e83f92b9911c Nothing,
              Action._actionData =
                OMap.singleton ((Account 0x2f6ff9d4a35c07f7b630fe1ce039bc45559b5fb6 Nothing) ,
                  Action.ActionData
                    { Action._actionDataStorageDiffs =
                        Action.EVMDiff . M.fromList $
                          [ (0, 0x5c703a07),
                            (1, 0x76696e5f305f300000000000000000000000000000000000000000000000000e),
                            (2, 0x73305f305f30000000000000000000000000000000000000000000000000000c),
                            (3, 0x73315f305f30000000000000000000000000000000000000000000000000000c),
                            (4, 0x73325f305f30000000000000000000000000000000000000000000000000000c),
                            (5, 0x73335f305f30000000000000000000000000000000000000000000000000000c)
                          ],
                      Action._actionDataCodeCollection = mempty,
                      Action._actionDataCodeHash = ExternallyOwned $ forceHash "86bc2e2a375e6ea377ae90026248f472fbeaa1354ef4424f568d01f3a48ab5b9",
                      Action._actionDataCreator = "BlockApps1",
                      Action._actionDataCCCreator = Just "BlockApps0",
                      Action._actionDataRoot = "ClothingUTXO",
                      Action._actionDataApplication = "LogisticsEngine1",
                      Action._actionDataCodeKind = EVM,
                      Action._actionDataAbstracts = M.empty,
                      Action._actionDataMappings = [],
                      Action._actionDataArrays = [],
                      Action._actionDataCallTypes = [Action.Create]
                    }),
              Action._metadata = Just . M.fromList $ [("name", "Vehicle"), ("src", "contract Vehicle {}")],
              Action._events = S.singleton $ Event zeroHash "BlockApps2" "LogisticsEngine2" "Vehicle" (Account 0x2e385b6a3aea46d4172df98617b5385c13b7100d Nothing) "Vehicle Event" [("field", "value", "String"), ("anotherField", "anotherValue", "String")],
              Action._delegatecalls = S.empty
            }
        )
