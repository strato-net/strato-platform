{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module OutputDataSpec where

import Conduit
import Control.Monad
import           Control.Monad.Change.Alter
import qualified Data.ByteString as B
import qualified Data.IntMap as I
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Time
import Data.Default
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
import qualified Slipstream.Events as SE
import Slipstream.Globals
import Slipstream.GlobalsColdStorage (fakeHandle)
import Slipstream.OutputData
import Slipstream.SolidityValue

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


createInserts ::( OutputM m,
    Selectable Account AddressState m,
    Selectable Word256 ParentChainIds m,
    Selectable HS.StorageFilterParams [HS.StorageAddress] m)
              => IORef Globals
              -> [(SE.ProcessedContract, Contract)]
              -> ConduitM () T.Text m ()
createInserts globalsIORef contracts = do
  unless (null contracts) $ do
    let contract = head contracts
    _ <- createIndexTable globalsIORef (snd contract) (SE.organization $ fst contract, SE.application $ fst contract, SE.contractName $ fst contract) def
    createHistoryTable globalsIORef (snd contract) (SE.organization $ fst contract, SE.application $ fst contract, SE.contractName $ fst contract)
    insertIndexTable $ map fst contracts
    insertHistoryTable $ map fst contracts

createInsertsMapping :: ( OutputM m,
    Selectable Account AddressState m,
    Selectable Word256 ParentChainIds m,
    Selectable HS.StorageFilterParams [HS.StorageAddress] m)
              => IORef Globals
              -> [ProcessedMappingRow]
              -> ConduitM () T.Text m ()
createInsertsMapping globalsIORef mappings = do
  unless (null mappings) $ do
    let mapping = head mappings
    _ <- createMappingTable globalsIORef (organization mapping, application mapping, contractname mapping) (mapname mapping)
    insertMappingTable mappings

createInsertsAbstract :: OutputM m
              => IORef Globals
              -> (SE.ProcessedContract, Contract)
              -> [(SE.ProcessedContract, T.Text, TableColumns)]
              -> ConduitM () T.Text m ()
createInsertsAbstract globalsIORef abstract inherited = do
    let contract =snd abstract
    _ <- createAbstractTable globalsIORef (contract) (SE.organization $ fst abstract, SE.application $ fst abstract, SE.contractName $ fst abstract) def
    unless (null inherited) $ do 
      insertAbstractTable inherited

createDummyContract :: [(T.Text, SVMType.Type)] -> Contract
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
      _usings=undefined,
      _contractType=undefined,
      _importedFrom=undefined,
      _contractContext=undefined
    }

fakeCirrusHandle :: CirrusHandle
fakeCirrusHandle = FakeCirrusHandle

spec :: Spec
spec = do
  it "should be able to process array sentinels" $ do
    valueToSolidityValue (V.ValueArrayDynamic $ I.singleton 2 (V.ValueArraySentinel 2))
      `shouldBe` SolidityArray [SolidityNum 0, SolidityNum 0]

  describe "Array serialization" $ do
    it "should create JSON entries" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input =
            [ ( SE.ProcessedContract
                  { SE.address = testAdd,
                    SE.codehash = SolidVMCode "Vehicle" $ hash "<CODEHASH>",
                    SE.organization = "",
                    SE.application = "",
                    SE.contractName = "Vehicle",
                    SE.chain = "<CHAIN>",
                    SE.blockHash = hash "<BLOCKHASH>",
                    SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC") :: UTCTime,
                    SE.blockNumber = 123,
                    SE.transactionHash = hash "<TRANSACTIONHASH>",
                    SE.transactionSender = testAdd,
                    SE.contractData =
                      M.singleton "owners" . V.ValueArrayDynamic $
                        V.tosparse
                          [ V.ValueStruct $
                              M.fromList
                                [ ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")
                                ]
                          ]
                  },
                createDummyContract
                  [ ("owners", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                  ]
              )
            ]

      g <- newGlobals fakeHandle fakeCirrusHandle
      [vehicleCreate, _, _, _, vehicleInsert, _] <- runLoggingT . runConduit $ createInserts g input .| sinkList

      vehicleCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "Vehicle" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
  PRIMARY KEY (record_id) );|]

      vehicleInsert
        `shouldBe` [r|INSERT INTO "Vehicle" ("record_id",
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
      let input =
            [ ( SE.ProcessedContract
                  { SE.address = testAdd,
                    SE.codehash = cHash,
                    SE.organization = "",
                    SE.application = "",
                    SE.contractName = "Vehicle2",
                    SE.chain = "<CHAIN>",
                    SE.blockHash = hash "<BLOCKHASH>",
                    SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC") :: UTCTime,
                    SE.blockNumber = 123,
                    SE.transactionHash = hash "<TRANSACTIONHASH>",
                    SE.transactionSender = testAdd,
                    SE.contractData =
                      M.singleton "owners" . V.ValueArrayDynamic $
                        V.tosparse
                          [ V.ValueStruct $
                              M.fromList
                                [ ("number", V.SimpleValue $ V.valueUInt 18199984780605),
                                  ("hash", V.SimpleValue $ V.ValueString "Owner_hash_181999847806006")
                                ]
                          ]
                  },
                createDummyContract
                  [ ("owners", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
                  ]
              )
            ]
      g <- newGlobals fakeHandle fakeCirrusHandle

      [vehicleCreate, historyCreate, historyIndex, historyAlter, vehicleInsert, historyInsert] <-
        runLoggingT . runConduit $ createInserts g input .| sinkList

      vehicleCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "Vehicle2" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
  PRIMARY KEY (record_id) );|]

      historyCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "history@Vehicle2" (record_id text,
    address text NOT NULL,
    "chainId" text NOT NULL,
    block_hash text NOT NULL,
    block_timestamp text,
    block_number text,
    transaction_hash text NOT NULL,
    transaction_sender text);|]

      historyIndex
        `shouldBe` [r|CREATE UNIQUE INDEX IF NOT EXISTS "index_history@Vehicle2"
  ON "history@Vehicle2" (address, "chainId", block_hash, transaction_hash);|]
      historyAlter
        `shouldBe` [r|ALTER TABLE "history@Vehicle2" ADD PRIMARY KEY USING INDEX "index_history@Vehicle2";|]

      vehicleInsert
        `shouldBe` [r|INSERT INTO "Vehicle2" ("record_id",
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

      historyInsert
        `shouldBe` [r|INSERT INTO "history@Vehicle2" ("record_id",
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
      let input =
            [ ( SE.ProcessedContract
                  { SE.address = testAdd,
                    SE.codehash = SolidVMCode "\"Vehicle''" $ hash "<CODEHASH>",
                    SE.organization = "",
                    SE.application = "",
                    SE.contractName = "\"Vehicle''",
                    SE.chain = "<CHAIN>",
                    SE.blockHash = hash "<BLOCKHASH>",
                    SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC") :: UTCTime,
                    SE.blockNumber = 123,
                    SE.transactionHash = hash "<TRANSACTIONHASH>",
                    SE.transactionSender = testAdd,
                    SE.contractData =
                      M.singleton "\"owners\"" . V.ValueArrayDynamic $
                        V.tosparse
                          [ V.ValueStruct $
                              M.fromList
                                [ ("number\"", V.SimpleValue $ V.valueUInt 18199984780605),
                                  ("h'a\"'sh", V.SimpleValue $ V.ValueString "''Owner_hash_181999847806006")
                                ]
                          ]
                  },
                createDummyContract
                  [ ("\"owners\"", SVMType.Array (SVMType.Struct Nothing "") Nothing)
                  ]
              )
            ]

      g <- newGlobals fakeHandle fakeCirrusHandle
      [vehicleCreate, _, _, _, vehicleInsert, _] <-
        runLoggingT . runConduit $ createInserts g input .| sinkList
      vehicleCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "\"Vehicle''''" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
  PRIMARY KEY (record_id) );|]

      vehicleInsert
        `shouldBe` [r|INSERT INTO "\"Vehicle''''" ("record_id",
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
        input =
          [ ( SE.ProcessedContract
                { SE.address = testAdd,
                  SE.codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
                  SE.organization = "MyOrg",
                  SE.application = "MyApp",
                  SE.contractName = "SwissArmy",
                  SE.chain = "<CHAIN>",
                  SE.blockHash = hash "<BLOCKHASH>",
                  SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC") :: UTCTime,
                  SE.blockNumber = 123,
                  SE.transactionHash = hash "<TRANSACTIONHASH>",
                  SE.transactionSender = testAdd,
                  SE.contractData =
                    M.fromList
                      [ ("addr", addr 0xdeadbeef),
                        ("boolean", bool True),
                        ("contract", V.ValueContract $ unspecifiedChain 0x999),
                        ("number", int 77714314),
                        ("str", bytes "Hello, World!"),
                        ("enum_val", V.ValueEnum "E" "C" 0x234),
                        ( "array_nums",
                          V.ValueArrayDynamic . I.fromList $
                            zip [1 ..] [int 20, int 40, int 77, V.ValueArraySentinel 5]
                        ),
                        ( "strukt",
                          V.ValueStruct $
                            M.fromList
                              [ ("first_field", int 887),
                                ("second_field", bytes "CLOROX DISINFECTING WIPES")
                              ]
                        ),
                        ( "set",
                          V.ValueMapping $
                            M.fromList
                              [ (V.valueInt 22, bool True),
                                (V.valueInt 23, bool True),
                                (V.valueInt 46, bool True)
                              ]
                        )
                      ]
                },
              createDummyContract
                [ ("addr", SVMType.Address False),
                  ("boolean", SVMType.Bool),
                  ("contract", SVMType.Contract ""),
                  ("number", SVMType.Int Nothing Nothing),
                  ("str", SVMType.Bytes Nothing Nothing),
                  ("enum_val", SVMType.Enum Nothing "" Nothing),
                  ("array_nums", SVMType.Array (SVMType.Int Nothing Nothing) Nothing),
                  ("strukt", SVMType.Struct Nothing ""),
                  ("set", SVMType.Mapping Nothing (SVMType.Int Nothing Nothing) (SVMType.Bool))
                ]
            )
          ]

    g <- newGlobals fakeHandle fakeCirrusHandle
    [swissArmyCreate, _, _, _, swissArmyInsert, _] <-
      runLoggingT . runConduit $ createInserts g input .| sinkList

    swissArmyCreate
      `shouldBe` [r|CREATE TABLE IF NOT EXISTS "MyOrg-MyApp-SwissArmy" (record_id text,
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

    swissArmyInsert
      `shouldBe` [r|INSERT INTO "MyOrg-MyApp-SwissArmy" ("record_id",
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
        input =
          ( SE.ProcessedContract
              { SE.address = testAdd,
                SE.codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
                SE.organization = "MyOrg",
                SE.application = "MyApp",
                SE.contractName = "SwissArmy",
                SE.chain = "<CHAIN>",
                SE.blockHash = hash "<BLOCKHASH>",
                SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC") :: UTCTime,
                SE.blockNumber = 146,
                SE.transactionHash = hash "<TRANSACTIONHASH>",
                SE.transactionSender = testAdd,
                SE.contractData =
                  M.fromList
                    [ ("isIterable", bool False),
                      ( "keyMap",
                        V.ValueMapping $
                          M.fromList
                            [ (V.valueBytes "4517546854860", int 1)
                            ]
                      ),
                      ("keys", V.ValueArraySentinel 1),
                      ( "owner",
                        V.SimpleValue $
                          V.ValueAccount $
                            unspecifiedChain
                              0xf5c1df0fd1015bb6ed5c966ad58a0f66af59b130
                      ),
                      ( "values",
                        V.ValueArrayDynamic . I.singleton 1
                          . V.ValueArraySentinel
                          $ 1
                      )
                    ]
              },
            createDummyContract
              [ ("isIterable", SVMType.Bool),
                ( "keyMap",
                  SVMType.Mapping
                    Nothing
                    (SVMType.Bytes Nothing Nothing)
                    (SVMType.Int Nothing Nothing)
                ),
                ("owner", (SVMType.Account False)),
                ("values", SVMType.Array (SVMType.Int Nothing Nothing) Nothing)
              ]
          )
    g <- newGlobals fakeHandle fakeCirrusHandle

    (_, cs1) <- runLoggingT . runConduit $ createExpandIndexTable g (snd input) (SE.organization $ fst input, SE.application $ fst input, SE.contractName $ fst input) def `fuseBoth` sinkList
    cs2 <- runLoggingT . runConduit $ insertIndexTable [fst input] .| sinkList
    (cs1 ++ cs2) `shouldNotBe` []

  it "can use solidvm without application nor organization" $ do
    let testAdd = Address 0x98eaddede
        input =
          [ ( SE.ProcessedContract
                { SE.address = testAdd,
                  SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- hash "<CODEHASH>",
                  SE.organization = "",
                  SE.application = "",
                  SE.contractName = "SwissArmy",
                  SE.chain = "<CHAIN>",
                  SE.blockHash = hash "<BLOCKHASH>",
                  SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC") :: UTCTime,
                  SE.blockNumber = 123,
                  SE.transactionHash = hash "<TRANSACTIONHASH>",
                  SE.transactionSender = testAdd,
                  SE.contractData =
                    M.fromList
                      [ ("addr", addr 0xdeadbeef),
                        ("boolean", bool True),
                        ("contract", V.ValueContract $ unspecifiedChain 0x999),
                        ("number", int 77714314),
                        ("str", bytes "Hello, World!"),
                        ("enum_val", V.ValueEnum "E" "C" 0x234),
                        ( "array_nums",
                          V.ValueArrayDynamic . I.fromList $
                            zip [1 ..] [int 20, int 40, int 77, V.ValueArraySentinel 5]
                        ),
                        ( "strukt",
                          V.ValueStruct $
                            M.fromList
                              [ ("first_field", int 887),
                                ("second_field", bytes "CLOROX DISINFECTING WIPES")
                              ]
                        ),
                        ( "set",
                          V.ValueMapping $
                            M.fromList
                              [ (V.valueInt 22, bool True),
                                (V.valueInt 23, bool True),
                                (V.valueInt 46, bool True)
                              ]
                        )
                      ]
                },
              createDummyContract
                [ ("addr", SVMType.Address False),
                  ("boolean", SVMType.Bool),
                  ("contract", SVMType.Contract ""),
                  ("number", SVMType.Int Nothing Nothing),
                  ("str", SVMType.String Nothing),
                  ("enum_val", SVMType.Enum Nothing "" Nothing),
                  ("array_nums", SVMType.Array (SVMType.Int Nothing Nothing) Nothing),
                  ("strukt", SVMType.Struct Nothing ""),
                  ("set", SVMType.Mapping Nothing (SVMType.Int Nothing Nothing) (SVMType.Bool))
                ]
            )
          ]

    g <- newGlobals fakeHandle fakeCirrusHandle
    [swissArmyCreate, _, _, _, swissArmyInsert, _] <-
      runLoggingT . runConduit $ createInserts g input .| sinkList

    swissArmyCreate
      `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (record_id text,
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

    swissArmyInsert
      `shouldBe` [r|INSERT INTO "SwissArmy" ("record_id",
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

  it "can create and insert into mapping tables" $ do
    let testAdd = Address 0x98eaddede
        input = [ProcessedMappingRow {
          address = testAdd,
          codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- $ hash "<CODEHASH>",
          organization = "",
          application = "",
          contractname = "SwissArmy",
          mapname = "SwissArmyMapping",
          chain = "<CHAIN>",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 123,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          mapDataKey = V.SimpleValue $ V.ValueString "hi-key",
          mapDataValue = V.SimpleValue $ V.ValueString "hi-value"
          }     ]

    g <- newGlobals fakeHandle fakeCirrusHandle
    [swissArmyMappingCreate, swissArmyMappingRowInsert] <-
        runLoggingT . runConduit $ createInsertsMapping g input .| sinkList

    swissArmyMappingCreate `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy.SwissArmyMapping" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    contract_name text,
    mapname text,
    key text,
    value text,
  PRIMARY KEY (record_id, key));|]

    swissArmyMappingRowInsert `shouldBe` [r|INSERT INTO "SwissArmy.SwissArmyMapping" ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "contract_name",
    "mapname",
    "key",
    "value")
  VALUES ('000000000000000000000000000000098eaddede:<CHAIN>',
    '000000000000000000000000000000098eaddede',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    'SwissArmy',
    'SwissArmyMapping',
    'hi-key',
    'hi-value')
  ON CONFLICT (record_id, key) DO UPDATE SET
    record_id = excluded.record_id,
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    contract_name = excluded.contract_name,
    mapname = excluded.mapname,
    value = excluded.value;|]

  fit "can create and insert into abstract tables" $ do
    let testAdd = Address 0x98eaddede
        input = (SE.ProcessedContract {
          SE.address = testAdd,
          SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- $ hash "<CODEHASH>",
          SE.organization = "",
          SE.application = "",
          SE.contractName = "SwissArmy",
          SE.chain = "<CHAIN>",
          SE.blockHash = hash "<BLOCKHASH>",
          SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          SE.blockNumber = 123,
          SE.transactionHash = hash "<TRANSACTIONHASH>",
          SE.transactionSender = testAdd,
          SE.contractData = M.fromList
            [ ("addr", addr 0xdeadbeef)
            ]
          }, createDummyContract [
               ("addr", SVMType.Address False)
            ])
        inherited = [(SE.ProcessedContract {
          SE.address = testAdd,
          SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmyz", -- $ hash "<CODEHASH>",
          SE.organization = "",
          SE.application = "",
          SE.contractName = "SwissArmyz",
          SE.chain = "<CHAIN>",
          SE.blockHash = hash "<BLOCKHASH>",
          SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          SE.blockNumber = 123,
          SE.transactionHash = hash "<TRANSACTIONHASH>",
          SE.transactionSender = testAdd,
          SE.contractData = M.fromList
            [ ("addr2", addr 0xdeadbeef)
            ]
          }, T.pack "SwissArmy", tableColumns [(T.pack "addr",SVMType.Address False)])]


    g <- newGlobals fakeHandle fakeCirrusHandle
    [swissArmyCreateAbstract, swissArmynsertAbstract] <-
        runLoggingT . runConduit $ createInsertsAbstract g input inherited .| sinkList

    swissArmyCreateAbstract `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (record_id text,
    address text,
    "chainId" text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    contract_name text,
    "addr" text,
    data jsonb,
  PRIMARY KEY (record_id));|]

    swissArmynsertAbstract `shouldBe` [r|INSERT INTO SwissArmy ("record_id",
    "address",
    "chainId",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "contract_name",
    "\"addr\" text")
  VALUES ('000000000000000000000000000000098eaddede:<CHAIN>',
    '000000000000000000000000000000098eaddede',
    '<CHAIN>',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    'SwissArmyz',
    '"{\"addr2\":\"00000000000000000000000000000000deadbeef\"}"')
  ON CONFLICT (record_id) DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    contract_name = excluded.contract_name,
    data = excluded.data;|]

  -- it "can create and expand into abstract tables" $ do
  --   let testAdd = Address 0x98eaddede
  --       input = (SE.ProcessedContract {
  --         SE.address = testAdd,
  --         SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- $ hash "<CODEHASH>",
  --         SE.organization = "",
  --         SE.application = "",
  --         SE.contractName = "SwissArmy",
  --         SE.chain = "<CHAIN>",
  --         SE.blockHash = hash "<BLOCKHASH>",
  --         SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
  --         SE.blockNumber = 123,
  --         SE.transactionHash = hash "<TRANSACTIONHASH>",
  --         SE.transactionSender = testAdd,
  --         SE.contractData = M.fromList
  --           [ ("addr", addr 0xdeadbeef)
  --           ]
  --         }, createDummyContract [
  --              ("addr", SVMType.Address False)
  --           ])

  --       inherited = [(SE.ProcessedContract {
  --         SE.address = testAdd,
  --         SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmyz", -- $ hash "<CODEHASH>",
  --         SE.organization = "",
  --         SE.application = "",
  --         SE.contractName = "SwissArmyz",
  --         SE.chain = "<CHAIN>",
  --         SE.blockHash = hash "<BLOCKHASH>",
  --         SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
  --         SE.blockNumber = 123,
  --         SE.transactionHash = hash "<TRANSACTIONHASH>",
  --         SE.transactionSender = testAdd,
  --         SE.contractData = M.fromList
  --           [ ("addr2", addr 0xdeadbeef)
  --           ]
  --         }, T.pack "SwissArmy", tableColumns [(T.pack "addr",SVMType.Address False)])]

  --       expand = [(SE.ProcessedContract {
  --         SE.address = testAdd,
  --         SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- $ hash "<CODEHASH>",
  --         SE.organization = "",
  --         SE.application = "",
  --         SE.contractName = "SwissArmy",
  --         SE.chain = "<CHAIN>",
  --         SE.blockHash = hash "<BLOCKHASH>",
  --         SE.blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
  --         SE.blockNumber = 123,
  --         SE.transactionHash = hash "<TRANSACTIONHASH>",
  --         SE.transactionSender = testAdd,
  --         SE.contractData = M.fromList
  --           [ ("addr", addr 0xdeadbeef), ("addr2", addr 0xdeadbeef)
  --           ]
  --         }), createDummyContract [
  --              ("addr", SVMType.Address False),
  --              ("addr2", SVMType.Address False)
  --           ]]



  --   g <- newGlobals fakeHandle fakeCirrusHandle
  --   [swissArmyCreateAbstract, swissArmynsertAbstract] <-
  --       runLoggingT . runConduit $ createInsertsAbstract g input inherited .| sinkList
  --   expand <- runLoggingT . runConduit $ (expandAbstractTable g expand (SE.organization $ head expand, SE.application $ head  expand, SE.contractName $ head expand)) .| sinkList

  --   swissArmyCreateAbstract `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (record_id text,
  --   address text,
  --   "chainId" text,
  --   block_hash text,
  --   block_timestamp text,
  --   block_number text,
  --   transaction_hash text,
  --   transaction_sender text,
  --   contract_name text,
  --   "addr" text,
  --   data jsonb,
  -- PRIMARY KEY (record_id));|]

  --   swissArmynsertAbstract `shouldBe` [r|INSERT INTO SwissArmy ("record_id",
  --   "address",
  --   "chainId",
  --   "block_hash",
  --   "block_timestamp",
  --   "block_number",
  --   "transaction_hash",
  --   "transaction_sender",
  --   "contract_name",
  --   "\"addr\" text")
  -- VALUES ('000000000000000000000000000000098eaddede:<CHAIN>',
  --   '000000000000000000000000000000098eaddede',
  --   '<CHAIN>',
  --   '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
  --   '2018-09-16 18:28:52.607875 UTC',
  --   '123',
  --   '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
  --   '000000000000000000000000000000098eaddede',
  --   'SwissArmyz',
  --   '"{\"addr2\":\"00000000000000000000000000000000deadbeef\"}"')
  -- ON CONFLICT (record_id) DO UPDATE SET
  --   address = excluded.address,
  --   "chainId" = excluded."chainId",
  --   block_hash = excluded.block_hash,
  --   block_timestamp = excluded.block_timestamp,
  --   block_number = excluded.block_number,
  --   transaction_hash = excluded.transaction_hash,
  --   transaction_sender = excluded.transaction_sender,
  --   contract_name = excluded.contract_name,
  --   data = excluded.data;|]

