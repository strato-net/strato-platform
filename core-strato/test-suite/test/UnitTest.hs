{-# LANGUAGE QuasiQuotes, ExtendedDefaultRules #-}
import Data.Aeson
import qualified Data.ByteString as BS
import Data.Time.Clock.POSIX
import qualified Data.Map as M
import qualified Data.ByteString.Lazy.Char8 as C8
import Text.InterpolatedString.Perl6
import Test.Hspec

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code

import Blockchain.VM.TestDescriptions

exampleFile :: String
exampleFile = [q|
 {
     "address0" : {
         "_info" : {
             "comment" : "",
             "filledwith" : "testeth 1.5.0.dev2-52+commit.d419e0a2",
             "lllcversion" : "Version: 0.4.26-develop.2018.9.19+commit.785cbf40.Linux.g++",
             "source" : "src/VMTestsFiller/vmEnvironmentalInfo/address0Filler.json",
             "sourceHash" : "37a0fc3337fde7233f427195a290be689e01aa752a8394b0ae56306fd97d3624"
         },
         "callcreates" : [
         ],
         "env" : {
             "currentCoinbase" : "0x2adc25665018aa1fe0e6bc666dac8fc2697ff9ba",
             "currentDifficulty" : "0x0100",
             "currentGasLimit" : "0x0f4240",
             "currentNumber" : "0x00",
             "currentTimestamp" : "0x01"
         },
         "exec" : {
             "address" : "0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6",
             "caller" : "0xcd1722f3947def4cf144679da39c4c32bdc35681",
             "code" : "0x30600055",
             "data" : "0x",
             "gas" : "0x174876e800",
             "gasPrice" : "0x3b9aca00",
             "origin" : "0xcd1722f3947def4cf144679da39c4c32bdc35681",
             "value" : "0x0de0b6b3a7640000"
         },
         "gas" : "0x17487699db",
         "logs" : "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
         "out" : "0x",
         "post" : {
             "0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6" : {
                 "balance" : "0x152d02c7e14af6800000",
                 "code" : "0x30600055",
                 "nonce" : "0x00",
                 "storage" : {
                     "0x00" : "0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6"
                 }
             }
         },
         "pre" : {
             "0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6" : {
                 "balance" : "0x152d02c7e14af6800000",
                 "code" : "0x30600055",
                 "nonce" : "0x00",
                 "storage" : {
                 }
             }
         }
     }
 }|]



main :: IO ()
main = hspec spec

spec :: Spec
spec = describe "Test Files" $ do
         it "can parse VMTest files" $ do
            let want = M.singleton "address0" Test {
                       callcreates = Just []
                     , env = Env
                        { currentCoinbase =  0x2adc25665018aa1fe0e6bc666dac8fc2697ff9ba
                        , currentDifficulty =  "0x0100"
                        , currentGasLimit =  0x0f4240
                        , currentNumber =  "0x00"
                        , currentTimestamp = posixSecondsToUTCTime 1
                        , previousHash = Nothing
                        }
                    , out = RawData BS.empty
                    , remainingGas = Just 0x17487699db
                    , theInput = IExec Exec {
                          address' = 0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6
                        , caller = 0xcd1722f3947def4cf144679da39c4c32bdc35681
                        , code = Code . BS.pack $ [0x30, 0x60, 0x00, 0x55]
                        , data' = RawData BS.empty
                        , gas' = "0x174876e800"
                        , gasPrice' = "0x3b9aca00"
                        , origin = 0xcd1722f3947def4cf144679da39c4c32bdc35681
                        , value' = "0x0de0b6b3a7640000"
                        }
                    , pre = M.singleton 0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6
                        AddressState'
                          { balance' = 0x152d02c7e14af6800000
                          , contractCode' = Code .BS.pack $ [0x30, 0x60, 0x00, 0x55]
                          , nonce' = 0
                          , storage' = M.empty
                          }
                    , post = M.singleton 0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6
                        AddressState'
                          { balance' = 0x152d02c7e14af6800000
                          , contractCode' = Code . BS.pack $ [0x30, 0x60, 0x00, 0x55]
                          , nonce' = 0
                          , storage' = M.singleton 0 0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6
                          }
                    }
            let got = (eitherDecode . C8.pack $ exampleFile) :: Either String Tests
            got `shouldBe` Right want

         it "can parse vm test addresses" $ do

            eitherDecode (C8.pack "\"0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6\"")
              `shouldBe` Right (Address 0x0f572e5295c57f15886f9b263e2f6d2d6c7b5ec6)
