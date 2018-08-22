{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Main where

import Test.Hspec
import Slipstream.OutputData
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import Network
import HFlags
import qualified Data.ByteString.Char8 as BC

{-
Test: Message conversion to statediff is successful and accurate
Test: Failure to receive kafka message generates correct retry message and correct logging
Test: Failed message conversion generates correct error message
Test: db writes are successful (test our common pre-established format)
Test: when db queries fail, error message is correct and is logged correctly
Create some formal tests to confirm correct db writes in each of the tables
Test: when db writes fail, error message is correct and is logged correctly
Test: indexes are accurate
-}

dbSelect :: String -> IO(String)
dbSelect insrt = do
  conn <- pgConnect dbConnect
  let qry = rawPGSimpleQuery $ BC.pack insrt
  p <- pgRunQuery conn qry
  pgDisconnect conn
  --p <- ins
  return $ show $ snd p

main :: IO ()
main = hspec $ do

  describe "" $ do
    it "test1" $ do
      let x = defaultMaxB
      let y = defaultMaxB
      x `shouldBe` y

  describe "Message Conversion Test" $ do
    it "Returns the correctly converted message to a statediff" $ do
      pendingWith "TODO: (Carlo) Simulate successful message conversion"
      let conversionExpected = ""
      let conversionActual = ""
      conversionExpected `shouldBe` conversionActual

  describe "failed Kafka Message Test" $ do
    it "Returns the appropriate response to a failed Kafka message" $ do
      pendingWith "TODO: (Carlo) Simulate kafka message failure"
      let failedKafkaExpected = ""
      let failedKafkaActual = ""
      failedKafkaExpected `shouldBe` failedKafkaActual

  describe "Failed Conversion Test" $ do
    it "Returns the correct message when message conversion fails" $ do
      pendingWith "TODO: (Carlo) Simulate failing message conversion"
      let failedConversionExpected = ""
      let failedConversionActual = ""
      failedConversionExpected `shouldBe` failedConversionActual

  describe "Successful DB Writes Test" $ do
    it "Confirms a successful db write" $ do
      pendingWith "TODO: (Carlo) Simulate successful db writes"
      _ <- $initHFlags "Setup Test Variables"
      let address = "362fdc66a650bb11d61d9d046829d294cad82b70"
      let codeHash = "0b49343ea28762c009cae266ebdb389601a28c9e814033fb9bf1b5ce89590388"
      let abi = "TestABI"
      let contract = "{\"__getContractName__\":\"function () returns (String)\",\"__getSource__\":\"function () returns (String)\",\"b32\":\"function (String) returns (Bytes32)\",\"s0\":\"s0_0_0\",\"s1\":\"s1_0_0\",\"s2\":\"s2_0_0\",\"s3\":\"s3_0_0\",\"set\":\"function (String,String,String,String) returns ()\",\"stringToBytes32\":\"function (String) returns (Bytes32)\",\"vin32\":\"function () returns (Bytes32)\"}"
      let selectStatement = "select s1, s2, s3 from \"0b49343ea28762c009cae266ebdb389601a28c9e814033fb9bf1b5ce8959038\" where address=\'362fdc66a650bb11d61d9d046829d294cad82b70\';"
      let dbWritesExpected = "why"
      convertRet address codeHash abi contract

      -- Call DB with address & codeHash (both tables)
      dbWritesActual <- dbSelect selectStatement

      -- Delete statement
      let deleteStatement = "drop table \"0b49343ea28762c009cae266ebdb389601a28c9e814033fb9bf1b5ce8959038\";"
      let res = dbInsert deleteStatement
      dbWritesExpected `shouldBe` dbWritesActual

  describe "DB Write Failure Test" $ do
    pendingWith "TODO: (Carlo) Simulate failing db writes"
    it "Returns correct message when " $ do
      let dbFailureExpected = ""
      let dbFailureActual = ""
      dbFailureExpected `shouldBe` dbFailureActual


  describe "Index Accuracy Test" $ do
    pendingWith "TODO: (Carlo) Simulate accurate indexing"
    it "" $ do
      let x = ""
      let y = ""
      x `shouldBe` y
