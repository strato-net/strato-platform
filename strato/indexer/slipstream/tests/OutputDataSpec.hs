{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module OutputDataSpec where

import Conduit
import Control.Monad
import           Control.Monad.Change.Alter
-- import qualified Handlers.Storage as HS
import qualified Data.ByteString as B
import qualified Data.IntMap as I
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Time
-- import Data.Default
import Numeric
import Test.Hspec
import Text.RawString.QQ
-- import UnliftIO.IORef

import BlockApps.Logging
import qualified BlockApps.Solidity.Value as V
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256 (hash)
import qualified Slipstream.Events as SE
-- import Slipstream.Globals
-- import Slipstream.GlobalsColdStorage (fakeHandle)
import Slipstream.OutputData
import Slipstream.SolidityValue
import SolidVM.Model.CodeCollection hiding (contractName, contracts)
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType
import Blockchain.Data.AddressStateDB

-- import Network.Haskoin.Crypto.BigWord
-- import Blockchain.Data.ChainInfo
-- import Blockchain.DB.CodeDB
-- import Blockchain.DB.MemAddressStateDB

addr :: Address -> V.Value
addr = V.SimpleValue . V.ValueAccount . unspecifiedChain

bool :: Bool -> V.Value
bool = V.SimpleValue . V.ValueBool

bytes :: B.ByteString -> V.Value
bytes = V.SimpleValue . V.valueBytes

int :: Integer -> V.Value
int = V.SimpleValue . V.valueInt

instance Selectable Account AddressState (LoggingT IO) where
  select _ _ = return Nothing


createInserts :: OutputM m
              => (SE.ProcessedContract, ContractF())
              -> ConduitM () T.Text m ()
createInserts  (a,b) = do
    let cc = createDummyCodeCollection b 
    _ <- createIndexTable b cc (SE.creator $ a, SE.application $ a, SE.contractName $ a)
    createHistoryTable b cc (SE.creator $ a, SE.application $ a, SE.contractName $ a)
    insertIndexTable $ (a,[])
    -- insertHistoryTable $ [a]

createInsertsCollection :: OutputM m
            => [ProcessedCollectionRow]
              -> ConduitM () T.Text m ()
createInsertsCollection collections = do
  unless (null collections) $ do
    let collection = head collections
    _ <- createMappingTable  (creator collection, application collection, contractname collection) (collectionname collection)
    insertCollectionTable collections

createInsertsAbstract :: OutputM m
              => (SE.ProcessedContract, ContractF())
              -> [(SE.ProcessedContract, [T.Text], T.Text, [T.Text])]
              -> ConduitM () T.Text m ()
createInsertsAbstract abstract inherited = do
    let contract = snd abstract
        cc = createDummyCodeCollection contract
    _ <- createAbstractTable  (contract) (SE.creator $ fst abstract, SE.application $ fst abstract, SE.contractName $ fst abstract) M.empty cc
    unless (null inherited) $ do 
      insertAbstractTable inherited

createDummyContract :: [(T.Text, SVMType.Type)] -> ContractF()
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

createDummyCodeCollection :: ContractF() -> CodeCollectionF ()
createDummyCodeCollection contract = CodeCollection
  { _contracts = M.singleton "DummyContract" contract,
    _flFuncs = M.empty,
    _flConstants = M.empty,
    _flEnums = M.empty,
    _flStructs = M.empty,
    _flErrors = M.empty,
    _pragmas = [],
    _imports = []
  }

-- fakeCirrusHandle :: CirrusHandle
-- fakeCirrusHandle = FakeCirrusHandle

spec :: Spec
spec = do
  it "should be able to process array sentinels" $ do
    valueToSolidityValue (V.ValueArrayDynamic $ I.singleton 2 (V.ValueArraySentinel 2))
      `shouldBe` SolidityArray [SolidityNum 0, SolidityNum 0]

  describe "Array serialization" $ do
    it "should create JSON entries" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input =
             ( SE.ProcessedContract
                  { SE.address = testAdd,
                    SE.codehash = SolidVMCode "Vehicle" $ hash "<CODEHASH>",
                    SE.creator = "",
                    SE.cc_creator = Nothing,
                    SE.root = "",
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
            

      --  
      [vehicleCreate, _, _, _, vehicleInsert] <- runLoggingT . runConduit $ createInserts  input .| sinkList
      vehicleCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "Vehicle" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text,
  PRIMARY KEY (address) );|]

      vehicleInsert
        `shouldBe` [r|INSERT INTO "Vehicle" ("address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root")
  VALUES ('0000000000000000000000000000000000000add',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add',
    '',
    '')
  ON CONFLICT (address) DO UPDATE SET
    address = excluded.address,
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
             ( SE.ProcessedContract
                  { SE.address = testAdd,
                    SE.codehash = cHash,
                    SE.creator = "",
                    SE.cc_creator = Nothing,
                    SE.root = "",
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
            
       

      [vehicleCreate, historyCreate, historyIndex, historyAlter, vehicleInsert] <-
        runLoggingT . runConduit $ createInserts  input .| sinkList

      vehicleCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "Vehicle2" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text,
  PRIMARY KEY (address) );|]

      historyCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "history@Vehicle2" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text);

CREATE OR REPLACE FUNCTION "insert_or_update_Vehicle2_history_table"() RETURNS TRIGGER AS $$
BEGIN
    RAISE NOTICE 'Trigger fired for % on table Vehicle2: %', TG_OP, NEW.address;
    IF TG_OP = 'INSERT' THEN
        RAISE NOTICE 'Inserting into history table history@Vehicle2 for address: %', NEW.address;
        INSERT INTO "history@Vehicle2" VALUES (NEW.*);
    ELSIF TG_OP = 'UPDATE' THEN
        RAISE NOTICE 'Updating history table history@Vehicle2 for address: %', NEW.address;
        INSERT INTO "history@Vehicle2" VALUES (NEW.*);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "after_insert_on_Vehicle2"
AFTER INSERT ON "Vehicle2"
FOR EACH ROW EXECUTE PROCEDURE "insert_or_update_Vehicle2_history_table"();

CREATE TRIGGER "after_update_on_Vehicle2"
AFTER UPDATE ON "Vehicle2"
FOR EACH ROW EXECUTE PROCEDURE "insert_or_update_Vehicle2_history_table"();|]

      historyIndex
        `shouldBe` [r|CREATE UNIQUE INDEX IF NOT EXISTS "index_history@Vehicle2"
  ON "history@Vehicle2" (address, block_hash, transaction_hash);|]
      historyAlter
        `shouldBe` [r|ALTER TABLE "history@Vehicle2" ADD PRIMARY KEY USING INDEX "index_history@Vehicle2";|]

      vehicleInsert
        `shouldBe` [r|INSERT INTO "Vehicle2" ("address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root")
  VALUES ('0000000000000000000000000000000000000add',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add',
    '',
    '')
  ON CONFLICT (address) DO UPDATE SET
    address = excluded.address,
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender;|]

  describe "String escaping" $ do
    it "should create JSON entries with quotes escaped" $ do
      let testAdd = Address $ fst . head . readHex $ "ADDRESS"
      let input =
             ( SE.ProcessedContract
                  { SE.address = testAdd,
                    SE.codehash = SolidVMCode "\"Vehicle''" $ hash "<CODEHASH>",
                    SE.creator = "",
                    SE.cc_creator = Nothing,
                    SE.root = "",
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
            

       
      [vehicleCreate, _, _, _, vehicleInsert] <-
        runLoggingT . runConduit $ createInserts  input .| sinkList
      vehicleCreate
        `shouldBe` [r|CREATE TABLE IF NOT EXISTS "\"Vehicle''''" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text,
  PRIMARY KEY (address) );|]

      vehicleInsert
        `shouldBe` [r|INSERT INTO "\"Vehicle''''" ("address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root")
  VALUES ('0000000000000000000000000000000000000add',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '0000000000000000000000000000000000000add',
    '',
    '')
  ON CONFLICT (address) DO UPDATE SET
    address = excluded.address,
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender;|]

  it "can unparse all solidvm value types" $ do
    let testAdd = Address 0x98eaddede
        input =
           ( SE.ProcessedContract
                { SE.address = testAdd,
                  SE.codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
                  SE.creator = "MyOrg",
                  SE.cc_creator =Nothing,
                  SE.root = "",
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
          

     
    [swissArmyCreate, _, _, _, swissArmyInsert] <-
      runLoggingT . runConduit $ createInserts  input .| sinkList

    swissArmyCreate
      `shouldBe` [r|CREATE TABLE IF NOT EXISTS "MyOrg-MyApp-SwissArmy" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text,
    "addr" text,
    "boolean" bool,
    "contract" text,
    "enum_val" text,
    "number" decimal,
    "str" text,
    "strukt" jsonb,
  PRIMARY KEY (address) );|]

    swissArmyInsert
      `shouldBe` [r|INSERT INTO "MyOrg-MyApp-SwissArmy" ("address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root",
    "addr",
    "boolean",
    "contract",
    "enum_val",
    "number",
    "str",
    "strukt")
  VALUES ('000000000000000000000000000000098eaddede',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    'MyOrg',
    '',
    '00000000000000000000000000000000deadbeef',
    'True',
    '0000000000000000000000000000000000000999',
    '564',
    '77714314',
    'Hello, World!',
    '{"first_field":"887","second_field":"CLOROX DISINFECTING WIPES"}')
  ON CONFLICT (address) DO UPDATE SET
    address = excluded.address,
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
       <- newGlobals M.empty fakeHandle

      [_, swissArmyCreate, swissArmyInsert] <-
          runLoggingT . runConduit $ createInserts  [] input .| sinkList

      T.unpack swissArmyCreate `shouldContain` "\"array_nums\" jsonb,"
      T.unpack swissArmyInsert `shouldContain` [r|'["0"]')|]
  -}
  it "can createInsertsIndexTable an empty array" $ do
    let testAdd = Address 0x22222222
        input =
          ( SE.ProcessedContract
              { SE.address = testAdd,
                SE.codehash = SolidVMCode "SwissArmy" $ hash "<CODEHASH>",
                SE.creator = "MyOrg",
                SE.cc_creator = Nothing,
                SE.root = "",
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
        cc =  createDummyCodeCollection (snd input)
     

    (_, cs1) <- runLoggingT . runConduit $ createExpandIndexTable  (snd input) cc (SE.creator $ fst input, SE.application $ fst input, SE.contractName $ fst input) `fuseBoth` sinkList
    cs2 <- runLoggingT . runConduit $ insertIndexTable (fst input, []) .| sinkList
    (cs1 ++ cs2) `shouldNotBe` []

  it "can use solidvm without application nor organization" $ do
    let testAdd = Address 0x98eaddede
        input =
           ( SE.ProcessedContract
                { SE.address = testAdd,
                  SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- hash "<CODEHASH>",
                  SE.creator = "",
                  SE.cc_creator = Nothing,
                  SE.root = "",
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
          

     
    [swissArmyCreate, _, _, _, swissArmyInsert] <-
      runLoggingT . runConduit $ createInserts  input .| sinkList

    swissArmyCreate
      `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text,
    "addr" text,
    "boolean" bool,
    "contract" text,
    "enum_val" text,
    "number" decimal,
    "str" text,
    "strukt" jsonb,
  PRIMARY KEY (address) );|]

    swissArmyInsert
      `shouldBe` [r|INSERT INTO "SwissArmy" ("address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root",
    "addr",
    "boolean",
    "contract",
    "enum_val",
    "number",
    "str",
    "strukt")
  VALUES ('000000000000000000000000000000098eaddede',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    '',
    '',
    '00000000000000000000000000000000deadbeef',
    'True',
    '0000000000000000000000000000000000000999',
    '564',
    '77714314',
    'Hello, World!',
    '{"first_field":"887","second_field":"CLOROX DISINFECTING WIPES"}')
  ON CONFLICT (address) DO UPDATE SET
    address = excluded.address,
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
        input = [ProcessedCollectionRow {
          address = testAdd,
          -- codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- $ hash "<CODEHASH>",
          creator = "creator",
          cc_creator = Just "cc_creator",
          root = "groot",
          application = "",
          contractname = "SwissArmy",
          eventInfo = Nothing,
          collectionname = "SwissArmyMapping",
          collectiontype = "Mapping",
          blockHash = hash "<BLOCKHASH>",
          blockTimestamp = (read "2018-09-16 18:28:52.607875 UTC")::UTCTime,
          blockNumber = 123,
          transactionHash = hash "<TRANSACTIONHASH>",
          transactionSender = testAdd,
          collectionDataKey = V.SimpleValue $ V.ValueString "hi-key",
          collectionDataValue = V.SimpleValue $ V.ValueString "hi-value"
          }     ]

     
    [swissArmyMappingCreate, swissArmyMappingRowInsert] <-
        runLoggingT . runConduit $ createInsertsCollection  input .| sinkList

    swissArmyMappingCreate `shouldBe` [r|CREATE TABLE IF NOT EXISTS "creator-SwissArmy-SwissArmyMapping" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text,
    contract_name text,
    collectionname text,
    collectiontype text,
    key text,
    value text,
  PRIMARY KEY (address, key));|]

    swissArmyMappingRowInsert `shouldBe` [r|INSERT INTO "cc_creator-SwissArmy-SwissArmyMapping" ("address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root",
    "contract_name",
    "collectionname",
    "collectiontype",
    "key",
    "value")
  VALUES ('000000000000000000000000000000098eaddede',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    'creator',
    'groot',
    'SwissArmy',
    'SwissArmyMapping',
    'Mapping',
    'hi-key',
    'hi-value')
  ON CONFLICT (address, key) DO UPDATE SET
    address = excluded.address,
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    contract_name = excluded.contract_name,
    collectionname = excluded.collectionname,
    collectiontype = excluded.collectiontype,
    value = excluded.value;|]

  it "can create and insert into abstract tables" $ do
    let testAdd = Address 0x98eaddede
        input = (SE.ProcessedContract {
          SE.address = testAdd,
          SE.codehash = CodeAtAccount (Account (Address 0x1234567890) Nothing) "SwissArmy", -- $ hash "<CODEHASH>",
          SE.creator = "",
          SE.cc_creator = Nothing,
          SE.root = "",
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
          SE.creator = "",
          SE.cc_creator = Nothing,
          SE.root = "",
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
          }, [], T.pack "SwissArmy", [])]


     
    [swissArmyCreateAbstract, swissArmyInsertAbstract] <-
        runLoggingT . runConduit $ createInsertsAbstract  input inherited .| sinkList

    swissArmyCreateAbstract `shouldBe` [r|CREATE TABLE IF NOT EXISTS "SwissArmy" (address text,
    block_hash text,
    block_timestamp text,
    block_number text,
    transaction_hash text,
    transaction_sender text,
    creator text,
    root text,
    contract_name text,
    data jsonb,
    "addr" text,
  PRIMARY KEY (address));|]

    swissArmyInsertAbstract `shouldBe` [r|INSERT INTO SwissArmy ("address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root",
    "contract_name",
    "data")
  VALUES ('000000000000000000000000000000098eaddede',
    '2b47410f675ac98038c44d14a87eac6855e0bfcbb0473649c22e147a789a9f08',
    '2018-09-16 18:28:52.607875 UTC',
    '123',
    '242d201a68fa4440fcb3c77610785eb207b5a8b9f88208a3525efe6a7677ed59',
    '000000000000000000000000000000098eaddede',
    '',
    '',
    'SwissArmyz',
    '{"addr2":"00000000000000000000000000000000deadbeef"}'::jsonb) ON CONFLICT (address) DO UPDATE SET
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    contract_name = excluded.contract_name,
    data = SwissArmy.data || ('{"addr2":"00000000000000000000000000000000deadbeef"}'::jsonb);|]