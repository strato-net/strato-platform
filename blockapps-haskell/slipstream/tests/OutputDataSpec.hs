{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell   #-}

module OutputDataSpec where

import Conduit
import qualified Data.Map as M
import Data.Time
import Numeric
import Test.Hspec
import Text.RawString.QQ

import BlockApps.Ethereum --(Keccak256, Address)
import qualified BlockApps.Solidity.Value as V

import Slipstream.Events
import Slipstream.Globals
import Slipstream.GlobalsColdStorage (fakeHandle)
import Slipstream.OutputData

spec :: Spec
spec = do

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
            functionCallData = Nothing,
            contractData = M.singleton "owners" $ V.ValueArrayDynamic [
                V.ValueStruct [
                  ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")]]
            }]

      g <- newGlobals fakeHandle
      [contractInsert, vehicleCreate, vehicleInsert] <- runConduit (createInserts g input .| sinkList)

      contractInsert `shouldBe`
          [r|INSERT INTO contract ("codeHash", contract, abi, "chainId")
  VALUES ('dd993a7bf0018419be434b8232c93936b65b1ebf663006e2f906c333427b1402',
    'Vehicle',
    '<ABI>',
    '<CHAIN>')
  ON CONFLICT DO NOTHING;|]

      vehicleCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "Vehicle" (address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    transaction_function_name text,
    "owners" jsonb,
  CONSTRAINT "Vehicle_pkey"
  PRIMARY KEY (address, "chainId") );|]

      vehicleInsert `shouldBe`
          [r|INSERT INTO "Vehicle" ("address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "transaction_function_name",
    "owners")
  VALUES ('0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add',
    '',
    '[{"hash":"Owner_hash_181999847806006","number":"18199984780605"}]')
  ON CONFLICT (address, "chainId") DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    transaction_function_name = excluded.transaction_function_name,
    "owners" = excluded."owners";|]


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
             functionCallData = Nothing,
             contractData = M.singleton "owners" $ V.ValueArrayDynamic [
                V.ValueStruct [
                  ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")]]
            }]
      g <- newGlobals fakeHandle
      addToHistoryList g cHash
      [contractInsert, vehicleCreate, historyCreate, vehicleInsert, historyInsert]
        <- runConduit (createInserts g input .| sinkList)

      contractInsert `shouldBe`
          [r|INSERT INTO contract ("codeHash", contract, abi, "chainId")
  VALUES ('dd993a7bf0018419be434b8232c93936b65b1ebf663006e2f906c333427b1402',
    'Vehicle',
    '<ABI>',
    '<CHAIN>')
  ON CONFLICT DO NOTHING;|]

      vehicleCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "Vehicle" (address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    transaction_function_name text,
    "owners" jsonb,
  CONSTRAINT "Vehicle_pkey"
  PRIMARY KEY (address, "chainId") );|]

      historyCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "history@Vehicle" (address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    transaction_function_name text,
    "owners" jsonb);|]

      vehicleInsert `shouldBe`
          [r|INSERT INTO "Vehicle" ("address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "transaction_function_name",
    "owners")
  VALUES ('0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add',
    '',
    '[{"hash":"Owner_hash_181999847806006","number":"18199984780605"}]')
  ON CONFLICT (address, "chainId") DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    transaction_function_name = excluded.transaction_function_name,
    "owners" = excluded."owners";|]

      historyInsert `shouldBe`
          [r|INSERT INTO "history@Vehicle" ("address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "transaction_function_name",
    "owners")
  VALUES ('0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add',
    '',
    '[{"hash":"Owner_hash_181999847806006","number":"18199984780605"}]');|]

  describe "String escaping" $ do
    it "should create JSON entries with quotes escaped" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input = [ProcessedContract {
            address = testAdd,
            codehash = keccak256 "<CODEHASH>",
            abi = "<ABI>",
            contractName = "\"Vehicle''",
            chain = "<CHAIN>",
            blockHash = keccak256 "<BLOCKHASH>",
            blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
            blockNumber = 123,
            transactionHash = keccak256 "<TRANSACTIONHASH>",
            transactionSender = testAdd,
            functionCallData = Nothing,
            contractData = M.singleton "\"owners\"" $ V.ValueArrayDynamic [
                V.ValueStruct [
                  ("number\"", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("h'a\"'sh", V.SimpleValue $ V.ValueString "''Owner_hash_181999847806006")]]
            }]

      g <- newGlobals fakeHandle
      [contractInsert, vehicleCreate, vehicleInsert] <- runConduit (createInserts g input .| sinkList)

      contractInsert `shouldBe`
          [r|INSERT INTO contract ("codeHash", contract, abi, "chainId")
  VALUES ('dd993a7bf0018419be434b8232c93936b65b1ebf663006e2f906c333427b1402',
    '\"Vehicle''''',
    '<ABI>',
    '<CHAIN>')
  ON CONFLICT DO NOTHING;|]

      vehicleCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "\"Vehicle''''" (address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    transaction_function_name text,
    "\"owners\"" jsonb,
  CONSTRAINT "\"Vehicle''''_pkey"
  PRIMARY KEY (address, "chainId") );|]

      vehicleInsert `shouldBe`
          [r|INSERT INTO "\"Vehicle''''" ("address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "transaction_function_name",
    "\"owners\"")
  VALUES ('0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add',
    '',
    '[{"h''a\"''sh":"''''Owner_hash_181999847806006","number\"":"18199984780605"}]')
  ON CONFLICT (address, "chainId") DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    transaction_function_name = excluded.transaction_function_name,
    "\"owners\"" = excluded."\"owners\"";|]
