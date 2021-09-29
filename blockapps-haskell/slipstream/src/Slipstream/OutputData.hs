{-# LANGUAGE
    ConstraintKinds
  , FlexibleContexts
  , OverloadedStrings
  , QuasiQuotes
  , RecordWildCards
  , TemplateHaskell
#-}

module Slipstream.OutputData (
  outputData,
  insertExpandEventTables,
  createInserts,
  createEventTables,
  createExpandInsertIndexTable,
  createExpandInsertHistoryTable,
  cirrusInfo
  ) where

import           BlockApps.Solidity.Value
import           Conduit
import           Control.Monad
import           Data.Aeson                      (encode)
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy            as BL
import qualified Data.Map                        as Map
import           Data.Maybe                      (catMaybes, listToMaybe)
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Text.Encoding              (decodeUtf8, encodeUtf8)
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Protocol
import           Database.PostgreSQL.Typed.Query
import           Text.RawString.QQ
import           UnliftIO.IORef
import           UnliftIO.Exception              (handle, SomeException)

import           BlockApps.Logging
import           Blockchain.Data.AddressStateDB
import           Blockchain.Strato.Model.Keccak256

import Slipstream.Data.Action
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Options
import Slipstream.SolidityValue

type OutputM m = (MonadUnliftIO m, MonadLogger m)

tshow :: Show a => a -> Text
tshow = T.pack . show

typeText :: SolidityValue -> Text
typeText (SolidityValueAsString _) = "text"
typeText (SolidityNum _) = "bigint"
typeText (SolidityBool _) = "bool"
typeText _ = "jsonb"

csv :: [Text] -> Text
csv = T.intercalate ",\n    "

wrap :: Text -> Text -> Text -> Text
wrap b e x = T.concat [b, x, e]

wrap1 :: Text -> Text -> Text
wrap1 t = wrap t t

wrapSingleQuotes :: Text -> Text
wrapSingleQuotes = wrap1 "\'"

wrapDoubleQuotes :: Text -> Text
wrapDoubleQuotes = wrap1 "\""

wrapParens :: Text -> Text
wrapParens = wrap "(" ")"

wrapAndEscape :: [Text] -> Text
wrapAndEscape = wrapParens . csv . map wrapSingleQuotes

wrapAndEscapeDouble :: [Text] -> Text
wrapAndEscapeDouble = wrapParens . csv . map wrapDoubleQuotes

unwrapDoubleQuotes :: Text -> Text
unwrapDoubleQuotes = T.dropAround (== '"')

solidityValueToText :: SolidityValue -> Text
solidityValueToText (SolidityValueAsString x) = escapeQuotes x
solidityValueToText (SolidityBool x)          = tshow x
solidityValueToText (SolidityNum x )          = tshow x
solidityValueToText (SolidityBytes x)         = escapeQuotes $ tshow x
solidityValueToText (SolidityArray x)         = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ encode x
solidityValueToText (SolidityObject x)        = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ encode x

escapeSingleQuotes :: Text -> Text
escapeSingleQuotes = T.replace "\'" "\'\'"

escapeDoubleQuotes :: Text -> Text
escapeDoubleQuotes = T.replace "\"" "\\\""

escapeQuotes :: Text -> Text
escapeQuotes = escapeSingleQuotes . escapeDoubleQuotes

tableColumns :: [(Text, SolidityValue)] -> TableColumns
tableColumns = map go
  where go (x,y) = let z = wrapDoubleQuotes $ escapeQuotes x
                   in T.concat [z, " ", typeText y]

-- Considered partial because I'm assuming the TableColumns will always be in this format:
-- ["\"myCol1\" type1", "\"myCol2\" type2", "\"myCol3\" type3"]
partialParseTableColumns :: TableColumns -> [Text]
partialParseTableColumns = concat . mapM (fmap unwrapDoubleQuotes . listToMaybe . T.words)

tableUpsert :: [Text] -> Text
tableUpsert = csv . map go
  where go x = let y = wrapDoubleQuotes $ escapeQuotes x
                in wrap1 y " = excluded."

cirrusInfo :: PGDatabase
cirrusInfo = PGDatabase
  { pgDBAddr = Left (flags_pghost, show flags_pgport)
  , pgDBTLS = TlsDisabled
  , pgDBUser = BC.pack flags_pguser :: B.ByteString
  , pgDBPass = BC.pack flags_password :: B.ByteString
  , pgDBName = BC.pack flags_database :: B.ByteString
  , pgDBDebug = False
  , pgDBLogMessage = runLoggingT . $logInfoLS "pglog" . PGError
  , pgDBParams = [("Timezone", "UTC")]
  }

dbInsert :: OutputM m => PGConnection -> Text -> m ()
dbInsert conn insrt = handle handlePostgresError
                    . liftIO
                    . void
                    . pgQuery conn
                    . rawPGSimpleQuery $! encodeUtf8 insrt

isFunction :: Value -> Bool
isFunction ValueFunction{} = False
isFunction _ = True

handlePostgresError :: OutputM m => SomeException -> m ()
handlePostgresError = $logErrorLS "handlePGError"

outputData :: OutputM m
           => PGConnection
           -> ConduitM () Text m ()
           -> m ()
outputData conn c = runConduit $ c
                              .| iterMC ($logDebugS "outputData")
                              .| mapM_C (dbInsert conn)

baseColumns :: TableColumns
baseColumns = [ "address"
              , "chainId"
              , "block_hash"
              , "block_timestamp"
              , "block_number"
              , "transaction_hash"
              , "transaction_sender"
              ]

baseTableColumns :: TableColumns
baseTableColumns = baseColumns ++ ["transaction_function_name"]


-- sometimes we need the unwrapped tablename
tableNameToDoubleQuoteText :: TableName -> Text
tableNameToDoubleQuoteText = wrapDoubleQuotes . escapeQuotes . tableNameToText

tableNameToText :: TableName -> Text
tableNameToText (IndexTableName o a c) =
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> ":"
                   else o <> ":" <> a <> ":"
  in prefix <> c
tableNameToText (HistoryTableName o a c) = 
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> ":"
                   else o <> ":" <> a <> ":"
  in "history@" <> prefix <> c
tableNameToText (EventTableName o a c e) = 
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> ":"
                   else o <> ":" <> a <> ":"
      contractAndEvent = c <> "." <> e
  in prefix <> contractAndEvent

createInserts :: OutputM m
              => IORef Globals
              -> [ProcessedContract]
              -> ConduitM () Text m ()
createInserts globalsIORef contracts = do
  unless (null contracts) $ do
    let contract = head contracts
    createIndexTable globalsIORef contract
    createHistoryTable globalsIORef contract
    insertIndexTable globalsIORef contracts
    insertHistoryTable globalsIORef contracts

createExpandInsertIndexTable
  :: OutputM m
  => IORef Globals
  -> [ProcessedContract]
  -> ConduitM () Text m ()
createExpandInsertIndexTable g cs = do
  unless (null cs) $ do
    let c = head cs
    createIndexTable g c
    expandIndexTable g cs
    insertIndexTable g cs

createExpandInsertHistoryTable
  :: OutputM m
  => IORef Globals
  -> [ProcessedContract]
  -> ConduitM () Text m ()
createExpandInsertHistoryTable g cs = do
  unless (null cs) $ do
    let c = head cs
    createHistoryTable g c
    expandHistoryTable g cs
    insertHistoryTable g cs

createIndexTable :: OutputM m
                 => IORef Globals
                 -> ProcessedContract
                 -> ConduitM () Text m ()
createIndexTable globalsIORef contract = do
  let tableName = IndexTableName (organization contract) (application contract) (contractName contract)
  contractAlreadyCreated <- isTableCreated globalsIORef tableName

  --When contract hasn't been written to "contract" table and indexing table doesn't exist
  $logDebugLS "createIndexTable/contractAlreadyCreated" (tableName, contractAlreadyCreated)
  unless contractAlreadyCreated $ do
    incNumTables
    yield $ insertContractTableQuery contract
    yield $ createIndexTableQuery contract
    let list = tableColumns $ Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData contract
    setTableCreated globalsIORef tableName list

createHistoryTable :: OutputM m
                   => IORef Globals
                   -> ProcessedContract
                   -> ConduitM () Text m ()
createHistoryTable globalsIORef contract = do
  let tableName = HistoryTableName (organization contract) (application contract) (contractName contract)
  history <- isHistoric globalsIORef tableName
  tableExists <- isTableCreated globalsIORef tableName
  when (history && not tableExists) $ do
    incNumHistoryTables
    yield $ createHistoryTableQuery contract
    yield $ addHistoryUnique contract
    let list = tableColumns $ Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData contract
    setTableCreated globalsIORef tableName list



-- Runs ALTER TABLE <name> [ADD COLUMN <column>] for any new fields added to a contract definition   
expandIndexTable :: OutputM m
                 => IORef Globals
                 -> [ProcessedContract]
                 -> ConduitM () Text m ()
expandIndexTable _ [] = return ()
expandIndexTable globalsIORef lst@(x:_) = do
  let tableName = IndexTableName (organization x) (application x) (contractName x)
  expandContractTable globalsIORef lst tableName

expandHistoryTable :: OutputM m
                 => IORef Globals
                 -> [ProcessedContract]
                 -> ConduitM () Text m ()
expandHistoryTable _ [] = return ()
expandHistoryTable globalsIORef lst@(x:_) = do
  let tableName = HistoryTableName (organization x) (application x) (contractName x)
  expandContractTable globalsIORef lst tableName

expandContractTable :: OutputM m
                    => IORef Globals
                    -> [ProcessedContract]
                    -> TableName
                    -> ConduitM () Text m ()
expandContractTable _ [] _ = return ()
expandContractTable globalsIORef (x:xs) tableName = do
  columns <- getTableColumns globalsIORef tableName
  case columns of
    Nothing -> do
      $logErrorLS "expandTable" $ T.concat 
          [ "Table " 
          , (tableNameToText tableName)
          , " does not exist, but we are trying to expand it?"
          ]
      expandContractTable globalsIORef xs tableName
    Just cols -> do
      let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData x
          difference new old = filter ((`notElem` old) . fst) new
          extras = tableColumns $ difference list (partialParseTableColumns cols)
      unless (null extras) $ do
        $logInfoS "expandTable" . T.pack $ "We just got new fields for a contract that already has a table!"
        $logInfoS "expandTable" $ T.concat
            [ "Adding columns to "
            , (tableNameToText tableName)
            , " for the following new fields: "
            , T.intercalate ", " extras
            ]
        setTableCreated globalsIORef tableName $ cols ++ extras
        yield $ expandTableQuery tableName extras
      expandContractTable globalsIORef xs tableName

expandTableQuery :: TableName ->  TableColumns -> Text
expandTableQuery tableName cols = T.concat
  [ "ALTER TABLE "
  , tableNameToDoubleQuoteText tableName
   , " ADD COLUMN " 
  , T.intercalate ", ADD COLUMN " cols
  , ";"
  ]


insertIndexTable :: OutputM m
                 => IORef Globals
                 -> [ProcessedContract]
                 -> ConduitM () Text m ()
insertIndexTable _ [] = error "insertIndexTable: unhandled empty list"
insertIndexTable _ contracts = yield $ insertIndexTableQuery contracts

insertHistoryTable :: OutputM m
                   => IORef Globals
                   -> [ProcessedContract]
                   -> ConduitM () Text m ()
insertHistoryTable _ [] = error "insertHistoryTable: unhandled empty list"
insertHistoryTable globalsIORef contracts@(x:_) = do
  let tableName = HistoryTableName (organization x) (application x) (contractName x)
  history <- isHistoric globalsIORef tableName
  when history . yield $ insertHistoryTableQuery contracts

insertContractTableQuery :: ProcessedContract -> Text
insertContractTableQuery ProcessedContract{..} =
  let tableName = IndexTableName organization application contractName
      conVals = wrapAndEscape . map escapeQuotes $
        [ T.pack $ keccak256ToHex $ resolvedCodePtrToSHA codehash
        , tableNameToText tableName
        , abi
        , chain
        ]
   in T.concat
        [ "INSERT INTO contract (\"codeHash\", contract, abi, \"chainId\")\n  VALUES "
        , conVals
        , "\n  ON CONFLICT DO NOTHING;"
        ]

createIndexTableQuery :: ProcessedContract -> Text
createIndexTableQuery contract =
  let tableName = IndexTableName (organization contract) (application contract) (contractName contract)
      list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData contract
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS " , tableNameToDoubleQuoteText tableName , " ("
        , csv $ ["address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
               "block_number text", "transaction_hash text", "transaction_sender text",
               "transaction_function_name text"] ++ tableColumns list
        , ",\n  CONSTRAINT "
        , wrapDoubleQuotes ((escapeQuotes $ tableNameToText tableName) <> "_pkey")
        , "\n  PRIMARY KEY (address, \"chainId\") );"
        ]

createHistoryTableQuery :: ProcessedContract -> Text
createHistoryTableQuery contract =
  let tableName = HistoryTableName (organization contract) (application contract) (contractName contract)
      list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData contract
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ", tableNameToDoubleQuoteText tableName, " ("
        , csv $ ["address text NOT NULL", "\"chainId\" text NOT NULL", "block_hash text NOT NULL", "block_timestamp text",
                 "block_number text", "transaction_hash text NOT NULL", "transaction_sender text",
                 "transaction_function_name text"]
                 ++ tableColumns list
        , ");"
        ]

addHistoryUnique :: ProcessedContract -> Text
addHistoryUnique contract =
  let historyName' = HistoryTableName (organization contract) (application contract) (contractName contract)
      historyName = tableNameToDoubleQuoteText historyName'
      indexName = "index_" <> (escapeQuotes $ tableNameToText historyName')
  in  "CREATE UNIQUE INDEX IF NOT EXISTS " <> wrapDoubleQuotes indexName <>
      "\n  ON " <> historyName <> " (address, \"chainId\", block_hash, transaction_hash);\n" <>
      "ALTER TABLE " <> historyName <> " ADD PRIMARY KEY USING INDEX " <> wrapDoubleQuotes indexName <> ";"

insertIndexTableQuery :: [ProcessedContract] -> Text
insertIndexTableQuery [] = error "insertIndexTableQuery: unhandled empty list"
insertIndexTableQuery contracts@(x:_) =
  let tableName = IndexTableName (organization x) (application x) (contractName x)
      list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData x
      keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst list
      transactionFuncName = const ""
      baseVals = [ tshow . address
                 , chain
                 , T.pack . keccak256ToHex . blockHash
                 , tshow . blockTimestamp
                 , tshow . blockNumber
                 , T.pack . keccak256ToHex . transactionHash
                 , tshow . transactionSender
                 ]
      tableVals = baseVals ++ [escapeQuotes . transactionFuncName]
      vals = flip map contracts $ \row ->
        let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
         in wrapAndEscape $ map ($ row) tableVals ++ map solidityValueToText (snd <$> rowList)
      inserts = csv vals
   in T.concat
        [ "INSERT INTO "
        , tableNameToDoubleQuoteText tableName
        , " "
        , keySt
        , "\n  VALUES "
        , inserts
        , [r|
  ON CONFLICT (address, "chainId") DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    transaction_function_name = excluded.transaction_function_name|]
        , if null list then "" else ",\n    "
        , tableUpsert $ map fst list
        , ";"
        ]

insertHistoryTableQuery :: [ProcessedContract] -> Text
insertHistoryTableQuery [] = error "insertHistoryTableQuery: unhandled empty list"
insertHistoryTableQuery contracts@(x:_) =
  let tableName = HistoryTableName (organization x) (application x) (contractName x)
      list = Map.toList . Map.map valueToSolidityValue . Map.filter isFunction $ contractData x
      keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst list
      transactionFuncName = const ""
      baseVals = [ tshow . address
                 , chain
                 , T.pack . keccak256ToHex . blockHash
                 , tshow . blockTimestamp
                 , tshow . blockNumber
                 , T.pack . keccak256ToHex . transactionHash
                 , tshow . transactionSender
                 ]
      tableVals = baseVals ++ [escapeQuotes . transactionFuncName]
      vals = flip map contracts $ \row ->
        let rowList = Map.toList . Map.map valueToSolidityValue . Map.filter isFunction $ contractData row
         in wrapAndEscape $ map ($ row) tableVals ++ map solidityValueToText (snd <$> rowList)
      inserts = csv vals
   in T.concat $
        [ "INSERT INTO "
        , tableNameToDoubleQuoteText tableName
        , " "
        , keySt
        , "\n  VALUES "
        , inserts
        , "\n  ON CONFLICT DO NOTHING;"
        ]



-- Creates tables for all event declarations, stores table name in
-- globals{createdEvents}
createEventTables :: OutputM m
                  => IORef Globals
                  -> [EventTable]
                  -> ConduitM () Text m ()
createEventTables globalsIORef events = do 
  yieldMany . catMaybes =<< lift (mapM (createEventTable globalsIORef) events)
   
createEventTable :: OutputM m
                 => IORef Globals
                 -> EventTable
                 -> m (Maybe Text)
createEventTable globalsIORef ev = do
  let eventTable = EventTableName (eventOrganization ev) (eventApplication ev) (eventContractName ev) (eventName ev)
  eventAlreadyCreated <- isTableCreated globalsIORef eventTable
  if eventAlreadyCreated then 
    return Nothing
  else do
    setTableCreated globalsIORef eventTable $ eventFields ev
    return (Just $ createEventTableQuery ev) 

createEventTableQuery :: EventTable -> Text
createEventTableQuery ev =
  let tableName = EventTableName (eventOrganization ev) (eventApplication ev) (eventContractName ev) (eventName ev)
      cols = csv $ ["id SERIAL NOT NULL", "address text"] ++ 
                (map (\t -> T.concat [wrapDoubleQuotes t, " text"]) $ eventFields ev) 
  in T.concat   
      [ "CREATE TABLE IF NOT EXISTS " 
      , tableNameToDoubleQuoteText tableName
      ," ("
      , cols
      , ");"
      ]

-- Inserts rows for all event emissions into their respective tables, expands tables if necessary
--   Though this function checks that the tables exist before
--   generating the insert query, the VM should prevent undeclared
--   events from being emitted (it should also do an argument check)
insertExpandEventTables :: OutputM m
                        => IORef Globals
                        -> [AggregateEvent]
                        -> ConduitM () Text m ()
insertExpandEventTables _ [] = return ()
insertExpandEventTables globalsIORef events = do
  expandEventTables globalsIORef events
  insertEventTables globalsIORef events

expandEventTables :: OutputM m
                  => IORef Globals
                  -> [AggregateEvent]
                  -> ConduitM () Text m ()
expandEventTables _ [] = return ()
expandEventTables globalsIORef (x:xs) = do
  let tableName = EventTableName (agOrganization x) (agApplication x) (agContractName x) (agEventName x)
  columns <- getTableColumns globalsIORef tableName
  case columns of
    Nothing -> do
      $logErrorLS "expandEventTable" $ T.concat 
          [ "Table " 
          , (tableNameToText tableName)
          , " does not exist, but we are trying to expand it?"
          ]
      expandEventTables globalsIORef xs
    Just cols -> do
      let extras = filter (not . flip elem cols) (map fst $ agEventArgs x)
      unless (null extras) $ do
        $logInfoS "expandEventTable" . T.pack $ "We just got new fields for a contract that already has a table!"
        $logInfoS "expandEventTable" $ T.concat
            [ "Adding columns to "
            , (tableNameToText tableName)
            , " for the following new fields: "
            , T.intercalate ", " extras
            ]
        setTableCreated globalsIORef tableName $ cols ++ extras
        let extrasWithType = map (\t -> T.concat [wrapDoubleQuotes t, " text"]) extras
        yield $ expandTableQuery tableName extrasWithType
      expandEventTables globalsIORef xs

insertEventTables :: OutputM m
                  => IORef Globals
                  -> [AggregateEvent]
                  -> ConduitM () Text m ()
insertEventTables globalsIORef events = do
  yieldMany . catMaybes =<< lift (mapM (insertEventTable globalsIORef) events)

insertEventTable :: OutputM m
                 => IORef Globals
                 -> AggregateEvent
                 -> m (Maybe Text)
insertEventTable globalsIORef ev = do
  let eventTable = EventTableName (agOrganization ev) (agApplication ev) (agContractName ev) (agEventName ev)
  eventExists <- isTableCreated globalsIORef eventTable
  if eventExists then return (Just $ insertEventTableQuery ev)
  else return Nothing

insertEventTableQuery :: AggregateEvent -> Text
insertEventTableQuery ev = 
 let tableName = EventTableName (agOrganization ev) (agApplication ev) (agContractName ev) (agEventName ev)
     cols = wrapAndEscapeDouble . map escapeQuotes $ ["id", "address"] ++ (map fst $ agEventArgs ev)
     vals = csv $ map (wrapSingleQuotes . snd) $ agEventArgs ev
 in T.concat
        [ "INSERT INTO "
        , tableNameToDoubleQuoteText tableName
        , " "
        , cols
        , " VALUES "
        , "( DEFAULT,\n" -- id, set by Postgres
        , wrapSingleQuotes $ tshow $ agContractAccount ev
        , ",\n"
        , vals
        ,  " );"
        , "\n"--  ON CONFLICT DO NOTHING;"
        ]
