{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell   #-}

module OutputDataSpec where

import Conduit
import qualified Data.ByteString as B
import qualified Data.IntMap as I
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Time
import Numeric
import Test.Hspec
import Text.RawString.QQ

import BlockApps.Ethereum --(Keccak256, Address)
import qualified BlockApps.Solidity.Value as V
import Blockchain.Strato.Model.SHA (hash)
import Slipstream.Events
import Slipstream.Globals
import Slipstream.GlobalsColdStorage (fakeHandle)
import Slipstream.OutputData
import Slipstream.SolidityValue

addr :: Address -> V.Value
addr = V.SimpleValue . V.ValueAddress

bool :: Bool -> V.Value
bool = V.SimpleValue . V.ValueBool

bytes :: B.ByteString -> V.Value
bytes = V.SimpleValue . V.valueBytes

int :: Integer -> V.Value
int = V.SimpleValue . V.valueInt

spec :: Spec
spec = do

  it "should be able to process array sentinels" $ do
    valueToSolidityValue (V.ValueArrayDynamic $ I.singleton 2 (V.ValueArraySentinel 2))
      `shouldBe` SolidityArray [SolidityNum 0, SolidityNum 0]

  describe "Array serialization" $ do
    it "should create JSON entries" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input = [ProcessedContract {
            address = testAdd,
            codehash = EVMCode $ hash "<CODEHASH>",
            abi = "<ABI>",
            contractName = "Vehicle",
            chain = "<CHAIN>",
            blockHash = hash "<BLOCKHASH>",
            blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
            blockNumber = 123,
            transactionHash = hash "<TRANSACTIONHASH>",
            transactionSender = testAdd,
            functionCallData = Nothing,
            contractData = M.singleton "owners" . V.ValueArrayDynamic . I.fromList $ zip [0..] [
                V.ValueStruct $ M.fromList [
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
          cHash = EVMCode $ hash "<CODEHASH>"
      let input = [ProcessedContract {
             address = testAdd,
             codehash = cHash,
             abi = "<ABI>",
             contractName = "Vehicle",
             chain = "<CHAIN>",
             blockHash = hash "<BLOCKHASH>",
             blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
             blockNumber = 123,
             transactionHash = hash "<TRANSACTIONHASH>",
             transactionSender = testAdd,
             functionCallData = Nothing,
             contractData = M.singleton "owners" . V.ValueArrayDynamic . I.fromList $ zip [0..] [
                V.ValueStruct $ M.fromList [
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
            codehash = EVMCode $ hash "<CODEHASH>",
            abi = "<ABI>",
            contractName = "\"Vehicle''",
            chain = "<CHAIN>",
            blockHash = hash "<BLOCKHASH>",
            blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
            blockNumber = 123,
            transactionHash = hash "<TRANSACTIONHASH>",
            transactionSender = testAdd,
            functionCallData = Nothing,
            contractData = M.singleton "\"owners\"" . V.ValueArrayDynamic . I.fromList $ zip [0..] [
                V.ValueStruct $ M.fromList [
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

  it "can unparse all solidvm value types" $ do
    let testAdd = Address 0x98eaddede
        input = [ProcessedContract {
          address = testAdd,
          codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
          abi = "<ABI>",
          contractName = "SwissArmy",
          chain = "<CHAIN>",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 123,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          functionCallData = Nothing,
          contractData = M.fromList
            [ ("addr", addr 0xdeadbeef)
            , ("boolean", bool True)
            , ("contract", V.ValueContract 0x999)
            , ("number", int 77714314)
            , ("str", bytes "Hello, World!")
            , ("enum_val", V.ValueEnum "E" "C" 0x234)
            , ("array_nums", V.ValueArrayDynamic . I.fromList
                $ zip [1..] [int 20, int 40, int 77, V.ValueArraySentinel 5])
            , ("strukt", V.ValueStruct $ M.fromList
                [ ("first_field", int 887)
                , ("second_field", bytes "CLOROX DISINFECTING WIPES")
                ])
            , ("set", V.ValueMapping $ M.fromList
                [ (V.valueInt 22, bool True)
                , (V.valueInt 23, bool True)
                , (V.valueInt 46, bool True)
                ])
            ]
          }]

    g <- newGlobals fakeHandle
    [contractInsert, swissArmyCreate, swissArmyInsert] <- runConduit (createInserts g input .| sinkList)

    contractInsert `shouldBe` [r|INSERT INTO contract ("codeHash", contract, abi, "chainId")
  VALUES ('dd993a7bf0018419be434b8232c93936b65b1ebf663006e2f906c333427b1402',
    'SwissArmy',
    '<ABI>',
    '<CHAIN>')
  ON CONFLICT DO NOTHING;|]

    swissArmyCreate `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    transaction_function_name text,
    "addr" text,
    "array_nums" jsonb,
    "boolean" bool,
    "contract" text,
    "enum_val" text,
    "number" bigint,
    "set" jsonb,
    "str" text,
    "strukt" jsonb,
  CONSTRAINT "SwissArmy_pkey"
  PRIMARY KEY (address, "chainId") );|]

    swissArmyInsert `shouldBe` [r|INSERT INTO "SwissArmy" ("address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "transaction_function_name",
    "addr",
    "array_nums",
    "boolean",
    "contract",
    "enum_val",
    "number",
    "set",
    "str",
    "strukt")
  VALUES ('000000000000000000000000000000098eaddede',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    '',
    '00000000000000000000000000000000deadbeef',
    '["0","20","40","77","0"]',
    'True',
    '0000000000000000000000000000000000000999',
    '564',
    '77714314',
    '[["22",true],["23",true],["46",true]]',
    'Hello, World!',
    '[["first_field","887"],["second_field","CLOROX DISINFECTING WIPES"]]')
  ON CONFLICT (address, "chainId") DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    transaction_function_name = excluded.transaction_function_name,
    "addr" = excluded."addr",
    "array_nums" = excluded."array_nums",
    "boolean" = excluded."boolean",
    "contract" = excluded."contract",
    "enum_val" = excluded."enum_val",
    "number" = excluded."number",
    "set" = excluded."set",
    "str" = excluded."str",
    "strukt" = excluded."strukt";|]

  it "can createInserts an empty array" $ do
    let testAdd = Address 0x22222222
        input = [ProcessedContract {
          address = testAdd,
          codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
          abi = "<ABI>",
          contractName = "SwissArmy",
          chain = "<CHAIN>",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 146,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          functionCallData = Nothing,
          contractData = M.singleton "array_nums" . V.ValueArrayDynamic
                       . I.singleton 1 $ V.ValueArraySentinel 1
          }]
    g <- newGlobals fakeHandle

    [_, swissArmyCreate, swissArmyInsert] <- runConduit (createInserts g input .| sinkList)

    T.unpack swissArmyCreate `shouldContain` "\"array_nums\" jsonb,"
    T.unpack swissArmyInsert `shouldContain` [r|'["0"]')|]

  it "can createInsertsIndexTable an empty array" $ do
    let testAdd = Address 0x22222222
        input = [ProcessedContract {
          address = testAdd,
          codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
          abi = "<ABI>",
          contractName = "SwissArmy",
          chain = "<CHAIN>",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 146,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          functionCallData = Nothing,
          contractData = M.fromList [ ("isIterable", bool False)
                                    , ("keyMap", V.ValueMapping $ M.fromList [
                                          (V.valueBytes "4517546854860", int 1)])
                                    , ("keys", V.ValueArraySentinel 1)
                                    , ("owner", V.SimpleValue $ V.ValueAddress
                                                  0xf5c1df0fd1015bb6ed5c966ad58a0f66af59b130)
                                    , ("values", V.ValueArrayDynamic . I.singleton 1
                                                  . V.ValueArraySentinel $ 1)
                                    ]
          }]
    g <- newGlobals fakeHandle

    cs <- runConduit (createInsertIndexTable g input .| sinkList)
    cs `shouldNotBe` []
