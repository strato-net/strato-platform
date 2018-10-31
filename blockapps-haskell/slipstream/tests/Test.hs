{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Main where

import Test.Hspec
import Slipstream.OutputData
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import qualified Data.ByteString.Char8 as BC
import Conduit
import Data.Default
import Data.IORef
import qualified Data.Set as Set
import Data.Time
import qualified Data.Map as M
import qualified BlockApps.Solidity.Value as V
import BlockApps.Ethereum --(Keccak256, Address)
import Numeric

import Slipstream.Events
import Slipstream.Globals

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

  describe "Array serialization" $ do
    it "should create JSON entries" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input = [ProcessedContract {
            address = testAdd,
            codehash = keccak256 "<CODEHASH>",
            abi = "<ABI>",
            contractName = "Vehicle",
            chain = "<CHAIN>",
            blockHash = keccak256 "<BLOCKHASH>",
            blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
            blockNumber = 123,
            transactionHash = keccak256 "<TRANSACTIONHASH>",
            transactionSender = testAdd,
            transactionFuncName = "constructor",
            transactionInput = [],
            transactionOutput = [],
             contractData = M.singleton "owners" $ V.ValueArrayDynamic [
                V.ValueStruct [
                  ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")]]
            }]

      g <- newIORef def
      runConduit (yield input .| createInserts g .| sinkList)
        `shouldReturn` [
          "insert into contract (\"codeHash\", contract, abi, \"chainId\") values ('dd993a7bf0018419be434b8232c93936b65b1ebf663006e2f906c333427b1402', 'Vehicle', '<ABI>', '<CHAIN>') ON CONFLICT DO NOTHING;",
          "create table if not exists \"Vehicle\" (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text, transaction_function_name text, \"owners\" jsonb, CONSTRAINT \"Vehicle_pkey\" PRIMARY KEY (address, \"chainId\") );",
          "insert into \"Vehicle\" (\"address\", \"chainId\", \"block_hash\", \"block_timestamp\", \"block_number\", \"transaction_hash\", \"transaction_sender\", \"transaction_function_name\", \"owners\") values ('0000000000000000000000000000000000000add', '<CHAIN>', '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08', '2018-09-16 18:28:52.607875 UTC', '123', '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59', '0000000000000000000000000000000000000add', 'constructor', '[{\"hash\":\"Owner_hash_181999847806006\",\"number\":\"18199984780605\"}]') on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\", block_hash = excluded.block_hash, block_timestamp = excluded.block_timestamp, block_number = excluded.block_number, transaction_hash = excluded.transaction_hash, transaction_sender = excluded.transaction_sender, transaction_function_name = excluded.transaction_function_name, \"owners\" = excluded.\"owners\";"]

  describe "Array serialization with history enabled" $ do
    it "should create JSON entries" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
          cHash = keccak256 "<CODEHASH>"
      let input = [ProcessedContract {
             address = testAdd,
             codehash = cHash,
             abi = "<ABI>",
             contractName = "Vehicle",
             chain = "<CHAIN>",
             blockHash = keccak256 "<BLOCKHASH>",
             blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
             blockNumber = 123,
             transactionHash = keccak256 "<TRANSACTIONHASH>",
             transactionSender = testAdd,
             transactionFuncName = "constructor",
             transactionInput = [],
             transactionOutput = [],
             contractData = M.singleton "owners" $ V.ValueArrayDynamic [
                V.ValueStruct [
                  ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")]]
            }]
      g <- newIORef def{historyList = Set.singleton cHash}
      runConduit (yield input .| createInserts g .| sinkList)
        `shouldReturn` [
          "insert into contract (\"codeHash\", contract, abi, \"chainId\") values ('dd993a7bf0018419be434b8232c93936b65b1ebf663006e2f906c333427b1402', 'Vehicle', '<ABI>', '<CHAIN>') ON CONFLICT DO NOTHING;",
          "create table if not exists \"Vehicle\" (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text, transaction_function_name text, \"owners\" jsonb, CONSTRAINT \"Vehicle_pkey\" PRIMARY KEY (address, \"chainId\") );",
          "create table if not exists \"history@Vehicle\" (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text, transaction_function_name text, \"owners\" jsonb);",
          "create table if not exists \"history@Vehicle.constructor\" (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text);",
          "insert into \"history@Vehicle\" (\"address\", \"chainId\", \"block_hash\", \"block_timestamp\", \"block_number\", \"transaction_hash\", \"transaction_sender\", \"transaction_function_name\", \"owners\") values ('0000000000000000000000000000000000000add', '<CHAIN>', '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08', '2018-09-16 18:28:52.607875 UTC', '123', '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59', '0000000000000000000000000000000000000add', 'constructor', '[{\"hash\":\"Owner_hash_181999847806006\",\"number\":\"18199984780605\"}]') ;",
          "insert into \"history@Vehicle.constructor\" (\"address\", \"chainId\", \"block_hash\", \"block_timestamp\", \"block_number\", \"transaction_hash\", \"transaction_sender\") values ('0000000000000000000000000000000000000add', '<CHAIN>', '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08', '2018-09-16 18:28:52.607875 UTC', '123', '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59', '0000000000000000000000000000000000000add') ;",
          "insert into \"Vehicle\" (\"address\", \"chainId\", \"block_hash\", \"block_timestamp\", \"block_number\", \"transaction_hash\", \"transaction_sender\", \"transaction_function_name\", \"owners\") values ('0000000000000000000000000000000000000add', '<CHAIN>', '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08', '2018-09-16 18:28:52.607875 UTC', '123', '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59', '0000000000000000000000000000000000000add', 'constructor', '[{\"hash\":\"Owner_hash_181999847806006\",\"number\":\"18199984780605\"}]') on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\", block_hash = excluded.block_hash, block_timestamp = excluded.block_timestamp, block_number = excluded.block_number, transaction_hash = excluded.transaction_hash, transaction_sender = excluded.transaction_sender, transaction_function_name = excluded.transaction_function_name, \"owners\" = excluded.\"owners\";"]
