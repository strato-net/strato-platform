{-# LANGUAGE
    ConstraintKinds
  , FlexibleContexts
  , LambdaCase
  , OverloadedStrings
  , QuasiQuotes
  , RecordWildCards
  , ScopedTypeVariables
  , TemplateHaskell
#-}

module Slipstream.OutputData (
  outputData,
  outputData',
  OutputM,
  ProcessedMappingRow(..),
  insertEventTables,
  insertIndexTable,
  insertForeignKeys,
  insertMappingTable,
  insertAbstractTable,
  insertAbstractTableQuery,
  createIndexTable,
  createMappingTable,
  createHistoryTable,
  createAbstractTable,
  insertHistoryTable,
  createExpandEventTables,
  createExpandIndexTable,
  createForeignIndexesForJoins,
  createExpandAbstractTable,
  expandAbstractTable,
  expandAbstractContractTable,
  notifyPostgREST,
  createExpandHistoryTable,
  cirrusInfo,
  historyTableName
  ) where

import           BlockApps.Solidity.Value
import           Conduit
import           Control.Arrow                   ((***))
import           Control.Lens ((^.))
import           Control.Monad
import qualified Data.Aeson                      as Aeson
import           Data.Bifunctor                  (first)
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy            as BL
import qualified Data.Map.Strict                 as Map
import           Data.Maybe                      (catMaybes, listToMaybe, mapMaybe)
import           Data.Text                       (Text)
import qualified Data.Text                       as T
-- import qualified Data.Text.Encoding as TE
import           Data.Time
import           Data.List (nubBy, groupBy)
import           Data.Function (on)
import           Data.Text.Encoding              (decodeUtf8, decodeUtf8', encodeUtf8)
import qualified Data.ByteString.Base16          as Base16
-- import qualified Data.ByteString.Lazy.Char8 as BSL
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Protocol
import           Database.PostgreSQL.Typed.Query
import           Text.Format
import           Text.Printf
import           Text.RawString.QQ
import           UnliftIO.IORef
import           UnliftIO.Exception              (handle, catch, SomeException)

import           Bloc.Server.Utils   (partitionWith)
import           BlockApps.Logging
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import qualified Blockchain.Strato.Model.Event   as Action
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.CodePtr
import qualified BlockApps.Solidity.Value as V

import           Slipstream.Data.Action
import qualified Slipstream.Events as E
import           Slipstream.Globals
import           Slipstream.Metrics
import           Slipstream.Options
import           Slipstream.QueryFormatHelper
import           Slipstream.SolidityValue

import           SolidVM.Model.CodeCollection              hiding (contractName, contracts)
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type         as SVMType

newtype First b a = First { unFirst :: (a,b) }

instance Functor (First b) where
  fmap f (First (a,b)) = First (f a, b)

data ProcessedMappingRow = ProcessedMappingRow
  { address           :: Address
  , codehash          :: CodePtr
  , organization      :: Text
  , application       :: Text
  , contractname      :: Text
  , mapname           :: Text
  , chain             :: Text
  , blockHash         :: Keccak256
  , blockTimestamp    :: UTCTime
  , blockNumber       :: Integer
  , transactionHash   :: Keccak256
  , transactionSender :: Address
  , mapDataKey        :: V.Value
  , mapDataValue      :: V.Value
  } deriving (Show)

crashOnSQLError :: Bool
crashOnSQLError = False

type OutputM m = (MonadUnliftIO m, MonadLogger m)

fillEmptyEntries :: Functor f => [f Text] -> [f Text]
fillEmptyEntries = zipWith go [(1 :: Int)..]
  where go i = fmap (\t -> if T.null t then "val_" <> tshow i else t)

fillFirstEmptyEntries :: [(Text, a)] -> [(Text, a)]
fillFirstEmptyEntries = map unFirst . fillEmptyEntries . map First

tableColumns :: [(Text, SVMType.Type)] -> TableColumns
tableColumns = mapMaybe go . fillFirstEmptyEntries
  where go (x,y) =
          case solidityTypeToSQLType y of
            Nothing -> Nothing
            Just v -> Just $ wrapDoubleQuotes (escapeQuotes x) <> " " <> v

-- Considered partial because I'm assuming the TableColumns will always be in this format:
-- ["\"myCol1\" type1", "\"myCol2\" type2", "\"myCol3\" type3"]
partialParseTableColumns :: TableColumns -> [Text]
partialParseTableColumns = concat . mapM (fmap unwrapDoubleQuotes . listToMaybe . T.words)

makeAccount :: Text -> Address -> Text
makeAccount "" addr = tshow $ addr
makeAccount chain addr = T.concat [
  tshow $ addr,
  ":",
  chain
  ]

makeAccountM:: ProcessedMappingRow -> Text
makeAccountM ProcessedMappingRow{chain="", address=addr} = tshow $ addr
makeAccountM ProcessedMappingRow{chain=chain, address=addr} = T.concat [
  tshow $ addr,
  ":",
  chain
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

dbQueryCatchError' :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> (Text, Maybe (IORef Globals,TableName,TableColumns)) -> m ()
dbQueryCatchError' conn (insrt, b) = handle (handlePostgresError' b) $ dbQuery conn insrt

dbQueryCatchError :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQueryCatchError conn insrt = handle handlePostgresError $ dbQuery conn insrt

dbQuery :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQuery conn insrt = do
  $logDebugS "outputData" insrt
  liftIO . void . pgQuery conn . rawPGSimpleQuery $! encodeUtf8 insrt

handlePostgresError' :: (MonadLogger m, MonadIO m) => Maybe (IORef Globals,TableName,TableColumns) -> SomeException -> m ()
handlePostgresError' myStuff e =
  case myStuff of
    Nothing -> handlePostgresError e
    Just (x,y,z) -> do
      setTableCreated x y z
      handlePostgresError e
      --setTableCreated globalsIORef tableName $ cols



handlePostgresError :: MonadLogger m => SomeException -> m ()
handlePostgresError e =
  if crashOnSQLError
  then error . show $ e
    else $logErrorLS "handlePGError" e

outputData' :: OutputM m
           => PGConnection
           -> ConduitM () (Text, Maybe (IORef Globals,TableName,TableColumns)) m a
           -> m a
outputData' conn c = runConduit $ c `fuseUpstream` mapM_C (dbQueryCatchError' conn)


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

baseMappingColumns :: TableColumns
baseMappingColumns = [ "record_id"
              , "address"
              , "chainId"
              , "block_hash"
              , "block_timestamp"
              , "block_number"
              , "transaction_hash"
              , "transaction_sender"
              , "contract_name"
              , "mapname"
              ]

baseAbstractColumns :: TableColumns
baseAbstractColumns = [ "record_id"
              , "address"
              , "chainId"
              , "block_hash"
              , "block_timestamp"
              , "block_number"
              , "transaction_hash"
              , "transaction_sender"
              , "contract_name"
              , "data"
              ]

baseTableColumns :: TableColumns
baseTableColumns = baseColumns

baseMappingTableColumns :: TableColumns
baseMappingTableColumns = baseMappingColumns

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

abstractTableName :: Text -> Text -> Text -> TableName
abstractTableName o a n = uncurry3 AbstractTableName $ constructTableNameParameters o a n

mappingTableName :: Text -> Text -> Text -> Text -> TableName
mappingTableName o a n m =
  let (o', a', n') = constructTableNameParameters o a n
   in MappingTableName o' a' n' m

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

createExpandAbstractTable
  :: OutputM m
  => IORef Globals
  -> Contract
  -> (Text, Text, Text)
  -> ConduitM () Text m [ForeignKeyInfo]
createExpandAbstractTable g c nameParts = do
  creationForeignKeys <- createAbstractTable g c nameParts
  expansionForeignKeys <- expandAbstractTable g c nameParts
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
  -> ConduitM () (Text, Maybe (IORef Globals,TableName,TableColumns)) m ()
createExpandHistoryTable g c nameParts = do
    createHistoryTable' g c nameParts
    expandHistoryTable g c nameParts

getDeferredForeignKeys :: TableName -> Contract -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeys tableName c o a =
--    deferredForeignKeys' <- fmap concat $
--      forM (Map.toList $ cc^.contracts) $ \(nameString, c) ->

  flip map [(theName, x) | (theName, VariableDecl{_varType=SVMType.Contract x}) <- (Map.toList $ c^.storageDefs)] $ \(theName, x) ->
    ForeignKeyInfo {
      tableName=tableName,
      columnName=labelToText theName,
      foreignTableName=indexTableName o a $ labelToText x
      }

getDeferredForeignKeysForMapping :: TableName -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeysForMapping tableName o a =
    [ForeignKeyInfo {
      tableName=tableName,
      columnName=T.pack "record_id",
      foreignTableName=indexTableName o a $ (\case
                                                MappingTableName _ _ n' _ -> n'
                                                _ -> "") tableName
      }]

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
    let list = tableColumns $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract^.storageDefs
    setTableCreated globalsIORef tableName list
    return $ getDeferredForeignKeys tableName contract o a

createAbstractTable :: OutputM m
                 => IORef Globals
                 -> Contract
                 -> (Text, Text, Text)
                 -> ConduitM () Text m [ForeignKeyInfo]
createAbstractTable globalsIORef contract (o, a, n) = do
  let tableName = abstractTableName o a n
  tableExists <- isTableCreated globalsIORef tableName
  if tableExists
  then return []
  else do
    let list = tableColumns $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract^.storageDefs
    yield $ createAbstractTableQuery contract (o,a,n)
    setTableCreated globalsIORef tableName (list++ ["\"data\" jsonb"])
    return $ getDeferredForeignKeys tableName contract o a

-- if flag from solidvm that it is a record, vmevent
createMappingTable :: OutputM m
                 => IORef Globals
                 -> (Text, Text, Text)
                 -> Text
                 -> ConduitM () Text m [ForeignKeyInfo]
createMappingTable globalsIORef (o, a, n) m = do
  let tableName = mappingTableName o a n m
  tableExists <- isTableCreated globalsIORef tableName

  $logInfoLS "createMappingTable/mappingTableExists" (tableName, tableExists)
  if tableExists
  then return []
  else do
    incNumMappingTables
    yield $ (createMappingTableQuery (o, a, n, m))
    let list = ["key","value"]
    setTableCreated globalsIORef tableName list
    return $ getDeferredForeignKeysForMapping tableName o a

createHistoryTable' :: OutputM m
                   => IORef Globals
                   -> Contract
                   -> (Text, Text, Text)
                   -> ConduitM () (Text, Maybe (IORef Globals,TableName,TableColumns)) m ()
createHistoryTable' globalsIORef contract (o, a, n) = do
  let tableName = historyTableName o a n
  tableExists <- isTableCreated globalsIORef tableName

  $logInfoLS "createHistoryTable/tableExists" (tableName, tableExists)

  when (not tableExists) $ do
    incNumHistoryTables
    yield $ ((createHistoryTableQuery contract (o, a, n)), Nothing)
    yieldMany $ map (\x -> (x, Nothing)) (addHistoryUnique (o, a, n))
    let list = tableColumns $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract^.storageDefs
    setTableCreated globalsIORef tableName list




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
    let list = tableColumns $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract^.storageDefs
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

expandAbstractTable :: OutputM m
                 => IORef Globals
                 -> Contract
                 -> (Text, Text, Text)
                 -> ConduitM () Text m [ForeignKeyInfo]
expandAbstractTable globalsIORef contract (o, a, n)= do
  let tableName = abstractTableName o a n
  expandAbstractContractTable globalsIORef contract tableName

expandHistoryTable :: OutputM m =>
                      IORef Globals ->
                      Contract ->
                      (Text, Text, Text) ->
                      ConduitM () (Text, Maybe (IORef Globals,TableName,TableColumns)) m ()
expandHistoryTable globalsIORef contract (o, a, n) = do
  let tableName = historyTableName o a n
  _ <- expandContractTable' globalsIORef contract tableName
  return ()

expandContractTable' :: OutputM m
                    => IORef Globals
                    -> Contract
                    -> TableName
                    -> ConduitM () (Text, Maybe (IORef Globals,TableName,TableColumns)) m [ForeignKeyInfo]
expandContractTable' globalsIORef contract tableName = do
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
      let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract^.storageDefs
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
        yield $ ((expandTableQuery tableName extraTableColumns), Just (globalsIORef, tableName, cols))
      return $
        case tableName of
          IndexTableName o a n ->
            flip map
            [(colName, foreignName) | (colName, SVMType.Contract foreignName) <- extras] $ \(colName, foreignName) ->
            ForeignKeyInfo {
              tableName = tableName,
              columnName = colName,
              foreignTableName = let a' = case a of; "" -> n; _ -> a
                                 in indexTableName o a' $ labelToText foreignName
              }
          _ -> []


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
      let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract^.storageDefs
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
            [(colName, foreignName) | (colName, SVMType.Contract foreignName) <- extras] $ \(colName, foreignName) ->
            ForeignKeyInfo {
              tableName = tableName,
              columnName = colName,
              foreignTableName = let a' = case a of; "" -> n; _ -> a
                                 in indexTableName o a' $ labelToText foreignName
              }
          _ -> []

expandAbstractContractTable :: OutputM m
                    => IORef Globals
                    -> Contract
                    -> TableName
                    -> ConduitM () Text m [ForeignKeyInfo]
expandAbstractContractTable globalsIORef contract tableName = do
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
      let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract^.storageDefs
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
          AbstractTableName o a n ->
            flip map
            [(colName, foreignName) | (colName, SVMType.Contract foreignName) <- extras] $ \(colName, foreignName) ->
            ForeignKeyInfo {
              tableName = tableName,
              columnName = colName,
              foreignTableName = let a' = case a of; "" -> n; _ -> a
                                 in abstractTableName o a' $ labelToText foreignName
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
                 => [E.ProcessedContract]
                 -> ConduitM () Text m ()
insertIndexTable [] = error "insertIndexTable: unhandled empty list"
insertIndexTable contracts = yieldMany $ insertIndexTableQuery contracts

insertMappingTable :: OutputM m
                 => [ProcessedMappingRow]
                 -> ConduitM () Text m ()
insertMappingTable [] = error "insertMappingTable: unhandled empty list"
insertMappingTable maps = do
  let newMaps = nubBy ((==) `on` mapDataKey) maps
  $logInfoS "insertMappingTable" $ T.pack $ show newMaps
  let grouped = (groupBy ((==) `on` mapname) newMaps)
      results  = concat $ map insertMappingTableQuery grouped
  yieldMany $ results

insertForeignKeys :: (MonadLogger m, MonadUnliftIO m) =>
                     PGConnection -> [E.ProcessedContract] -> m ()
insertForeignKeys conn contracts = do
  forM_ contracts $ \c@E.ProcessedContract { organization = org, application = app, contractName= cName, contractData = contractData } -> do
    let tableName = indexTableName
                            (org)
                            (app)
                            (cName)

    --There are still reasons why a foreign key insertion might fail
    --  1. The field type was changed in a solidity contract version update
    --  2. solidity uses inheritance, and the foreign key points to the parent table
    --  3. The user just sets a variable to a made up invalid address (0x1234)
    --When an invalid foreign pointer is set, STRATO's stated behavior will be to set the value to null
    forM_ [(n, a) | (n, ValueContract a) <- Map.toList $ contractData] $ \(theName, acct) -> do
      dbQuery conn $
            "UPDATE " <>
            tableNameToDoubleQuoteText tableName <>
            " SET " <>
            wrapDoubleQuotes theName <>
            "=" <>
            wrapSingleQuotes (escapeQuotes $ T.pack $ show acct) <>
            " WHERE record_id=" <>
            wrapSingleQuotes (makeAccount (E.chain c) (E.address c)) <>
            ";"
      `catch` \(e :: SomeException) -> do
            $logInfoS "insertHistoryTable" $ T.pack $ "foreign key update failed, value will be set to null: " ++ show e
            dbQueryCatchError conn $
              "UPDATE " <>
              tableNameToDoubleQuoteText tableName <>
              " SET " <>
              wrapDoubleQuotes theName <>
              "=null WHERE record_id=" <>
              wrapSingleQuotes (makeAccount (E.chain c) (E.address c))

insertHistoryTable :: OutputM m
                   => [E.ProcessedContract]
                   -> ConduitM () Text m ()
insertHistoryTable [] = return () --no data, do nothing
insertHistoryTable contracts@(E.ProcessedContract { organization = org, application = app, contractName= cName }:_) = do
  let tableName = historyTableName
          (org)
          (app)
          (cName)
  $logInfoS "insertHistoryTable" $ T.pack $ "Inserting row in history table for: " ++ show tableName
  yieldMany $ insertHistoryTableQuery contracts

insertAbstractTable :: OutputM m
                 => [(E.ProcessedContract, T.Text, TableColumns)]
                 -> ConduitM () Text m ()
insertAbstractTable [] = pure ()
insertAbstractTable cs@((E.ProcessedContract { organization = org, application = app, contractName = cName }, _, _):_) = do
  let tableName = indexTableName org app cName
  $logInfoS "insertAbstractTable" $ T.pack $ "Inserting row in abstract table for: " ++ show tableName ++ " (and potentially others)"
  yieldMany $ insertAbstractTableQuery cs


createIndexTableQuery :: Contract -> (Text, Text, Text) -> Text
createIndexTableQuery contract (o, a, n) =
  let tableName = indexTableName o a n
      list = Map.toList $ contract^.storageDefs
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS " , tableNameToDoubleQuoteText tableName , " ("
        , csv $ ["record_id text", "address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
               "block_number text", "transaction_hash text", "transaction_sender text"] ++ tableColumns (map (\(x, y) -> (labelToText x, y ^. varType)) list)
        , ",\n  PRIMARY KEY (record_id) );"
        ]

createMappingTableQuery :: (Text, Text, Text, Text) -> Text
createMappingTableQuery (o, a, n, m) =
  let tableName = mappingTableName o a n m
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS " , tableNameToDoubleQuoteText tableName , " ("
        , csv $ ["record_id text", "address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
               "block_number text", "transaction_hash text", "transaction_sender text", "contract_name text", "mapname text","key text", "value text"]
        , ",\n  PRIMARY KEY (record_id, key));"
        ]

createAbstractTableQuery ::  Contract -> (Text, Text, Text) -> Text
createAbstractTableQuery contract (o, a, n) =
  let tableName = abstractTableName o a n
      list = Map.toList $ contract^.storageDefs
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS " , tableNameToDoubleQuoteText tableName , " ("
        , csv $ ["record_id text", "address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
               "block_number text", "transaction_hash text", "transaction_sender text", "contract_name text", "data jsonb"] ++ tableColumns (map (\(x, y) -> (labelToText x, y ^. varType)) list)
        , ",\n  PRIMARY KEY (record_id));"
        ]

createHistoryTableQuery :: Contract -> (Text, Text, Text) -> Text
createHistoryTableQuery contract (o, a, n) =
  let tableName = historyTableName o a n
      list = Map.toList $ contract^.storageDefs
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ", tableNameToDoubleQuoteText tableName, " ("
        , csv $ ["record_id text", "address text NOT NULL", "\"chainId\" text NOT NULL", "block_hash text NOT NULL", "block_timestamp text",
                 "block_number text", "transaction_hash text NOT NULL", "transaction_sender text"]
                 ++ tableColumns (map (\(x, y) -> (labelToText x, y ^. varType)) list)
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

insertIndexTableQuery :: [E.ProcessedContract] -> [Text]
insertIndexTableQuery [] = error "insertIndexTableQuery: unhandled empty list"
insertIndexTableQuery cs = concat $
  let cs' = (\c@E.ProcessedContract{contractData = contractData} -> (c, Map.toList $ Map.mapMaybe valueToSQLTextFilterContract $ contractData)) <$> cs
   in flip map (map snd $ partitionWith (length . snd) cs') $ \case
        [] -> []
        contracts@((x,list):_) ->
          let tableName = indexTableName
                  (E.organization x)
                  (E.application x)
                  (E.contractName x)
              keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst list
              baseVals = [ \c -> makeAccount (E.chain c) (E.address c)
                         , tshow . E.address
                         , E.chain
                         , T.pack . keccak256ToHex . E.blockHash
                         , tshow . E.blockTimestamp
                         , tshow . E.blockNumber
                         , T.pack . keccak256ToHex . E.transactionHash
                         , tshow . E.transactionSender
                         ]
              vals = flip map contracts $ \(row, rowList) ->
                wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList

              inserts = csv vals
           in (:[]) $ T.concat
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

insertMappingTableQuery :: [ProcessedMappingRow] -> [Text]
insertMappingTableQuery [] = error "insertMappingTableQuery: unhandled empty list"
insertMappingTableQuery ms = concat $
  let ms' = (\m -> (m, Map.toList $ Map.mapMaybe valueToSQLText $ Map.fromList [("key", mapDataKey m), ("value", mapDataValue m)])) <$> ms
   in flip map (map snd $ partitionWith (length . snd) ms') $ \case
        [] -> []
        mappings@((x,list):_) ->
          let tableName = mappingTableName
                  (organization x)
                  (application x)
                  (contractname x)
                  (mapname x)
              keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseMappingTableColumns ++ map fst (fillFirstEmptyEntries list)
              baseVals = [ makeAccountM
                         , tshow . address
                         , chain
                         , T.pack . keccak256ToHex . blockHash
                         , tshow . blockTimestamp
                         , tshow . blockNumber
                         , T.pack . keccak256ToHex . transactionHash
                         , tshow . transactionSender
                         , contractname
                         , mapname
                         ]
              vals = flip map mappings $ \(row, rowList) ->
                wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList
              inserts = csv vals
           in (:[]) $ T.concat
                [ "INSERT INTO "
                , tableNameToDoubleQuoteText tableName
                , " "
                , keySt
                , "\n  VALUES "
                , inserts
                , [r|
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
    value = excluded.value|]
                , ";"
                ]

insertAbstractTableQuery :: [(E.ProcessedContract, T.Text, TableColumns)] -> [Text]
insertAbstractTableQuery [] = error "insertAbstractTableQuery: unhandled empty list"
insertAbstractTableQuery cs = concat $
  let cs' = (\(c@E.ProcessedContract{contractData = contractData}, ab, abColumns) -> ((c, Map.mapMaybe valueToSQLTextFilterContract $ contractData), (ab, abColumns))) <$> cs
   in flip map (map snd $ partitionWith ((length . snd) *** fst) cs') $ \case
        [] -> []
        contracts@(((x, _), (abTableName, abColumns)):_) ->
          let contractTableName = indexTableName
                  (E.organization x)
                  (E.application x)
                  (E.contractName x)  
              list = filter (`notElem` baseAbstractColumns) abColumns
              keySt  = wrapAndEscapeDouble $ escapeQuotes <$> (baseAbstractColumns ++ list)
              baseVals = [ \c -> makeAccount (E.chain c) (E.address c)
                         , tshow . E.address
                         , E.chain
                         , T.pack . keccak256ToHex . E.blockHash
                         , tshow . E.blockTimestamp
                         , tshow . E.blockNumber
                         , T.pack . keccak256ToHex . E.transactionHash
                         , tshow . E.transactionSender
                         ]
              vals = flip map contracts $ \((row, contractColumns),_) ->
                wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ [wrapSingleQuotes (tableNameToText contractTableName)] ++ (map snd $ Map.toList (Map.filterWithKey (\k _ -> k `elem` abColumns) contractColumns)) ++ [wrapSingleQuotes $ T.pack $ show $ Aeson.encode $ MapWrapper $ aesonHelper $ Map.filterWithKey (\k _ -> k `notElem` abColumns) contractColumns]
              inserts = csv vals
           in (:[]) $ T.concat
                [ "INSERT INTO "
                , abTableName
                , " "
                , keySt
                , "\n  VALUES "
                , inserts
                , [r|
  ON CONFLICT (record_id) DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    contract_name = excluded.contract_name|]
                , if null list then "" else ",\n    "
                , tableUpsert $ list
                , ";"
                ]


insertHistoryTableQuery :: [E.ProcessedContract] -> [Text]
insertHistoryTableQuery [] = error "insertHistoryTableQuery: unhandled empty list"
insertHistoryTableQuery cs = concat $
  let cs' = (\c -> (c, Map.toList $ Map.mapMaybe valueToSQLText $ E.contractData c)) <$> cs
   in flip map (map snd $ partitionWith (length . snd) cs') $ \case
        [] -> []
        contracts@((x,list):_) ->
          let tableName = historyTableName
                  (E.organization x)
                  (E.application x)
                  (E.contractName x)
              keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst (fillFirstEmptyEntries list)
              baseVals = [ \c -> makeAccount (E.chain c) (E.address c)
                         , tshow . E.address
                         , E.chain
                         , T.pack . keccak256ToHex . E.blockHash
                         , tshow . E.blockTimestamp
                         , tshow . E.blockNumber
                         , T.pack . keccak256ToHex . E.transactionHash
                         , tshow . E.transactionSender
                         ]
              vals = flip map contracts $ \(row, rowList) ->
                wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList
              inserts = csv vals
           in (:[]) . T.concat $
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
createExpandEventTables :: OutputM m
                        => IORef Globals
                        -> Contract
                        -> (Text, Text, Text)
                        -> ConduitM () Text m ()
createExpandEventTables globalsIORef c nameParts = mapM_ go . Map.toList $ c ^. events
  where go (evName, ev) = do
          createEventTable globalsIORef nameParts evName ev
          expandEventTable globalsIORef nameParts evName ev


createEventTable :: OutputM m
                 => IORef Globals
                 -> (Text, Text, Text)
                 -> SolidString
                 -> Event
                 -> ConduitM () Text m ()
createEventTable globalsIORef (o, a, n) evName ev = do
  let (org, app, cname) = constructTableNameParameters o a n
      eventTable = EventTableName org app cname (escapeQuotes $ labelToText evName)

  eventAlreadyCreated <- isTableCreated globalsIORef eventTable
  unless eventAlreadyCreated $ do
    setTableCreated globalsIORef eventTable $ tableColumns [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries $ ev ^. eventLogs]
    yield $ createEventTableQuery eventTable ev

createEventTableQuery :: TableName -> Event -> Text
createEventTableQuery tableName ev =
  let cols = ev ^. eventLogs
  in T.concat
      [ "CREATE TABLE IF NOT EXISTS "
      , tableNameToDoubleQuoteText tableName
      ," ("
      , csv $ ["id SERIAL NOT NULL", "record_id text", "address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
               "block_number text", "transaction_hash text", "transaction_sender text"] ++ tableColumns (map (\(x, y) -> (x, indexedTypeType y)) cols)
      , ");"
      ]

expandEventTable :: OutputM m
                 => IORef Globals
                 -> (Text, Text, Text)
                 -> SolidString
                 -> Event
                 -> ConduitM () Text m ()
expandEventTable globalsIORef (o, a, n) evName ev = do
  let (org, app, cname) = constructTableNameParameters o a n
      tableName = EventTableName org app cname (escapeQuotes $ labelToText evName)

  columns <- getTableColumns globalsIORef tableName
  case columns of
    Nothing -> do
      $logErrorLS "expandEventTable" $ T.concat
          [ "Table "
          , (tableNameToText tableName)
          , " does not exist, but we are trying to expand it?"
          ]
      pure ()
    Just cols -> do
      let allTableCols = tableColumns [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries $ ev ^. eventLogs]
          extrasWithType = filter (`notElem` cols) allTableCols
      unless (null extrasWithType) $ do
        $logInfoS "expandEventTable" . T.pack $ "We just got new fields for a contract that already has a table!"
        setTableCreated globalsIORef tableName allTableCols
        $logInfoS "expandEventTable" $ T.concat
            [ "Adding columns to "
            , (tableNameToText tableName)
            , " for the following new fields: "
            , T.intercalate ", " extrasWithType
            ]
        yield $ expandTableQuery tableName extrasWithType

insertEventTables :: OutputM m
                  => IORef Globals
                  -> [AggregateEvent]
                  -> ConduitM () Text m ()
insertEventTables globalsIORef evs = do
  yieldMany . catMaybes =<< lift (mapM (insertEventTable globalsIORef) evs)

insertEventTable :: OutputM m
                 => IORef Globals
                 -> AggregateEvent
                 -> m (Maybe Text)
insertEventTable globalsIORef agEv@AggregateEvent { eventEvent = ev } = do
  let (org, app, cname) = constructTableNameParameters
          (T.pack $ Action.evContractOrganization ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
      eventTable = EventTableName org app cname (escapeQuotes $ T.pack $ Action.evName ev)

  eventExists <- isTableCreated globalsIORef eventTable
  let q = insertEventTableQuery agEv
  $logInfoS "insertEventTable" q
  if eventExists then return (Just q)
  else return Nothing

insertEventTableQuery :: AggregateEvent -> Text
insertEventTableQuery agEv@AggregateEvent{ eventEvent = ev } =
 let (org, app, cname) = constructTableNameParameters
          (T.pack $ Action.evContractOrganization ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
     tableName = EventTableName org app cname (escapeQuotes $ T.pack $ Action.evName ev)
     filledArgs = map fst . fillFirstEmptyEntries . map (first T.pack) $ Action.evArgs ev
     keySt  = wrapAndEscapeDouble . map escapeQuotes $ ("id":baseTableColumns) ++ filledArgs
     baseVals = [ \e -> makeAccount (T.pack . maybe "" format $ (Action.evContractAccount $ eventEvent e) ^. accountChainId) ((Action.evContractAccount $ eventEvent e) ^. accountAddress)
                , tshow . _accountAddress . Action.evContractAccount . eventEvent
                , T.pack . maybe "" format . _accountChainId . Action.evContractAccount . eventEvent
                , T.pack . keccak256ToHex . eventBlockHash
                , tshow . eventBlockTimestamp
                , tshow . eventBlockNumber
                , T.pack . keccak256ToHex . eventTxHash
                , tshow . eventTxSender
                ]
     vals = csv $ map (wrapSingleQuotes . escapeQuotes . ($ agEv)) baseVals ++ map (wrapSingleQuotes . T.pack . snd) (Action.evArgs ev)
  in T.concat $
       [ "INSERT INTO "
       , tableNameToDoubleQuoteText tableName
       , " "
       , keySt
       , "\n  VALUES ( DEFAULT,\n"
       , vals
       , " )\n  ON CONFLICT DO NOTHING;"
       ]


------------------


--This is a temporary function that converts solidity types to a sample value...  I am just using this now to convert table creation from the old way (value based when values come through) to the new way (direct from the types when a CC is registered)
solidityTypeToSQLType :: SVMType.Type -> Maybe Text
solidityTypeToSQLType SVMType.Bool = Just "bool"
solidityTypeToSQLType (SVMType.Int _ _) = Just "decimal"
solidityTypeToSQLType (SVMType.String _) = Just "text"
solidityTypeToSQLType (SVMType.Bytes _ _) = Just "text"
solidityTypeToSQLType (SVMType.UserDefined _ _) = Just "text"
solidityTypeToSQLType (SVMType.Fixed _ _) = Just "fixed"
solidityTypeToSQLType (SVMType.Address _) = Just "text"
solidityTypeToSQLType (SVMType.Account _) = Just "text"
solidityTypeToSQLType (SVMType.Array _ _) = Nothing -- Just "jsonb"
solidityTypeToSQLType (SVMType.Mapping _ _ _) = Nothing -- Just "jsonb"
solidityTypeToSQLType (SVMType.UnknownLabel _ _) = Just "text"
--solidityTypeToSQLType (SVMType.UnknownLabel x) = Just $ "text references " <> T.pack x <> "(id)"
solidityTypeToSQLType (SVMType.Struct _ _) = Just "jsonb"
solidityTypeToSQLType (SVMType.Enum _ _ _) = Just "text"
solidityTypeToSQLType (SVMType.Contract _) = Just "text"
solidityTypeToSQLType (SVMType.Error _ _) = Just "text"
solidityTypeToSQLType SVMType.Variadic = error "type (variadic) is not an indexable type"
--solidityTypeToSQLType x = error $ "undefined type in solidityTypeToSQLType: " ++ show (varType x)


------------------

solidityValueToText :: SolidityValue -> Text
solidityValueToText (SolidityValueAsString x) = escapeQuotes x
solidityValueToText (SolidityBool x)          = tshow x
solidityValueToText (SolidityNum x )          = tshow x
solidityValueToText (SolidityBytes x)         = escapeQuotes $ tshow x
solidityValueToText (SolidityArray x)         = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ Aeson.encode x
solidityValueToText (SolidityObject x)        = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ Aeson.encode x


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
valueToSQLText (SimpleValue (ValueBytes _ bytes)) = Just $ wrapSingleQuotes $ escapeQuotes $  case decodeUtf8' bytes of
  Left _ -> decodeUtf8 $ Base16.encode bytes
  Right x -> x
valueToSQLText (ValueEnum _ _ index) = Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show index
valueToSQLText (ValueContract acct) = Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show acct
valueToSQLText (ValueFunction _ _ _) = Nothing
valueToSQLText (ValueMapping _) = Nothing
valueToSQLText (ValueArrayFixed _ _) = Nothing
valueToSQLText (ValueArrayDynamic _) = Nothing
--valueToSQLText (ValueStruct namedItems) = Nothing


valueToSQLText x = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ x
