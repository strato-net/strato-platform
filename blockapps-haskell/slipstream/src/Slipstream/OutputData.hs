{-# LANGUAGE
    ConstraintKinds
  , FlexibleContexts
  , OverloadedStrings
  , QuasiQuotes
  , RecordWildCards
  , ScopedTypeVariables
  , TemplateHaskell
#-}

module Slipstream.OutputData (
  outputData,
  OutputM,
  insertExpandEventTables,
  insertIndexTable,
  insertForeignKeys,
  createIndexTable,
  createHistoryTable,
  insertHistoryTable,
  createEventTables,
  createExpandIndexTable,
  createForeignIndexesForJoins,
  notifyPostgREST,
  createExpandHistoryTable,
  cirrusInfo,
  historyTableName
  ) where

import           BlockApps.Solidity.Value
import           Conduit
import           Control.Lens ((^.))
import           Control.Monad
import           Data.Aeson                      (encode)
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy            as BL
import qualified Data.Map                        as Map
import           Data.Maybe                      (catMaybes, listToMaybe, mapMaybe)
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Text.Encoding              (decodeUtf8, encodeUtf8)
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Protocol
import           Database.PostgreSQL.Typed.Query
import           Text.Printf
import           Text.RawString.QQ
import           UnliftIO.IORef
import           UnliftIO.Exception              (handle, catch, SomeException)

import           BlockApps.Logging
import           Blockchain.Strato.Model.Address
import qualified Blockchain.Strato.Model.Event   as Action
import           Blockchain.Strato.Model.Keccak256

import           Slipstream.Events
import           Slipstream.Globals
import           Slipstream.Metrics
import           Slipstream.Options
import           Slipstream.SolidityValue

import           SolidVM.Model.CodeCollection              hiding (contractName, contracts, events)
import qualified SolidVM.Model.Type         as SVMType


crashOnSQLError :: Bool
crashOnSQLError = True


tableSeparator :: Text
tableSeparator = "-"

type OutputM m = (MonadUnliftIO m, MonadLogger m)

tshow :: Show a => a -> Text
tshow = T.pack . show

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
wrapAndEscape = wrapParens . csv

wrapAndEscapeDouble :: [Text] -> Text
wrapAndEscapeDouble = wrapParens . csv . map wrapDoubleQuotes

unwrapDoubleQuotes :: Text -> Text
unwrapDoubleQuotes = T.dropAround (== '"')

escapeSingleQuotes :: Text -> Text
escapeSingleQuotes = T.replace "\'" "\'\'"

escapeDoubleQuotes :: Text -> Text
escapeDoubleQuotes = T.replace "\"" "\\\""

escapeQuotes :: Text -> Text
escapeQuotes = escapeSingleQuotes . escapeDoubleQuotes

tableColumns :: [(Text, VariableDeclF a)] -> TableColumns
tableColumns = mapMaybe go
  where go (x,y) =
          case solidityTypeToSQLType y of
            Nothing -> Nothing
            Just v -> Just $ wrapDoubleQuotes (escapeQuotes x) <> " " <> v

-- Considered partial because I'm assuming the TableColumns will always be in this format:
-- ["\"myCol1\" type1", "\"myCol2\" type2", "\"myCol3\" type3"]
partialParseTableColumns :: TableColumns -> [Text]
partialParseTableColumns = concat . mapM (fmap unwrapDoubleQuotes . listToMaybe . T.words)

makeAccount :: ProcessedContract -> Text
makeAccount c@ProcessedContract{chain=""} = tshow $ address c
makeAccount c = T.concat [
  tshow $ address c,
  ":",
  chain c
  ]

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

dbQueryCatchError :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQueryCatchError conn insrt = handle handlePostgresError $ dbQuery conn insrt

dbQuery :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQuery conn insrt = do
  $logDebugS "outputData" insrt
  liftIO . void . pgQuery conn . rawPGSimpleQuery $! encodeUtf8 insrt

handlePostgresError :: MonadLogger m => SomeException -> m ()
handlePostgresError e =
  if crashOnSQLError
  then error . show $ e
    else$logErrorLS "handlePGError" e

outputData :: OutputM m
           => PGConnection
           -> ConduitM () Text m a
           -> m a
outputData conn c = runConduit $ c `fuseUpstream` mapM_C (dbQueryCatchError conn)

baseColumns :: TableColumns
baseColumns = [ "record_id"
              , "address"
              , "chainId"
              , "block_hash"
              , "block_timestamp"
              , "block_number"
              , "transaction_hash"
              , "transaction_sender"
              ]

baseTableColumns :: TableColumns
baseTableColumns = baseColumns


-- discard app if org is null
constructTableNameParameters :: Text -> Text -> Text -> (Text, Text, Text)
constructTableNameParameters org app contract =
  if T.null org
    then ("", "", contract)
    else if app == contract
         then (org, "", contract)
         else (org, app, contract)

uncurry3 :: (a -> b -> c -> d) -> (a, b, c) -> d
uncurry3 f (x, y, z) = f x y z

historyTableName :: Text -> Text -> Text -> TableName
historyTableName o a n = uncurry3 HistoryTableName $ constructTableNameParameters o a n

indexTableName :: Text -> Text -> Text -> TableName
indexTableName o a n = uncurry3 IndexTableName $ constructTableNameParameters o a n



-- sometimes we need the unwrapped tablename
tableNameToDoubleQuoteText :: TableName -> Text
tableNameToDoubleQuoteText = wrapDoubleQuotes . escapeQuotes . tableNameToText


tableNameToText :: TableName -> Text
tableNameToText (IndexTableName o a c) =
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> tableSeparator
                   else o <> tableSeparator <> a <> tableSeparator
  in prefix <> c
tableNameToText (HistoryTableName o a c) = 
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> tableSeparator
                   else o <> tableSeparator <> a <> tableSeparator
  in "history@" <> prefix <> c
tableNameToText (EventTableName o a c e) = 
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> tableSeparator
                   else o <> tableSeparator <> a <> tableSeparator
      contractAndEvent = c <> "." <> e
  in prefix <> contractAndEvent

createExpandIndexTable
  :: OutputM m
  => IORef Globals
  -> Contract
  -> (Text, Text, Text)
  -> ConduitM () Text m [ForeignKeyInfo]
createExpandIndexTable g c nameParts = do
  creationForeignKeys <- createIndexTable g c nameParts
  expansionForeignKeys <- expandIndexTable g c nameParts
  return $ creationForeignKeys ++ expansionForeignKeys

data ForeignKeyInfo =
  ForeignKeyInfo {
    tableName :: TableName,
    columnName :: Text,
    foreignTableName :: TableName
    } deriving (Show)

createForeignIndexesForJoins :: OutputM m =>
                                ForeignKeyInfo -> ConduitM () Text m ()
createForeignIndexesForJoins foreignKey = do
  yield $
    "ALTER TABLE "
    <> tableNameToDoubleQuoteText (tableName foreignKey)
    <> " ADD FOREIGN KEY ("
    <> wrapDoubleQuotes (columnName foreignKey)
    <> ") REFERENCES "
    <> tableNameToDoubleQuoteText (foreignTableName foreignKey)
    <> " (record_id);"

notifyPostgREST :: OutputM m =>
                   PGConnection -> m ()
notifyPostgREST conn = do
    dbQueryCatchError conn "NOTIFY pgrst, 'reload schema';"

createExpandHistoryTable
  :: OutputM m
  => IORef Globals
  -> Contract
  -> (Text, Text, Text)
  -> ConduitM () Text m ()
createExpandHistoryTable g c nameParts = do
    createHistoryTable g c nameParts
    expandHistoryTable g c nameParts

getDeferredForeignKeys :: TableName -> Contract -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeys tableName c o a = 
--    deferredForeignKeys' <- fmap concat $
--      forM (Map.toList $ cc^.contracts) $ \(nameString, c) ->

  flip map [(theName, x) | (theName, VariableDecl{varType=SVMType.Contract x}) <- (Map.toList $ c^.storageDefs)] $ \(theName, x) -> 
    ForeignKeyInfo {
      tableName=tableName,
      columnName=theName,
      foreignTableName=indexTableName o a x
      }

createIndexTable :: OutputM m
                 => IORef Globals
                 -> Contract
                 -> (Text, Text, Text)
                 -> ConduitM () Text m [ForeignKeyInfo]
createIndexTable globalsIORef contract (o, a, n) = do
  let tableName = indexTableName o a n
  contractAlreadyCreated <- isTableCreated globalsIORef tableName

  --When contract hasn't been written to "contract" table and indexing table doesn't exist
  $logInfoLS "createIndexTable/contractAlreadyCreated" (tableName, contractAlreadyCreated)
  if contractAlreadyCreated
  then return []
  else do
    incNumTables
    yield $ createIndexTableQuery contract (o, a, n)
    let list = tableColumns $ Map.toList $ contract^.storageDefs
    setTableCreated globalsIORef tableName list
    return $ getDeferredForeignKeys tableName contract o a

createHistoryTable :: OutputM m
                   => IORef Globals
                   -> Contract
                   -> (Text, Text, Text)
                   -> ConduitM () Text m ()
createHistoryTable globalsIORef contract (o, a, n) = do
  let tableName = historyTableName o a n
  tableExists <- isTableCreated globalsIORef tableName

  $logInfoLS "createHistoryTable/tableExists" (tableName, tableExists)

  when (not tableExists) $ do
    incNumHistoryTables
    yield $ createHistoryTableQuery contract (o, a, n)
    yieldMany $ addHistoryUnique (o, a, n)
    let list = tableColumns $ Map.toList $ contract^.storageDefs
    setTableCreated globalsIORef tableName list


-- Runs ALTER TABLE <name> [ADD COLUMN <column>] for any new fields added to a contract definition   
expandIndexTable :: OutputM m
                 => IORef Globals
                 -> Contract
                 -> (Text, Text, Text)
                 -> ConduitM () Text m [ForeignKeyInfo]
expandIndexTable globalsIORef contract (o, a, n)= do
  let tableName = indexTableName o a n
  expandContractTable globalsIORef contract tableName

expandHistoryTable :: OutputM m =>
                      IORef Globals ->
                      Contract ->
                      (Text, Text, Text) ->
                      ConduitM () Text m ()
expandHistoryTable globalsIORef contract (o, a, n) = do
  let tableName = historyTableName o a n
  _ <- expandContractTable globalsIORef contract tableName
  return ()

expandContractTable :: OutputM m
                    => IORef Globals
                    -> Contract
                    -> TableName
                    -> ConduitM () Text m [ForeignKeyInfo]
expandContractTable globalsIORef contract tableName = do
  columns <- getTableColumns globalsIORef tableName
  case columns of
    Nothing -> do
      $logErrorLS "expandTable" $ T.concat 
          [ "Table " 
          , (tableNameToText tableName)
          , " does not exist, but we are trying to expand it?"
          ]
      return []
    Just cols -> do
      let list = Map.toList $ contract^.storageDefs
          difference new old = filter ((`notElem` old) . fst) new
          extras = difference list (partialParseTableColumns cols)
          extraTableColumns = tableColumns extras
      unless (null extraTableColumns) $ do
        $logInfoS "expandTable" . T.pack $ "We just got new fields for a contract that already has a table!"
        $logInfoS "expandTable" $ T.concat
            [ "Adding columns to "
            , (tableNameToText tableName)
            , " for the following new fields: "
            , T.intercalate ", " extraTableColumns
            ]
        setTableCreated globalsIORef tableName $ cols ++ extraTableColumns
        yield $ expandTableQuery tableName extraTableColumns
      return $
        case tableName of
          IndexTableName o a n ->
            flip map
            [(colName, foreignName) | (colName, VariableDecl{varType=SVMType.Contract foreignName}) <- extras] $ \(colName, foreignName) -> 
            ForeignKeyInfo {
              tableName = tableName,
              columnName = colName,
              foreignTableName = let a' = case a of; "" -> n; _ -> a
                                 in indexTableName o a' foreignName
              }
          _ -> []
        
expandTableQuery :: TableName ->  TableColumns -> Text
expandTableQuery tableName cols = T.concat
  [ "ALTER TABLE "
  , tableNameToDoubleQuoteText tableName
   , " ADD COLUMN " 
  , T.intercalate ", ADD COLUMN " cols
  , ";"
  ]

insertIndexTable :: OutputM m
                 => [ProcessedContract]
                 -> ConduitM () Text m ()
insertIndexTable [] = error "insertIndexTable: unhandled empty list"
insertIndexTable contracts = yield $ insertIndexTableQuery contracts

insertForeignKeys :: (MonadLogger m, MonadUnliftIO m) =>
                     PGConnection -> [ProcessedContract] -> m ()
insertForeignKeys conn contracts = do
  forM_ contracts $ \c -> do
    let tableName = indexTableName 
                            (organization c)
                            (application c)
                            (contractName c)

    --There are still reasons why a foreign key insertion might fail
    --  1. The field type was changed in a solidity contract version update
    --  2. solidity uses inheritance, and the foreign key points to the parent table
    --  3. The user just sets a variable to a made up invalid address (0x1234)
    --When an invalid foreign pointer is set, STRATO's stated behavior will be to set the value to null
    forM_ [(n, a) | (n, ValueContract a) <- Map.toList $ contractData c] $ \(theName, acct) -> do
      dbQuery conn $
            "UPDATE " <> 
            tableNameToDoubleQuoteText tableName <> 
            " SET " <> 
            wrapDoubleQuotes theName <> 
            "=" <> 
            wrapSingleQuotes (escapeQuotes $ T.pack $ show acct) <> 
            " WHERE record_id=" <> 
            wrapSingleQuotes (makeAccount c)  <>
            ";"
      `catch` \(e :: SomeException) -> do
            $logInfoS "insertHistoryTable" $ T.pack $ "foreign key update failed, value will be set to null: " ++ show e
            dbQueryCatchError conn $
              "UPDATE " <> 
              tableNameToDoubleQuoteText tableName <> 
              " SET " <> 
              wrapDoubleQuotes theName <> 
              "=null WHERE record_id=" <> 
              wrapSingleQuotes (makeAccount c)

insertHistoryTable :: OutputM m
                   => IORef Globals
                   -> [ProcessedContract]
                   -> ConduitM () Text m ()
insertHistoryTable _ [] = return () --no data, do nothing
insertHistoryTable globalsIORef contracts@(x:_) = do
  let tableName = historyTableName
          (organization x)
          (application x)
          (contractName x)
  history <- isHistoric globalsIORef tableName

  when history $ do
    $logInfoS "insertHistoryTable" $ T.pack $ "Inserting row in history table for: " ++ show tableName
    yield $ insertHistoryTableQuery contracts

createIndexTableQuery :: Contract -> (Text, Text, Text) -> Text
createIndexTableQuery contract (o, a, n) =
  let tableName = indexTableName o a n
      list = Map.toList $ contract^.storageDefs
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS " , tableNameToDoubleQuoteText tableName , " ("
        , csv $ ["record_id text", "address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
               "block_number text", "transaction_hash text", "transaction_sender text"] ++ tableColumns list
        , ",\n  PRIMARY KEY (record_id) );"
        ]

createHistoryTableQuery :: Contract -> (Text, Text, Text) -> Text
createHistoryTableQuery contract (o, a, n) =
  let tableName = historyTableName o a n
      list = Map.toList $ contract^.storageDefs
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ", tableNameToDoubleQuoteText tableName, " ("
        , csv $ ["record_id text", "address text NOT NULL", "\"chainId\" text NOT NULL", "block_hash text NOT NULL", "block_timestamp text",
                 "block_number text", "transaction_hash text NOT NULL", "transaction_sender text"]
                 ++ tableColumns list
        , ");"
        ]

addHistoryUnique :: (Text, Text, Text) -> [Text]
addHistoryUnique (o, a, n) =
  let (org, app, cname) = constructTableNameParameters o a n
      historyName' = HistoryTableName org app cname
      historyName = tableNameToDoubleQuoteText historyName'
      indexName = "index_" <> (escapeQuotes $ tableNameToText historyName')
  in  ["CREATE UNIQUE INDEX IF NOT EXISTS " <> 
        wrapDoubleQuotes indexName <>
        "\n  ON " <> 
        historyName <> 
        " (address, \"chainId\", block_hash, transaction_hash);",
      "ALTER TABLE " <> 
      historyName <> 
      " ADD PRIMARY KEY USING INDEX " <> 
      wrapDoubleQuotes indexName <> 
      ";"]

insertIndexTableQuery :: [ProcessedContract] -> Text
insertIndexTableQuery [] = error "insertIndexTableQuery: unhandled empty list"
insertIndexTableQuery contracts@(x:_) =
  let tableName = indexTableName
          (organization x)
          (application x)
          (contractName x)
      list = Map.toList $ Map.mapMaybe valueToSQLTextFilterContract $ contractData x
      keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst list
      baseVals = [ makeAccount
                 , tshow . address
                 , chain
                 , T.pack . keccak256ToHex . blockHash
                 , tshow . blockTimestamp
                 , tshow . blockNumber
                 , T.pack . keccak256ToHex . transactionHash
                 , tshow . transactionSender
                 ]
      vals = flip map contracts $ \row ->
        let rowList = Map.toList $ Map.mapMaybe valueToSQLTextFilterContract $ contractData row
         in wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList
      inserts = csv vals
   in T.concat
        [ "INSERT INTO "
        , tableNameToDoubleQuoteText tableName
        , " "
        , keySt
        , "\n  VALUES "
        , inserts
        , [r|
  ON CONFLICT (record_id) DO UPDATE SET
    record_id = excluded.record_id,
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender|]
        , if null list then "" else ",\n    "
        , tableUpsert $ map fst list
        , ";"
        ]

insertHistoryTableQuery :: [ProcessedContract] -> Text
insertHistoryTableQuery [] = error "insertHistoryTableQuery: unhandled empty list"
insertHistoryTableQuery contracts@(x:_) =
  let tableName = historyTableName
          (organization x)
          (application x)
          (contractName x)
      list = Map.toList . Map.mapMaybe valueToSQLText $ contractData x
      keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst list 
      baseVals = [ makeAccount
                 , tshow . address
                 , chain
                 , T.pack . keccak256ToHex . blockHash
                 , tshow . blockTimestamp
                 , tshow . blockNumber
                 , T.pack . keccak256ToHex . transactionHash
                 , tshow . transactionSender
                 ]
      vals = flip map contracts $ \row ->
        let rowList = Map.toList $ Map.mapMaybe valueToSQLText $ contractData row
         in wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList
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
  let (org, app, cname) = constructTableNameParameters
          (eventOrganization ev)
          (eventApplication ev)
          (eventContractName ev)
      eventTable = EventTableName org app cname (escapeQuotes $ eventName ev)
  
  eventAlreadyCreated <- isTableCreated globalsIORef eventTable
  if eventAlreadyCreated then 
    return Nothing
  else do
    setTableCreated globalsIORef eventTable $ eventFields ev
    return (Just $ createEventTableQuery ev) 

createEventTableQuery :: EventTable -> Text
createEventTableQuery ev =
  let (org, app, cname) = constructTableNameParameters
          (eventOrganization ev)
          (eventApplication ev)
          (eventContractName ev)
      tableName = EventTableName org app cname (escapeQuotes $ eventName ev)

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
                        -> [Action.Event]
                        -> ConduitM () Text m ()
insertExpandEventTables _ [] = return ()
insertExpandEventTables globalsIORef events = do
  expandEventTables globalsIORef events
  insertEventTables globalsIORef events

expandEventTables :: OutputM m
                  => IORef Globals
                  -> [Action.Event]
                  -> ConduitM () Text m ()
expandEventTables _ [] = return ()
expandEventTables globalsIORef (x:xs) = do
  let (org, app, cname) = constructTableNameParameters
          (T.pack $ Action.evContractOrganization x)
          (T.pack $ Action.evContractApplication x)
          (T.pack $ Action.evContractName x)
      tableName = EventTableName org app cname ( escapeQuotes $ T.pack $ Action.evName x)

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
      let extras = filter (not . flip elem cols) (map (T.pack . fst) $ Action.evArgs x)
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
                  -> [Action.Event]
                  -> ConduitM () Text m ()
insertEventTables globalsIORef events = do
  yieldMany . catMaybes =<< lift (mapM (insertEventTable globalsIORef) events)

insertEventTable :: OutputM m
                 => IORef Globals
                 -> Action.Event
                 -> m (Maybe Text)
insertEventTable globalsIORef ev = do
  let (org, app, cname) = constructTableNameParameters
          (T.pack $ Action.evContractOrganization ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
      eventTable = EventTableName org app cname (escapeQuotes $ T.pack $ Action.evName ev)

  eventExists <- isTableCreated globalsIORef eventTable
  if eventExists then return (Just $ insertEventTableQuery ev)
  else return Nothing

insertEventTableQuery :: Action.Event -> Text
insertEventTableQuery ev = 
 let (org, app, cname) = constructTableNameParameters
          (T.pack $ Action.evContractOrganization ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
     tableName = EventTableName org app cname (escapeQuotes $ T.pack $ Action.evName ev)

     cols = wrapAndEscapeDouble . map escapeQuotes $ ["id", "address"] ++ (map (T.pack . fst) $ Action.evArgs ev)
     vals = csv $ map (wrapSingleQuotes . escapeQuotes . T.pack . snd) $ Action.evArgs ev
 in T.concat
        [ "INSERT INTO "
        , tableNameToDoubleQuoteText tableName
        , " "
        , cols
        , " VALUES "
        , "( DEFAULT,\n" -- id, set by Postgres
        , wrapSingleQuotes $ tshow $ Action.evContractAccount ev
        , ",\n"
        , vals
        ,  " );"
        , "\n"--  ON CONFLICT DO NOTHING;"
        ]



------------------


--This is a temporary function that converts solidity types to a sample value...  I am just using this now to convert table creation from the old way (value based when values come through) to the new way (direct from the types when a CC is registered)
solidityTypeToSQLType :: VariableDeclF a -> Maybe Text
solidityTypeToSQLType VariableDecl{varType=SVMType.Bool} = Just "bool"
solidityTypeToSQLType VariableDecl{varType=SVMType.Int _ _} = Just "decimal"
solidityTypeToSQLType VariableDecl{varType=SVMType.String _} = Just "text"
solidityTypeToSQLType VariableDecl{varType=SVMType.Bytes _ _} = Just "text"
solidityTypeToSQLType VariableDecl{varType=SVMType.Address} = Just "text"
solidityTypeToSQLType VariableDecl{varType=SVMType.Account} = Just "text"
solidityTypeToSQLType VariableDecl{varType=SVMType.Array _ _} = Nothing -- Just "jsonb"
solidityTypeToSQLType VariableDecl{varType=SVMType.Mapping _ _ _} = Nothing -- Just "jsonb"
solidityTypeToSQLType VariableDecl{varType=SVMType.Label _} = Just "text"
--solidityTypeToSQLType VariableDecl{varType=SVMType.Label x} = Just $ "text references " <> T.pack x <> "(id)"
solidityTypeToSQLType VariableDecl{varType=SVMType.Struct _ _} = Just "jsonb"
solidityTypeToSQLType VariableDecl{varType=SVMType.Enum _ _ _} = Just "text"
solidityTypeToSQLType VariableDecl{varType=SVMType.Contract _} = Just "text"
--solidityTypeToSQLType x = error $ "undefined type in solidityTypeToSQLType: " ++ show (varType x)


------------------

solidityValueToText :: SolidityValue -> Text
solidityValueToText (SolidityValueAsString x) = escapeQuotes x
solidityValueToText (SolidityBool x)          = tshow x
solidityValueToText (SolidityNum x )          = tshow x
solidityValueToText (SolidityBytes x)         = escapeQuotes $ tshow x
solidityValueToText (SolidityArray x)         = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ encode x
solidityValueToText (SolidityObject x)        = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ encode x


valueToSQLTextFilterContract :: Value -> Maybe Text
valueToSQLTextFilterContract (ValueContract _) = Just "NULL"
valueToSQLTextFilterContract x = valueToSQLText x


valueToSQLText :: Value -> Maybe Text
valueToSQLText (SimpleValue (ValueBool x)) = Just $ wrapSingleQuotes $ tshow x
valueToSQLText (SimpleValue (ValueInt _ _ v)) = Just $ wrapSingleQuotes $ tshow v
valueToSQLText (SimpleValue (ValueString s)) = Just $ wrapSingleQuotes $ escapeQuotes s
valueToSQLText (SimpleValue (ValueAddress (Address 0))) = Just "NULL"
valueToSQLText (SimpleValue (ValueAddress (Address addr))) = Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSQLText (SimpleValue (ValueAccount acct)) = Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show acct
valueToSQLText (SimpleValue (ValueBytes _ bytes)) = Just $ wrapSingleQuotes $ escapeQuotes $ decodeUtf8 bytes
valueToSQLText (ValueEnum _ _ index) = Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show index
valueToSQLText (ValueContract acct) = Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show acct
valueToSQLText (ValueFunction _ _ _) = Nothing
valueToSQLText (ValueMapping _) = Nothing
valueToSQLText (ValueArrayFixed _ _) = Nothing
valueToSQLText (ValueArrayDynamic _) = Nothing
--valueToSQLText (ValueStruct namedItems) = Nothing


valueToSQLText x = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ x
