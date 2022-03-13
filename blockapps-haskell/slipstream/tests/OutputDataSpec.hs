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

import SolidVM.Model.CodeCollection hiding (contractName, contracts)
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
              -> [Text]
              -> [(ProcessedContract, Contract)]
              -> ConduitM () Text m ()
createInserts globalsIORef historyList' contracts = do
  unless (null contracts) $ do
    let contract = head contracts
        hasHistory = contractName (fst contract) `elem` historyList'
    _ <- createIndexTable globalsIORef (snd contract) (organization $ fst contract, application $ fst contract, contractName $ fst contract)
    when hasHistory $ createHistoryTable globalsIORef (snd contract) (organization $ fst contract, application $ fst contract, contractName $ fst contract)
    insertIndexTable $ map fst contracts
    insertHistoryTable globalsIORef $ map fst contracts



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

      g <- newGlobals fakeHandle
      [vehicleCreate, vehicleInsert] <- runLoggingT . runConduit $ createInserts g [] input .| sinkList
      
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
          cHash = SolidVMCode "Vehicle" $ hash "<CODEHASH>"
      let input = [(ProcessedContract {
             address = testAdd,
             codehash = cHash,
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
      g <- newGlobals fakeHandle
      runLoggingT $ addAndEnableHistoryTable g (HistoryTableName "" "" "Vehicle")
      let hl = ["Vehicle"]

      [vehicleCreate, historyCreate, historyIndex, vehicleInsert, historyInsert]
        <- runLoggingT . runConduit $ createInserts g hl input .| sinkList

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

      historyCreate `shouldBe`
          [r|CREATE TABLE IF NOT EXISTS "history@Vehicle" (record_id text,
    address text NOT NULL,
    "chainId" text NOT NULL,
    block_hash text NOT NULL,
    block_timestamp text,
    block_number text,
    transaction_hash text NOT NULL,
    transaction_sender text);|]

      historyIndex `shouldBe`
          [r|CREATE UNIQUE INDEX IF NOT EXISTS "index_history@Vehicle"
  ON "history@Vehicle" (address, "chainId", block_hash, transaction_hash);
ALTER TABLE "history@Vehicle" ADD PRIMARY KEY USING INDEX "index_history@Vehicle";|]

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

      historyInsert `shouldBe`
          [r|INSERT INTO "history@Vehicle" ("record_id",
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

      g <- newGlobals fakeHandle
      [vehicleCreate, vehicleInsert] <-
          runLoggingT . runConduit $ createInserts g [] input .| sinkList

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
                     ("addr", SVMType.Address)
                   , ("boolean", SVMType.Bool)
                   , ("contract", SVMType.Contract "")
                   , ("number", SVMType.Int Nothing Nothing)
                   , ("str", SVMType.Bytes Nothing Nothing)
                   , ("enum_val", SVMType.Enum Nothing "" Nothing)
                   , ("array_nums", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                   , ("strukt", SVMType.Struct Nothing "")
                   , ("set", SVMType.Mapping Nothing (SVMType.Int Nothing Nothing) (SVMType.Bool))
                   ])]

    g <- newGlobals fakeHandle
    [swissArmyCreate, swissArmyInsert] <-
        runLoggingT . runConduit $ createInserts g [] input .| sinkList

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
    g <- newGlobals fakeHandle

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
                   ("owner", SVMType.Account),
                   ("values", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                 ]
                )
    g <- newGlobals fakeHandle

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
               ("addr", SVMType.Address)
             , ("boolean", SVMType.Bool)
             , ("contract", SVMType.Contract "")
             , ("number", SVMType.Int Nothing Nothing)
             , ("str", SVMType.String Nothing)
             , ("enum_val", SVMType.Enum Nothing "" Nothing)
             , ("array_nums", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
             , ("strukt", SVMType.Struct Nothing "")
             , ("set", SVMType.Mapping Nothing (SVMType.Int Nothing Nothing) (SVMType.Bool))
            ])]

    g <- newGlobals fakeHandle
    [swissArmyCreate, swissArmyInsert] <-
        runLoggingT . runConduit $ createInserts g [] input .| sinkList

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




createDummyContract :: [(Text, SVMType.Type)] -> Contract
createDummyContract v = 
  let createVariableDecl t = VariableDecl{
        varType=t,
        varIsPublic=True,
        varInitialVal=Nothing,
        varContext=error "varContext undefined"
        }
  in
    Contract{
      _contractName=undefined,
      _parents=undefined,
      _constants=undefined,
      _storageDefs=M.fromList $ map (fmap createVariableDecl) v,
      _enums=undefined,
      _structs=undefined,
      _events=undefined,
      _functions=undefined,
      _constructor=undefined,
      _vmVersion=undefined,
      _contractContext=undefined
    }
