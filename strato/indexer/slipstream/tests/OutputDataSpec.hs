{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell   #-}

module OutputDataSpec where

import Conduit
import Control.Monad
import qualified Data.ByteString as B
import qualified Data.IntMap as I
import qualified Data.Map as M
import Data.Text (Text)
--import qualified Data.Text as T
import Data.Time
import Numeric
import Test.Hspec
import Text.RawString.QQ
import UnliftIO.IORef

import BlockApps.Logging
import qualified BlockApps.Solidity.Value as V
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256 (hash)
import Slipstream.Events
import Slipstream.Globals
import Slipstream.GlobalsColdStorage (fakeHandle)
import Slipstream.OutputData
import Slipstream.SolidityValue
-- import Slipstream.Processor

import SolidVM.Model.CodeCollection hiding (contractName, contracts)
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType

addr :: Address -> V.Value
addr = V.SimpleValue . V.ValueAccount . unspecifiedChain

bool :: Bool -> V.Value
bool = V.SimpleValue . V.ValueBool

bytes :: B.ByteString -> V.Value
bytes = V.SimpleValue . V.valueBytes

int :: Integer -> V.Value
int = V.SimpleValue . V.valueInt


createInserts :: OutputM m
              => IORef Globals
              -> [(ProcessedContract, Contract)]
              -> ConduitM () Text m ()
createInserts globalsIORef contracts = do
  unless (null contracts) $ do
    let contract = head contracts
    _ <- createIndexTable globalsIORef (snd contract) (organization $ fst contract, application $ fst contract, contractName $ fst contract)
    createHistoryTable globalsIORef (snd contract) (organization $ fst contract, application $ fst contract, contractName $ fst contract)
    insertIndexTable $ map fst contracts
    insertHistoryTable $ map fst contracts


-- createMappings :: OutputM m
--               => IORef Globals
--               -> [ProcessedMappingRow]
--               -> ConduitM () Text m ()
-- createMappings globalsIORef mappings = do
--   unless (null mappings) $ do
--     let mapping = head mappings
--     createMappingTable globalsIORef (m_organization mapping, m_application mapping, m_contractName mapping) (m_mapName mapping)
--     insertMappingTable $ mappings


spec :: Spec
spec = do

  it "should be able to process array sentinels" $ do
    valueToSolidityValue (V.ValueArrayDynamic $ I.singleton 2 (V.ValueArraySentinel 2))
      `shouldBe` SolidityArray [SolidityNum 0, SolidityNum 0]

  describe "Array serialization" $ do
    it "should create JSON entries" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input = [(ProcessedContract {
            address = testAdd,
            codehash = SolidVMCode "Vehicle" $ hash "<CODEHASH>",
            organization = "",
            application = "",
            contractName = "Vehicle",
            chain = "<CHAIN>",
            blockHash = hash "<BLOCKHASH>",
            blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
            blockNumber = 123,
            transactionHash = hash "<TRANSACTIONHASH>",
            transactionSender = testAdd,
            contractData = M.singleton "owners" . V.ValueArrayDynamic $ V.tosparse [
                V.ValueStruct $ M.fromList [
                  ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")]]
            }, createDummyContract [
                  ("owners", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                  ])]

      g <- newGlobals M.empty fakeHandle
      [vehicleCreate, _ , _, _, vehicleInsert, _] <- runLoggingT . runConduit $ createInserts g input .| sinkList
      
      vehicleCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "Vehicle" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
  PRIMARY KEY (record_id) );|]

      vehicleInsert `shouldBe`
          [r|INSERT INTO "Vehicle" ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender")
  VALUES ('0000000000000000000000000000000000000add:<CHAIN>',
    '0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add')
  ON CONFLICT (record_id) DO UPDATE SET
    record_id = excluded.record_id,
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender;|]

  describe "Array serialization with history enabled" $ do
    it "should create JSON entries" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
          cHash = SolidVMCode "Vehicle2" $ hash "<CODEHASH>"
      let input = [(ProcessedContract {
             address = testAdd,
             codehash = cHash,
             organization = "",
             application = "",
             contractName = "Vehicle2",
             chain = "<CHAIN>",
             blockHash = hash "<BLOCKHASH>",
             blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
             blockNumber = 123,
             transactionHash = hash "<TRANSACTIONHASH>",
             transactionSender = testAdd,
             contractData = M.singleton "owners" . V.ValueArrayDynamic $ V.tosparse [
                V.ValueStruct $ M.fromList [
                  ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")]]
            }, createDummyContract [
                  ("owners", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                  ])]
      g <- newGlobals M.empty fakeHandle

      [vehicleCreate, historyCreate, historyIndex, historyAlter, vehicleInsert, historyInsert]
        <- runLoggingT . runConduit $ createInserts g input .| sinkList

      vehicleCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "Vehicle2" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
  PRIMARY KEY (record_id) );|]

      historyCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "history@Vehicle2" (record_id text,
    address text NOT NULL,
    "chainId" text NOT NULL,
    block_hash text NOT NULL,
    block_timestamp text,
    block_number text,
    transaction_hash text NOT NULL,
    transaction_sender text);|]

      historyIndex `shouldBe`
          [r|CREATE UNIQUE INDEX IF NOT EXISTS "index_history@Vehicle2"
  ON "history@Vehicle2" (address, "chainId", block_hash, transaction_hash);|]
      historyAlter `shouldBe` 
          [r|ALTER TABLE "history@Vehicle2" ADD PRIMARY KEY USING INDEX "index_history@Vehicle2";|]

      vehicleInsert `shouldBe`
          [r|INSERT INTO "Vehicle2" ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender")
  VALUES ('0000000000000000000000000000000000000add:<CHAIN>',
    '0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add')
  ON CONFLICT (record_id) DO UPDATE SET
    record_id = excluded.record_id,
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender;|]

      historyInsert `shouldBe`
          [r|INSERT INTO "history@Vehicle2" ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender")
  VALUES ('0000000000000000000000000000000000000add:<CHAIN>',
    '0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add')
  ON CONFLICT DO NOTHING;|]

  describe "String escaping" $ do
    it "should create JSON entries with quotes escaped" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input = [(ProcessedContract {
            address = testAdd,
            codehash = SolidVMCode "\"Vehicle''" $ hash "<CODEHASH>",
            organization = "",
            application = "",
            contractName = "\"Vehicle''",
            chain = "<CHAIN>",
            blockHash = hash "<BLOCKHASH>",
            blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
            blockNumber = 123,
            transactionHash = hash "<TRANSACTIONHASH>",
            transactionSender = testAdd,
            contractData = M.singleton "\"owners\"" . V.ValueArrayDynamic $ V.tosparse [
                V.ValueStruct $ M.fromList [
                  ("number\"", V.SimpleValue $ V.valueUInt 18199984780605),
                  ("h'a\"'sh", V.SimpleValue $ V.ValueString "''Owner_hash_181999847806006")]]
            }, createDummyContract [
                       ("\"owners\"", SVMType.Array (SVMType.Struct Nothing "") Nothing)
                       ])]

      g <- newGlobals M.empty fakeHandle
      [vehicleCreate, _, _, _, vehicleInsert, _] <-
          runLoggingT . runConduit $ createInserts g input .| sinkList
      vehicleCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "\"Vehicle''''" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
  PRIMARY KEY (record_id) );|]

      vehicleInsert `shouldBe`
          [r|INSERT INTO "\"Vehicle''''" ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender")
  VALUES ('0000000000000000000000000000000000000add:<CHAIN>',
    '0000000000000000000000000000000000000add',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add')
  ON CONFLICT (record_id) DO UPDATE SET
    record_id = excluded.record_id,
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender;|]

  it "can unparse all solidvm value types" $ do
    let testAdd = Address 0x98eaddede
        input = [(ProcessedContract {
          address = testAdd,
          codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
          organization = "MyOrg",
          application = "MyApp",
          contractName = "SwissArmy",
          chain = "<CHAIN>",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 123,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          contractData = M.fromList
            [ ("addr", addr 0xdeadbeef)
            , ("boolean", bool True)
            , ("contract", V.ValueContract $ unspecifiedChain 0x999)
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
          }, createDummyContract [
                     ("addr", SVMType.Address False)
                   , ("boolean", SVMType.Bool)
                   , ("contract", SVMType.Contract "")
                   , ("number", SVMType.Int Nothing Nothing)
                   , ("str", SVMType.Bytes Nothing Nothing)
                   , ("enum_val", SVMType.Enum Nothing "" Nothing)
                   , ("array_nums", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                   , ("strukt", SVMType.Struct Nothing "")
                   , ("set", SVMType.Mapping Nothing (SVMType.Int Nothing Nothing) (SVMType.Bool))
                   ])]

    g <- newGlobals M.empty fakeHandle
    [swissArmyCreate, _, _,_, swissArmyInsert, _] <-
        runLoggingT . runConduit $ createInserts g input .| sinkList

    swissArmyCreate `shouldBe` [r|CREATE TABLE IF NOT EXISTS "MyOrg-MyApp-SwissArmy" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    "addr" text,
    "boolean" bool,
    "contract" text,
    "enum_val" text,
    "number" decimal,
    "str" text,
    "strukt" jsonb,
  PRIMARY KEY (record_id) );|]

    swissArmyInsert `shouldBe` [r|INSERT INTO "MyOrg-MyApp-SwissArmy" ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "addr",
    "boolean",
    "contract",
    "enum_val",
    "number",
    "str",
    "strukt")
  VALUES ('000000000000000000000000000000098eaddede:<CHAIN>',
    '000000000000000000000000000000098eaddede',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    '00000000000000000000000000000000deadbeef',
    'True',
    NULL,
    '564',
    '77714314',
    'Hello, World!',
    '[["first_field","887"],["second_field","CLOROX DISINFECTING WIPES"]]')
  ON CONFLICT (record_id) DO UPDATE SET
    record_id = excluded.record_id,
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    "addr" = excluded."addr",
    "boolean" = excluded."boolean",
    "contract" = excluded."contract",
    "enum_val" = excluded."enum_val",
    "number" = excluded."number",
    "str" = excluded."str",
    "strukt" = excluded."strukt";|]
{-
  it "can createInserts an empty array" $ do
    let testAdd = Address 0x22222222
        input = [(ProcessedContract {
          address = testAdd,
          codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
          organization = "MyOrg",
          application = "MyApp",
          contractName = "SwissArmy",
          chain = "<CHAIN>",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 146,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          contractData = M.singleton "array_nums" . V.ValueArrayDynamic
                       . I.singleton 1 $ V.ValueArraySentinel 1
          }, createDummyContract [
                     ("array_nums", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                     ])]
    g <- newGlobals M.empty fakeHandle

    [_, swissArmyCreate, swissArmyInsert] <-
        runLoggingT . runConduit $ createInserts g [] input .| sinkList

    T.unpack swissArmyCreate `shouldContain` "\"array_nums\" jsonb,"
    T.unpack swissArmyInsert `shouldContain` [r|'["0"]')|]
-}
  it "can createInsertsIndexTable an empty array" $ do
    let testAdd = Address 0x22222222
        input = (ProcessedContract {
                    address = testAdd,
                    codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
                    organization = "MyOrg",
                    application = "MyApp",
                    contractName = "SwissArmy",
                    chain = "<CHAIN>",
                    blockHash = hash "<BLOCKHASH>",
                    blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
                    blockNumber = 146,
                    transactionHash = hash "<TRANSACTIONHASH>",
                    transactionSender = testAdd,
                    contractData = M.fromList [ ("isIterable", bool False)
                                    , ("keyMap", V.ValueMapping $ M.fromList [
                                          (V.valueBytes "4517546854860", int 1)])
                                    , ("keys", V.ValueArraySentinel 1)
                                    , ("owner", V.SimpleValue $ V.ValueAccount $ unspecifiedChain
                                                  0xf5c1df0fd1015bb6ed5c966ad58a0f66af59b130)
                                    , ("values", V.ValueArrayDynamic . I.singleton 1
                                                  . V.ValueArraySentinel $ 1)
                                    ]
                    },
                 createDummyContract 
                 [
                   ("isIterable", SVMType.Bool),
                   ("keyMap", SVMType.Mapping Nothing (SVMType.Bytes Nothing Nothing)
                              (SVMType.Int Nothing Nothing)),
                   ("owner", (SVMType.Account False)),
                   ("values", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                 ]
                )
    g <- newGlobals M.empty fakeHandle

    (_, cs1) <- runLoggingT . runConduit $ createExpandIndexTable g (snd input) (organization $ fst input, application $ fst input, contractName $ fst input) `fuseBoth` sinkList
    cs2 <- runLoggingT . runConduit $ insertIndexTable [fst input] .| sinkList
    (cs1 ++ cs2) `shouldNotBe` []

  it "can use solidvm without application nor organization" $ do
    let testAdd = Address 0x98eaddede
        input = [(ProcessedContract {
          address = testAdd,
          codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- $ hash "<CODEHASH>",
          organization = "",
          application = "",
          contractName = "SwissArmy",
          chain = "<CHAIN>",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 123,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          contractData = M.fromList
            [ ("addr", addr 0xdeadbeef)
            , ("boolean", bool True)
            , ("contract", V.ValueContract $ unspecifiedChain 0x999)
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
          }, createDummyContract [
               ("addr", SVMType.Address False)
             , ("boolean", SVMType.Bool)
             , ("contract", SVMType.Contract "")
             , ("number", SVMType.Int Nothing Nothing)
             , ("str", SVMType.String Nothing)
             , ("enum_val", SVMType.Enum Nothing "" Nothing)
             , ("array_nums", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
             , ("strukt", SVMType.Struct Nothing "")
             , ("set", SVMType.Mapping Nothing (SVMType.Int Nothing Nothing) (SVMType.Bool))
            ])]

    g <- newGlobals M.empty fakeHandle
    [swissArmyCreate, _, _,_, swissArmyInsert, _] <-
        runLoggingT . runConduit $ createInserts g input .| sinkList

    swissArmyCreate `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    "addr" text,
    "boolean" bool,
    "contract" text,
    "enum_val" text,
    "number" decimal,
    "str" text,
    "strukt" jsonb,
  PRIMARY KEY (record_id) );|]

    swissArmyInsert `shouldBe` [r|INSERT INTO "SwissArmy" ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "addr",
    "boolean",
    "contract",
    "enum_val",
    "number",
    "str",
    "strukt")
  VALUES ('000000000000000000000000000000098eaddede:<CHAIN>',
    '000000000000000000000000000000098eaddede',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    '00000000000000000000000000000000deadbeef',
    'True',
    NULL,
    '564',
    '77714314',
    'Hello, World!',
    '[["first_field","887"],["second_field","CLOROX DISINFECTING WIPES"]]')
  ON CONFLICT (record_id) DO UPDATE SET
    record_id = excluded.record_id,
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    "addr" = excluded."addr",
    "boolean" = excluded."boolean",
    "contract" = excluded."contract",
    "enum_val" = excluded."enum_val",
    "number" = excluded."number",
    "str" = excluded."str",
    "strukt" = excluded."strukt";|]


  describe "Cirrus scrape tests" $ do
    it "uses values in non-empty cache to remember tables from before a restart" $ do
      let testAdd = Address 0x98eaddede
          input = [(ProcessedContract {
            address = testAdd,
            codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy",
            organization = "",
            application = "",
            contractName = "SwissArmy",
            chain = "<CHAIN>",
            blockHash = hash "<BLOCKHASH>",
            blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
            blockNumber = 124,
            transactionHash = hash "<TRANSACTIONHASH>",
            transactionSender = testAdd,
            contractData = M.fromList [("str", bytes "Hello, World!")]
            }, createDummyContract [("str", SVMType.String Nothing)])]
          cache = M.singleton (IndexTableName "" "" "SwissArmy") ["str"]

      g <- newGlobals cache fakeHandle

      queries <- runLoggingT . runConduit $ createInserts g input .| sinkList

      -- should not attempt to create new table
      elem [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (record_id text,
      address text,
      "chainId" text,
      block_hash text,
      block_timestamp text,
      block_number text,
      transaction_hash text,
      transaction_sender text,
      "str" text,
      PRIMARY KEY (record_id) );|] queries  `shouldNotBe` True

  -- describe "Cirrus mapping tests" $ do
    -- it "should store maps in cirrus in the right format" $ do
    --   let testAdd = Address 0x98eaddede
    --       input = [(ProcessedContract {
    --         address = testAdd,
    --         codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
    --         organization = "MyOrg",
    --         application = "MyApp",
    --         contractName = "SwissArmy",
    --         chain = "<CHAIN>",
    --         blockHash = hash "<BLOCKHASH>",
    --         blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
    --         blockNumber = 123,
    --         transactionHash = hash "<TRANSACTIONHASH>",
    --         transactionSender = testAdd,
    --         contractData = M.fromList
    --           [("set", V.ValueMapping $ M.fromList
    --               [ (V.valueInt 22, V.SimpleValue $ V.valueInt 21)
    --               , (V.valueInt 23, V.SimpleValue $ V.valueInt 21)
    --               , (V.valueInt 46, V.SimpleValue $ V.valueInt 21)
    --               ])
    --           ]
    --         }, createDummyContract [
    --                   ("set", SVMType.Mapping Nothing (SVMType.Int Nothing Nothing) (SVMType.Bool))
    --                 ])]
    --       pcs = (map fst input):: [ProcessedContract] 
    --   mappings <- concat <$> map (\pc -> processedContractToProcessedMappingRows pc ["set"]) pcs 
    --   g <- newGlobals M.empty fakeHandle
    --   [swissArmyCreate, swissArmyInsert1,_,_] <-
    --       runLoggingT . runConduit $ createMappings g mappings .| sinkList

    --   swissArmyCreate `shouldBe` [r|CREATE TABLE IF NOT EXISTS "MyOrg-MyApp-SwissArmy-set" (m_record_id text,
    --       m_address text,
    --       "m_chainId" text,
    --       m_block_hash text,
    --       m_block_timestamp text,
    --       m_block_number text,
    --       m_transaction_hash text,
    --       m_transaction_sender text,
    --       m_contractName text,
    --       m_mapName text,
    --       "key" text,
    --       "value" text,
    --       PRIMARY KEY (record_id) );|]

    --   swissArmyInsert1 `shouldBe` [r|INSERT INTO "MyOrg-MyApp-SwissArmy-set" ("m_record_id",
    --   "m_address",
    --   "m_chainId",
    --   "m_block_hash",
    --   "m_block_timestamp",
    --   "m_block_number",
    --   "m_transaction_hash",
    --   "m_transaction_sender",
    --   "m_contractName",
    --   "m_mapName",
    --   "key",
    --   "value")
    -- VALUES ('000000000000000000000000000000098eaddede:<CHAIN>',
    --   '000000000000000000000000000000098eaddede',
    --   '<CHAIN>',
    --   '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    --   '2018-09-16 18:28:52.607875 UTC',
    --   '123',
    --   '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    --   '000000000000000000000000000000098eaddede',
    --   '00000000000000000000000000000000deadbeef'
    --   'MyOrg-MyApp-SwissArmy',
    --   'set',
    --   '[22,23,46]',
    --   '[21,21,21]')
    -- ON CONFLICT (record_id) DO UPDATE SET
    --   m_record_id = excluded.m_record_id,
    --   m_address = excluded.m_address,
    --   "m_chainId" = excluded."m_chainId",
    --   m_block_hash = excluded.m_block_hash,
    --   m_block_timestamp = excluded.m_block_timestamp,
    --   m_block_number = excluded.m_block_number,
    --   m_transaction_hash = excluded.m_transaction_hash,
    --   m_ transaction_sender = excluded.m_transaction_sender;
    --   m_contractName = excluded.m_contractName,
    --   m_mapName = excluded.m_mapName,
    --   "key" = excluded."key",
    --   "value" = excluded."value",
    --   |]



createDummyContract :: [(Text, SVMType.Type)] -> Contract
createDummyContract v = 
  let createVariableDecl t = VariableDecl{
        _varType=t,
        _varIsPublic=True,
        _varInitialVal=Nothing,
        _varContext=error "varContext undefined",
        _isImmutable = False,
        _isRecord = True
        }
  in
    Contract{
      _contractName=undefined,
      _parents=undefined,
      _constants=undefined,
      _userDefined=undefined,
      _storageDefs=M.mapKeys textToLabel $ M.fromList $ map (fmap createVariableDecl) v,
      _enums=undefined,
      _structs=undefined,
      _errors=undefined,
      _events=undefined,
      _functions=undefined,
      _constructor=undefined,
      _modifiers=undefined,
      _contractContext=undefined
    }
