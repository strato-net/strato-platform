{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE MonoLocalBinds  #-}
{-# LANGUAGE BlockArguments #-}
{-# LANGUAGE DataKinds #-}


module Slipstream.OutputData (
  outputData,
  outputData',
  OutputM,
  ProcessedMappingRow(..),
  insertEventTables,
  insertIndexTable,
  insertForeignKeys,
  insertMappingTable,
  insertMappingTableQuery,
  insertAbstractTable,
  insertAbstractTableQuery,
  insertHistoryAbstractTable,
  createIndexTable,
  createMappingTable,
  insertHistoryTable,
  createExpandEventTables,
  createExpandIndexTable,
  createForeignIndexesForJoins,
  createExpandAbstractTable,
  expandAbstractTable,
  expandAbstractContractTable,
  notifyPostgREST,
  createExpandHistoryTable,
  updateForeignKeysFromNULLAbstract,
  updateForeignKeysFromNULLIndex,
  cirrusInfo,
  historyTableName,
  getTableColumnAndType
  ) where


import           BlockApps.Solidity.Value as V
import           Conduit
-- import           Control.Arrow                   ((***))
import           Control.Lens ((^.))
import           Control.Monad
import qualified Data.Aeson                      as Aeson
import           Data.Bool                       (bool)
import qualified Data.Set as Set
import qualified Data.ByteString.Base16         as Base16
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy            as BL
import qualified Data.Map.Strict                 as Map
import           Data.Maybe                      (catMaybes)
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Traversable                (for)
import           Bloc.Server.Utils               (partitionWith)
import           BlockApps.Logging
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Event   as Action
import           Blockchain.Strato.Model.Keccak256
import           Data.Bifunctor                  (first)
import           Data.Function                   (on)
import           Data.List                       (groupBy, nubBy)
import           Data.Text.Encoding              (decodeUtf8, decodeUtf8', encodeUtf8)
import           Data.Time
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Protocol
import           Database.PostgreSQL.Typed.Query
import           Slipstream.Data.Action
import qualified Slipstream.Events               as E
import           Slipstream.Globals
import           Slipstream.Metrics
import           Slipstream.Options
import           Slipstream.QueryFormatHelper
import           Slipstream.SolidityValue
import           SolidVM.Model.CodeCollection    hiding (contractName, contracts, parents)
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type              as SVMType
import           Text.Printf
import           Text.RawString.QQ
import           Text.Tools                      
import           UnliftIO.Exception              (SomeException, catch, handle)
import           UnliftIO.IORef

newtype First b a = First {unFirst :: (a, b)}

instance Functor (First b) where
  fmap f (First (a, b)) = First (f a, b)


data ProcessedMappingRow = ProcessedMappingRow
  { address :: Address,
    codehash :: CodePtr,
    creator :: Text,
    application :: Text,
    contractname :: Text,
    mapname :: Text,
    blockHash :: Keccak256,
    blockTimestamp :: UTCTime,
    blockNumber :: Integer,
    transactionHash :: Keccak256,
    transactionSender :: Address,
    mapDataKey :: V.Value,
    mapDataValue :: V.Value
  }
  deriving (Show)

crashOnSQLError :: Bool
crashOnSQLError = False

type OutputM m = (MonadUnliftIO m, MonadLogger m)

fillEmptyEntries :: Functor f => [f Text] -> [f Text]
fillEmptyEntries = zipWith go [(1 :: Int) ..]
  where
    go i = fmap (\t -> if T.null t then "val_" <> tshow i else t)

fillFirstEmptyEntries :: [(Text, a)] -> [(Text, a)]
fillFirstEmptyEntries = map unFirst . fillEmptyEntries . map First

getTableColumnAndType :: CodeCollectionF () -> [(Text, SVMType.Type)] -> [(T.Text, T.Text)]
getTableColumnAndType (CodeCollection ccs _ _ _ _ _ _ _) = concatMap go . fillFirstEmptyEntries
  where
    go :: (Text, SVMType.Type) -> [(T.Text, T.Text)]
    go (x, y) = 
      case solidityTypeToSQLType y of
        Nothing -> []
        Just v -> 
          let defaultColumn = (columnName x, v)
          in case y of
            SVMType.UnknownLabel s _ -> case (Map.member s ccs) of 
              True ->
                [ defaultColumn,
                  (columnName (x <> "_fkey"), v)
                ]
              _ -> [defaultColumn]
            _ -> [defaultColumn]

    columnName :: Text -> Text
    columnName x = wrapDoubleQuotes (escapeQuotes x)

-- Considered partial because I'm assuming the TableColumns will always be in this format:
-- ["\"myCol1\" type1", "\"myCol2\" type2", "\"myCol3\" type3"]

makeAccount :: Text -> Address -> Text
makeAccount "" addr = tshow $ addr
makeAccount chain addr =
  T.concat
    [ tshow $ addr,
      ":",
      chain
    ]

tableUpsert :: [Text] -> Text
tableUpsert = csv . map go
  where
    go x =
      let y = wrapDoubleQuotes $ escapeQuotes x
       in wrap1 y " = excluded."

cirrusInfo :: PGDatabase
cirrusInfo =
  PGDatabase
    { pgDBAddr = Left (flags_pghost, show flags_pgport),
      pgDBTLS = TlsDisabled,
      pgDBUser = BC.pack flags_pguser :: B.ByteString,
      pgDBPass = BC.pack flags_password :: B.ByteString,
      pgDBName = BC.pack flags_database :: B.ByteString,
      pgDBDebug = False,
      pgDBLogMessage = runLoggingT . $logInfoLS "pglog" . PGError,
      pgDBParams = [("Timezone", "UTC")]
    }

dbQueryCatchError' :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> (Text, Maybe (IORef Globals, TableName, TableColumns)) -> m ()
dbQueryCatchError' conn (insrt, b) = handle (handlePostgresError' b) $ dbQuery conn insrt

dbQueryCatchError :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQueryCatchError conn insrt = handle handlePostgresError $ dbQuery conn insrt

dbQuery :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQuery conn insrt = do
  $logDebugS "outputData" insrt
  liftIO . void . pgQuery conn . rawPGSimpleQuery $! encodeUtf8 insrt

handlePostgresError' :: (MonadLogger m, MonadIO m) => Maybe (IORef Globals, TableName, TableColumns) -> SomeException -> m ()
handlePostgresError' myStuff e =
  case myStuff of
    Nothing -> handlePostgresError e
    Just (x, y, z) -> do
      setTableCreated x y z
      handlePostgresError e

--setTableCreated globalsIORef tableName $ cols

handlePostgresError :: MonadLogger m => SomeException -> m ()
handlePostgresError e =
  if crashOnSQLError
    then error . show $ e
    else $logErrorLS "handlePGError" e

outputData' ::
  OutputM m =>
  PGConnection ->
  ConduitM () (Text, Maybe (IORef Globals, TableName, TableColumns)) m a ->
  m a
outputData' conn c = runConduit $ c `fuseUpstream` mapM_C (dbQueryCatchError' conn)

outputData ::
  OutputM m =>
  PGConnection ->
  ConduitM () Text m a ->
  m a
outputData conn c = runConduit $ c `fuseUpstream` mapM_C (dbQueryCatchError conn)

baseColumns :: TableColumns
baseColumns =
  [ "address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender"
  ]

baseMappingColumns :: TableColumns
baseMappingColumns =
  [ "address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "contract_name",
    "mapname"
  ]

baseAbstractColumns :: TableColumns
baseAbstractColumns =
  [ "address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "contract_name",
    "data"
  ]

baseTableColumns :: TableColumns
baseTableColumns = baseColumns

baseMappingTableColumns :: TableColumns
baseMappingTableColumns = baseMappingColumns

-- discard app if org is null
constructTableNameParameters :: Text -> Text -> Text -> (Text, Text, Text)
constructTableNameParameters crtr app contract =
  if T.null crtr
    then ("", "", contract)
    else
      if app == contract
        then (crtr, "", contract)
        else (crtr, app, contract)

historyTableName :: Text -> Text -> Text -> TableName
historyTableName creator a n = uncurry3 HistoryTableName $ constructTableNameParameters creator a n

indexTableName :: Text -> Text -> Text -> TableName
indexTableName creator a n = uncurry3 IndexTableName $ constructTableNameParameters creator a n

abstractTableName :: Text -> Text -> Text -> TableName
abstractTableName creator a n = uncurry3 AbstractTableName $ constructTableNameParameters creator a n

mappingTableName :: Text -> Text -> Text -> Text -> TableName
mappingTableName creator a n m =
  let (c', a', n') = constructTableNameParameters creator a n
   in MappingTableName c' a' n' m

uncurry3 :: (a -> b -> c -> d) -> (a, b, c) -> d
uncurry3 f (x, y, z) = f x y z

createExpandIndexTable ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
createExpandIndexTable g c cc nameParts = do
  creationForeignKeys <- createIndexTable g c cc nameParts
  expansionForeignKeys <- expandIndexTable g c cc nameParts
  return $ creationForeignKeys ++ expansionForeignKeys

createExpandAbstractTable ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Account, Text) (Text, Text) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
createExpandAbstractTable g c nameParts abstracts cc = do
  creationForeignKeys <- createAbstractTable g c nameParts abstracts cc
  expansionForeignKeys <- expandAbstractTable g c nameParts abstracts cc
  return $ creationForeignKeys ++ expansionForeignKeys

data ForeignKeyInfo = ForeignKeyInfo
  { tableName :: TableName,
    columnName :: Text,
    foreignTableName :: TableName
  }
  deriving (Show)

instance Eq ForeignKeyInfo where
    x == y =
        tableName x == tableName y &&
        columnName x == columnName y &&
        foreignTableName x == foreignTableName y

instance Ord ForeignKeyInfo where
    compare x y =
        compare (tableName x, columnName x, foreignTableName x)
                (tableName y, columnName y, foreignTableName y)

-- dropFkeysBetween :: OutputM m =>
--   ForeignKeyInfo ->
--   ConduitM () Text m ()
-- dropFkeysBetween foreignKey = do
--   let srcTable = textToDoubleQuoteText $ tableNameToTextPostgres (tableName foreignKey)
--       -- srcColumn = wrapDoubleQuotes (columnName foreignKey)
--       targetTable = textToDoubleQuoteText $ tableNameToTextPostgres (foreignTableName foreignKey)
--       fkNameSrcToTarget = textToDoubleQuoteText $ tableNameToTextPostgres (tableName foreignKey) <> "_" <> tableNameToTextPostgres (foreignTableName foreignKey) <> "_fk"
--       fkNameTargetToSrc = textToDoubleQuoteText $ tableNameToTextPostgres (foreignTableName foreignKey) <> "_" <> tableNameToTextPostgres (tableName foreignKey) <> "_fk"
--       logMessage = 
--         "srcTable: " <> (T.pack $ show $ tableName foreignKey) <>
--         ", targetTable: " <> (T.pack $ show $ foreignTableName foreignKey) 
--   $logInfoS "dropFkeysBetween" logMessage

--   -- Drop existing foreign keys so theres no cyclical or old dependancy
--   yield $ "ALTER TABLE " <> srcTable 
--           <> " DROP CONSTRAINT IF EXISTS " <> fkNameSrcToTarget <> ";"
--   yield $ "ALTER TABLE " <> targetTable 
--           <> " DROP CONSTRAINT IF EXISTS " <> fkNameTargetToSrc <> ";"

createForeignIndexesForJoins ::
  OutputM m =>
  ForeignKeyInfo ->
  ConduitM () Text m ()
createForeignIndexesForJoins foreignKey = do
  let srcTable = textToDoubleQuoteText $ tableNameToTextPostgres (tableName foreignKey)
      srcColumn = wrapDoubleQuotes (columnName foreignKey)
      targetTable = textToDoubleQuoteText $ tableNameToTextPostgres (foreignTableName foreignKey)
      fkNameSrcToTarget = textToDoubleQuoteText $ tableNameToTextPostgres (tableName foreignKey) <> "_" <> tableNameToTextPostgres (foreignTableName foreignKey) <> "_fk"
      -- fkNameTargetToSrc = textToDoubleQuoteText $ tableNameToTextPostgres (foreignTableName foreignKey) <> "_" <> tableNameToTextPostgres (tableName foreignKey) <> "_fk"
      logMessage = 
        "createForeignIndexesForJoins srcTable: " <> (T.pack $ show $ tableName foreignKey) <>
        ", targetTable: " <> (T.pack $ show $ foreignTableName foreignKey) 
  $logInfoS "createForeignIndexesForJoins" logMessage
  -- Add new foreign key
  yield $ "ALTER TABLE " <> srcTable 
          <> " ADD CONSTRAINT " <> fkNameSrcToTarget <> " FOREIGN KEY (" 
          <> srcColumn <> ") REFERENCES " <> targetTable <> " (address);"

notifyPostgREST ::
  OutputM m =>
  PGConnection ->
  m ()
notifyPostgREST conn = do
  dbQueryCatchError conn "NOTIFY pgrst, 'reload schema';"

createExpandHistoryTable ::
  OutputM m =>
  Bool ->
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () (Text, Maybe (IORef Globals, TableName, TableColumns)) m ()
createExpandHistoryTable isAbstract g c cc nameParts = do
  createHistoryTable' isAbstract g c cc nameParts
  expandHistoryTable isAbstract g c cc nameParts

getDeferredForeignKeys :: (MonadLogger m) => TableName -> ContractF () -> CodeCollectionF () -> Text -> Text -> m [ForeignKeyInfo] --circular dependancy only fixed for abstract tables
getDeferredForeignKeys tableName c (CodeCollection ccs _ _ _ _ _ _ _) creator a = do
  result <- fmap catMaybes . for [(theName, x) | (theName, VariableDecl {_varType = SVMType.UnknownLabel x _}) <- Map.toList (c ^. storageDefs)] $ \(theName, x) -> do
      let contractF = Map.lookup x ccs
      case contractF of
        Just contract' -> do
          case (_constructor contract') of
            Nothing -> return Nothing
            Just _ -> do
              pure $ Just $ ForeignKeyInfo
                  { tableName = tableName,
                    columnName = labelToText $ theName++"_fkey",
                    foreignTableName = indexTableName creator a $ labelToText x
                  }
        Nothing -> return Nothing
  return result

getDeferredForeignKeysAbstract ::
  (MonadLogger m) =>
  TableName -> ContractF () -> Text -> Text -> Map.Map (Account, Text) (Text, Text) -> CodeCollectionF () -> m [ForeignKeyInfo]
getDeferredForeignKeysAbstract tableName c creator a abstracts' cc@(CodeCollection ccs _ _ _ _ _ _ _) = do
  result <- fmap catMaybes . for [(theName, x) | (theName, VariableDecl {_varType = SVMType.UnknownLabel x _}) <- Map.toList (c ^. storageDefs)] $ \(theName, x) -> do
      let contractF = Map.lookup x ccs
      case contractF of
        Just contract' -> do
          case (_constructor contract') of
            Nothing -> return Nothing
            Just _ -> do
              let contract = getContractsBySolidString x cc
              case contract of
                Just c' -> do
                  let (creator', a', n') = case _importedFrom c' of
                                            Nothing -> (creator, a, _contractName c')
                                            Just acct -> case Map.lookup (acct, T.pack $ _contractName c') abstracts' of
                                              Nothing -> (creator, a, _contractName c')
                                              Just (creator'', a'') -> (creator'', a'', _contractName c')
                  pure $ Just $ ForeignKeyInfo
                    { tableName = tableName,
                      columnName = labelToText $ theName++"_fkey",
                      foreignTableName = abstractTableName creator' a' $ T.pack n'
                      }
                Nothing -> return Nothing
        Nothing -> return Nothing
  return result

getDeferredForeignKeysForMapping :: TableName -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeysForMapping tableName creator a =
  [ ForeignKeyInfo
      { tableName = tableName,
        columnName = T.pack "address",
        foreignTableName =
          indexTableName creator a $
            ( \case
                MappingTableName _ _ n' _ -> n'
                _ -> ""
            )
              tableName
      }
  ]

createIndexTable ::
  OutputM m=>
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
createIndexTable globalsIORef contract cc (creator, a, n) = do
  let tableName = indexTableName creator a n
  tableExists <- isTableCreated globalsIORef tableName

  --When contract hasn't been written to "contract" table and indexing table doesn't exist
  $logDebugLS "createIndexTable/tableExists" ("Table Name: " ++ show tableName ++ ", contract already created: " ++ show tableExists)
  if tableExists 
    then return []
    else do
      incNumTables
      let list = getTableColumnAndType cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
          listCombined = map (\(x,y)-> x <> " " <> y) list
      yield $ createIndexTableQuery (creator, a, n) listCombined
      setTableCreated globalsIORef tableName listCombined
      getDeferredForeignKeys tableName contract cc creator a

createAbstractTable ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Account, Text) (Text, Text) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
createAbstractTable globalsIORef contract (creator, a, n) abstracts' cc = do
  let tableName = abstractTableName creator a n
  tableExists <- isTableCreated globalsIORef tableName
  if tableExists
    then return []
    else do
      let storageDefs' =  Map.toList $ contract ^. storageDefs
          list = getTableColumnAndType cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ storageDefs'
          listCombined = map (\(x,y)-> x <> " " <> y) list
      yield $ createAbstractTableQuery (creator, a, n) listCombined
      setTableCreated globalsIORef tableName (listCombined ++ ["\"data\" jsonb"])
      getDeferredForeignKeysAbstract tableName contract creator a abstracts' cc

-- if flag from solidvm that it is a record, vmevent
createMappingTable ::
  OutputM m =>
  IORef Globals ->
  (Text, Text, Text) ->
  Text ->
  ConduitM () Text m [ForeignKeyInfo]
createMappingTable globalsIORef (creator, a, n) m = do
  let tableName = mappingTableName creator a n m
  tableExists <- isTableCreated globalsIORef tableName

  $logDebugLS "createMappingTable/tableExists" ("Table Name: " ++ show tableName ++ ", table exists: " ++ formatBool tableExists)
  if tableExists
    then return []
    else do
      incNumMappingTables
      yield $ (createMappingTableQuery (creator, a, n, m))
      let list = ["key", "value"]
      setTableCreated globalsIORef tableName list
      return $ getDeferredForeignKeysForMapping tableName creator a

createHistoryTable' ::
  OutputM m =>
  Bool ->
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () (Text, Maybe (IORef Globals, TableName, TableColumns)) m ()
createHistoryTable' isAbstract globalsIORef contract cc (creator, a, n) = do
  let tableName = historyTableName creator a n
  tableExists <- isTableCreated globalsIORef tableName

  $logDebugLS "createHistoryTable'/tableExists" ("Table Name: " ++ show tableName ++ ", table exists: " ++ formatBool tableExists)

  when (not tableExists) $ do
    incNumHistoryTables
    let list = getTableColumnAndType cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
        listCombined = map (\(x,y)-> x <> " " <> y) list
    yield $ ((createHistoryTableQuery isAbstract (creator, a, n) listCombined), Nothing)
    yieldMany $ map (\x -> (x, Nothing)) (addHistoryUnique (creator, a, n))
    setTableCreated globalsIORef tableName listCombined

-- Runs ALTER TABLE <name> [ADD COLUMN <column>] for any new fields added to a contract definition
expandIndexTable ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
expandIndexTable globalsIORef contract cc (creator, a, n) = do
  let tableName = indexTableName creator a n
  expandContractTable globalsIORef contract cc tableName

expandAbstractTable ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Account, Text) (Text, Text) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
expandAbstractTable globalsIORef contract (creator, a, n) abstracts' cc = do
  let tableName = abstractTableName creator a n
  expandAbstractContractTable globalsIORef contract tableName abstracts' cc

expandHistoryTable ::
  OutputM m =>
  Bool ->
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () (Text, Maybe (IORef Globals, TableName, TableColumns)) m ()
expandHistoryTable isAbstract globalsIORef contract cc (creator, a, n) = do
  let tableName = historyTableName creator a n
  void $ 
    if isAbstract
      then mapOutput (\o -> (o, Nothing)) $ expandAbstractContractTable globalsIORef contract tableName Map.empty cc --abstracts' needs to be passed in for fkeys
      else expandContractTable' globalsIORef contract cc tableName

expandContractTable' ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  TableName ->
  ConduitM () (Text, Maybe (IORef Globals, TableName, TableColumns)) m [ForeignKeyInfo]
expandContractTable' globalsIORef contract cc tableName = do
  let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
      cols = getTableColumnAndType cc list
      colsCombined = map (\(x,y)-> x <> " " <> y) cols
  unless (null cols) $ do
    $logInfoS "expandTable" . T.pack $ "We just got fields for a contract that already has a table!"
    $logInfoS "expandTable" $
      T.concat
        [ "Adding columns to ",
          (tableNameToText tableName),
          " for the following fields: ",
          T.intercalate ", " colsCombined
        ]
    setTableCreated globalsIORef tableName $ colsCombined
    yield $ ((expandTableQuery tableName colsCombined), Just (globalsIORef, tableName, colsCombined))
  return $ []

expandContractTable ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  TableName ->
  ConduitM () Text m [ForeignKeyInfo]
expandContractTable globalsIORef contract cc tableName = do
    let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
        cols = getTableColumnAndType cc list
        colsCombined = map (\(x,y)-> x <> " " <> y) cols
    unless (null colsCombined) $ do
      $logInfoS "expandTable" . T.pack $ "We just got fields for a contract that already has a table!"
      $logInfoS "expandTable" $
        T.concat
          [ "Adding columns to ",
            (tableNameToText tableName),
            " for the following fields: ",
            T.intercalate ", " colsCombined
          ]
      setTableCreated globalsIORef tableName $ colsCombined
      yield $ expandTableQuery tableName colsCombined
    case tableName of
      IndexTableName creator a _ -> getDeferredForeignKeys tableName contract cc creator a
      _ -> return $ []

expandAbstractContractTable ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  TableName ->
  Map.Map (Account, Text) (Text, Text) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
expandAbstractContractTable globalsIORef contract tableName abstracts' cc = do
  let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
      cols = getTableColumnAndType cc list
      colsCombined = map (\(x,y)-> x <> " " <> y) cols
  unless (null colsCombined) $ do
    $logInfoS "expandAbstractContractTable" . T.pack $ "We just got new fields for a contract that already has a table!"
    $logInfoS "expandAbstractContractTable" $
      T.concat
        [ "Adding columns to ",
          (tableNameToText tableName),
          " for the following new fields: ",
          T.intercalate ", " colsCombined
        ]
    setTableCreated globalsIORef tableName $ colsCombined
    yield $ expandAbstractTableQuery tableName colsCombined
  case tableName of
    AbstractTableName creator a _ -> getDeferredForeignKeysAbstract tableName contract creator a abstracts' cc 
    _ -> return $ []

expandTableQuery :: TableName -> TableColumns -> Text
expandTableQuery tableName cols =
  T.concat
    [ "ALTER TABLE ",
      tableNameToDoubleQuoteText tableName,
      " ADD COLUMN IF NOT EXISTS",
      T.intercalate ", ADD COLUMN IF NOT EXISTS" cols,
      ";"
    ]

expandAbstractTableQuery :: TableName -> TableColumns -> Text
expandAbstractTableQuery tableName cols =
  T.concat
    [ "ALTER TABLE ",
      tableNameToDoubleQuoteText tableName,
      " ADD COLUMN IF NOT EXISTS",
      T.intercalate ", ADD COLUMN IF NOT EXISTS" cols,
      ", ADD COLUMN IF NOT EXISTS creator text",
      ", ADD COLUMN IF NOT EXISTS contract_name text",
      ", ADD COLUMN IF NOT EXISTS data jsonb",
      ";"
    ]

insertIndexTable ::
  OutputM m =>
  (E.ProcessedContract, [T.Text]) ->
  ConduitM () Text m ()
insertIndexTable contract = do
  yield $ insertIndexTableQuery contract

insertMappingTable ::
  OutputM m =>
  [ProcessedMappingRow] ->
  ConduitM () Text m ()
insertMappingTable [] = error "insertMappingTable: unhandled empty list"
insertMappingTable maps = do
  let newMaps = nubBy ((==) `on` mapDataKey) maps
  multilineLog "insertMappingTable" $ boringBox $ map show newMaps
  let grouped = (groupBy ((==) `on` mapname) newMaps)
      results = concat $ map insertMappingTableQuery grouped
  yieldMany $ results

insertForeignKeys ::
  (MonadLogger m, MonadUnliftIO m) =>
  PGConnection ->
  E.ProcessedContract ->
  m ()
insertForeignKeys conn contract = do
  let c@E.ProcessedContract {creator = crtr, application = app, contractName = cName, contractData = contractData} = contract
      tableName = indexTableName crtr app cName

  --There are still reasons why a foreign key insertion might fail
  --  1. The field type was changed in a solidity contract version update
  --  2. solidity uses inheritance, and the foreign key points to the parent table
  --  3. The user just sets a variable to a made up invalid address (0x1234)
  --When an invalid foreign pointer is set, STRATO's stated behavior will be to set the value to null
  forM_ [(n, a) | (n, ValueContract a) <- Map.toList $ contractData] $ \(theName, acct) ->
    do
      dbQuery conn $
        "UPDATE "
          <> tableNameToDoubleQuoteText tableName
          <> " SET "
          <> wrapDoubleQuotes theName
          <> "="
          <> wrapSingleQuotes (escapeQuotes $ T.pack $ show acct)
          <> " WHERE address="
          <> wrapSingleQuotes (makeAccount (E.chain c) (E.address c))
          <> ";"
      `catch` \(e :: SomeException) -> do
        $logInfoS "insertHistoryTable" $ T.pack $ "foreign key update failed, value will be set to null: " ++ show e
        dbQueryCatchError conn $
          "UPDATE "
            <> tableNameToDoubleQuoteText tableName
            <> " SET "
            <> wrapDoubleQuotes theName
            <> "=null WHERE address="
            <> wrapSingleQuotes (makeAccount (E.chain c) (E.address c))

insertHistoryTable ::
  OutputM m =>
  [E.ProcessedContract] ->
  ConduitM () Text m ()
insertHistoryTable [] = return () --no data, do nothing
insertHistoryTable contracts@(E.ProcessedContract {creator = crtr, application = app, contractName = cName} : _) = do
  let tableName = historyTableName crtr app cName
  $logDebugLS "insertHistoryTable" $ T.pack $ "Inserting row in history table for: " ++ show tableName
  yieldMany $ insertHistoryTableQuery contracts

insertHistoryAbstractTable :: 
  OutputM m => 
  [(E.ProcessedContract, [T.Text], T.Text, TableColumns)] ->
  [E.ProcessedContract] ->
  ConduitM () Text m ()
insertHistoryAbstractTable [] _ = pure ()
insertHistoryAbstractTable abstracts hists = do 
  let historyAbstracts = [(history, fkeys, tableName, tableCols) | history <- hists, (_, fkeys, tableName, tableCols) <- abstracts]
  yieldMany $ insertAbstractTableQuery historyAbstracts True

insertAbstractTable ::
  OutputM m =>
  [(E.ProcessedContract, [T.Text], T.Text, TableColumns)] ->
  Bool ->
  ConduitM () Text m ()
insertAbstractTable [] _ = pure ()
insertAbstractTable cs@((_, _,abTableName, _) : _) isHistoric = do
  $logInfoS "insertAbstractTable" $ T.pack $ "Inserting row in abstract table for: " ++ show abTableName
  multilineLog "insertAbstractTable/processedContract" $ show cs
  yieldMany $ insertAbstractTableQuery cs isHistoric
  
updateForeignKeysFromNULLAbstract ::
  OutputM m =>
  [(E.ProcessedContract, [T.Text], T.Text, TableColumns)] ->
  ConduitM () Text m ()
updateForeignKeysFromNULLAbstract [] = pure ()
updateForeignKeysFromNULLAbstract cs = do
  multilineLog "updateForeignKeysFromNULLAbstract/processedContract" $ show cs
  yieldMany $ updateFkeysQueryAbstract cs

updateForeignKeysFromNULLIndex ::
  OutputM m =>
  (E.ProcessedContract, [T.Text]) ->
  ConduitM () Text m ()
updateForeignKeysFromNULLIndex cs = do
  multilineLog "updateForeignKeysFromNULLIndex/processedContract" $ show cs
  yieldMany $ updateFkeysQueryIndex cs

baseColumnsQuery :: [Text]
baseColumnsQuery = 
  [ 
    "address text",
    "block_hash text",
    "block_timestamp text",
    "block_number text",
    "transaction_hash text",
    "transaction_sender text"
  ]

abstractBaseColumnsQuery :: [Text]
abstractBaseColumnsQuery = 
  baseColumnsQuery ++ 
  [
    "creator text",
    "contract_name text",
    "data jsonb"
  ]

createIndexTableQuery ::(Text, Text, Text) -> TableColumns-> Text
createIndexTableQuery (creator, a, n) cols =
  let tableName = indexTableName creator a n
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $ baseColumnsQuery ++ cols,
          ",\n  PRIMARY KEY (address) );"
        ]

createMappingTableQuery :: (Text, Text, Text, Text) -> Text
createMappingTableQuery (creator, a, n, m) =
  let tableName = mappingTableName creator a n m
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $ baseColumnsQuery ++
            [ "contract_name text",
              "mapname text",
              "key text",
              "value text"
            ],
          ",\n  PRIMARY KEY (address, key));"
        ]

createAbstractTableQuery :: (Text, Text, Text) -> TableColumns -> Text
createAbstractTableQuery (creator, a, n) list =
  let tableName = abstractTableName creator a n
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $
            [ "address text",
              "block_hash text",
              "block_timestamp text",
              "block_number text",
              "transaction_hash text",
              "transaction_sender text",
              "creator text",
              "contract_name text",
              "data jsonb"
            ]
              ++ list,
          ",\n  PRIMARY KEY (address));"
        ]

createHistoryTableQuery :: Bool -> (Text, Text, Text) ->  TableColumns -> Text
createHistoryTableQuery isAbstract (creator, a, n) cols =
  let tableName = historyTableName creator a n
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $
            (bool baseColumnsQuery abstractBaseColumnsQuery isAbstract)
              ++ cols,
          ");"
        ]

addHistoryUnique :: (Text, Text, Text) -> [Text]
addHistoryUnique (creator, a, n) =
  let (crtr, app, cname) = constructTableNameParameters creator a n
      historyName' = HistoryTableName crtr app cname
      historyName = tableNameToDoubleQuoteText historyName'
      indexName = "index_" <> (escapeQuotes $ tableNameToText historyName')
   in [ "CREATE UNIQUE INDEX IF NOT EXISTS "
          <> wrapDoubleQuotes indexName
          <> "\n  ON "
          <> historyName
          <> " (address, block_hash, transaction_hash);",
        "ALTER TABLE "
          <> historyName
          <> " ADD PRIMARY KEY USING INDEX "
          <> wrapDoubleQuotes indexName
          <> ";"
      ]

insertIndexTableQuery :: (E.ProcessedContract, [T.Text]) -> Text -- does not accomodate extra _fkey 
insertIndexTableQuery cs = 
    let cs' = (\(c@E.ProcessedContract {contractData = contractData}, fkeys) -> ((c, Map.toList $ Map.mapMaybe valueToSQLTextFilterContract $ contractData), fkeys)) cs
        processContract ((contract, list), fkeys) =
            let tableName = indexTableName (E.creator contract) (E.application contract) (E.contractName contract)
                fkeyColumns = [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeys]
                keysForSQL = map fst list ++ fkeyColumns
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseColumns ++ keysForSQL
                baseVals =
                  [ tshow . E.address,
                    T.pack . keccak256ToHex . E.blockHash,
                    tshow . E.blockTimestamp,
                    tshow . E.blockNumber,
                    T.pack . keccak256ToHex . E.transactionHash,
                    tshow . E.transactionSender
                  ]
                baseRowVals = map (wrapSingleQuotes . ($ contract)) baseVals
                contractValEntries = list
                regularVals = [snd kv | kv@(k, _) <- contractValEntries, k `elem` keysForSQL]
                fkeyVals = ["NULL" | k <- fkeyColumns, k `elem` keysForSQL]
                valsForSQL = baseRowVals ++ regularVals ++ fkeyVals
                insert = csv [wrapAndEscape valsForSQL]
            in T.concat
                    [ "INSERT INTO ",
                      tableNameToDoubleQuoteText tableName,
                      " ",
                      keySt,
                      "\n  VALUES ",
                      insert,
                      [r|
  ON CONFLICT (address) DO UPDATE SET
    address = excluded.address,
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender|],
                      if null keysForSQL then "" else ",\n    ",
                      tableUpsert keysForSQL,
                      ";"
                    ]
    in processContract cs'


insertMappingTableQuery :: [ProcessedMappingRow] -> [Text]
insertMappingTableQuery [] = error "insertMappingTableQuery: unhandled empty list"
insertMappingTableQuery ms =
  concat $
    let ms' = (\m -> (m, Map.toList $ Map.mapMaybe valueToSQLText $ Map.fromList [("key", mapDataKey m), ("value", mapDataValue m)])) <$> ms
     in flip map (map snd $ partitionWith (length . snd) ms') $ \case
          [] -> []
          mappings@((x, list) : _) ->
            let tableName =
                  mappingTableName
                    (creator x)
                    (application x)
                    (contractname x)
                    (mapname x)
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseMappingTableColumns ++ map fst (fillFirstEmptyEntries list)
                baseVals =
                  [ tshow . address,
                    T.pack . keccak256ToHex . blockHash,
                    tshow . blockTimestamp,
                    tshow . blockNumber,
                    T.pack . keccak256ToHex . transactionHash,
                    tshow . transactionSender,
                    contractname,
                    mapname
                  ]
                vals = flip map mappings $ \(row, rowList) ->
                  wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList
                inserts = csv vals
             in (: []) $
                  T.concat
                    [ "INSERT INTO ",
                      tableNameToDoubleQuoteText tableName,
                      " ",
                      keySt,
                      "\n  VALUES ",
                      inserts,
                      [r|
  ON CONFLICT (address, key) DO UPDATE SET
    address = excluded.address,
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    contract_name = excluded.contract_name,
    mapname = excluded.mapname,
    value = excluded.value|],
                      ";"
                    ]

insertAbstractTableQuery :: [(E.ProcessedContract, [T.Text], T.Text, TableColumns)] -> Bool -> [Text]
insertAbstractTableQuery [] _ = error "insertAbstractTableQuery: unhandled empty list"
insertAbstractTableQuery cs isHistoric =
  concat $
    let cs' = (\(c@E.ProcessedContract {contractData = contractData}, fkeys, ab, abColumns) -> 
                ((c, Map.mapMaybe valueToSQLTextFilterContract $ contractData), (ab, abColumns, fkeys))) <$> cs
     in flip map (map snd $ partitionWith ((\(ab, _, _) -> ab) . snd) cs') $ \case
          [] -> []
          contracts@(((x, list), (abTableName, abColumns, fkeys)) : _) ->
            let contractTableName =
                  abstractTableName (E.creator x) (E.application x) (E.contractName x)
                list' = Map.toList $ Map.filterWithKey (\k _ -> k `elem` abColumns) list 
                fkeyColumns = [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeys, k `elem` abColumns]
                keysForSQL = map fst list' ++ fkeyColumns
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseAbstractColumns ++ keysForSQL
                baseVals =
                  [ tshow . E.address,
                    T.pack . keccak256ToHex . E.blockHash,
                    tshow . E.blockTimestamp,
                    tshow . E.blockNumber,
                    T.pack . keccak256ToHex . E.transactionHash,
                    tshow . E.transactionSender,
                    E.creator
                  ]
                vals = flip map contracts $ \((row, contractColumns), _) ->
                  let baseRowVals = map (wrapSingleQuotes . ($ row)) baseVals
                      contractNameVal = [wrapSingleQuotes $ escapeQuotes (tableNameToText contractTableName)] 
                      dataVals = [wrapSingleQuotes . decodeUtf8 . BL.toStrict $ Aeson.encode $ MapWrapper $ aesonHelper $ Map.filterWithKey (\k _ -> k `notElem` abColumns) contractColumns] 
                      contractValEntries = Map.toList contractColumns
                      regularVals = [(snd kv) | kv@(k, _) <- contractValEntries, k `elem` keysForSQL]
                      fkeyVals = ["NULL" | k <- fkeyColumns, k `elem` keysForSQL]  -- This avoids circular dependancies as the inserts occur first and set fkeys=null
                      valsForSQL = baseRowVals ++ contractNameVal ++ dataVals ++ regularVals ++ fkeyVals
                  in wrapAndEscape valsForSQL
                inserts = csv vals
            in (: []) $
                  T.concat $
                    [ "INSERT INTO ",
                      (bool abTableName (wrapDoubleQuotes $ "history@" <> unwrapDoubleQuotes abTableName) isHistoric),
                      " ",
                      keySt,
                      "\n  VALUES ",
                      inserts
                    ] ++
                    if isHistoric
                      then
                        [[r| ON CONFLICT DO NOTHING;|]]
                      else
                          [[r|
                          ON CONFLICT (address) DO UPDATE SET
                            block_hash = excluded.block_hash,
                            block_timestamp = excluded.block_timestamp,
                            block_number = excluded.block_number,
                            transaction_hash = excluded.transaction_hash,
                            transaction_sender = excluded.transaction_sender,
                            contract_name = excluded.contract_name,
                            data = excluded.data
                          |],
                          if null keysForSQL then "" else ",\n    ",
                          tableUpsert $ keysForSQL,
                          ";"]

-- Result: UPDATE table SET (fkey1,fkey2, ...)=(val1,val2, ...) where (fkey1_fkey,fkey2_fkey, ...)=(val1,val2, ...);
updateFkeysQueryAbstract :: [(E.ProcessedContract, [T.Text], T.Text, TableColumns)] -> [Text]
updateFkeysQueryAbstract cs =
  concat $
    let cs' = (\(c@E.ProcessedContract {contractData = contractData}, fkeys, ab, abColumns) -> 
                ((c, Map.mapMaybe valueToSQLTextFilterContract $ contractData), (ab, abColumns, fkeys))) <$> cs
     in flip map (map snd $ partitionWith ((\(ab, _, _) -> ab) . snd) cs') $ \case
          [] -> []
          contracts@(((_, _), (abTableName, abColumns, fkeys)) : _) ->
            let fkeyColumns = [ k | k <- fkeys, k `elem` abColumns]
                fkeyColumnsWithPostFix = Set.toList . Set.fromList $ [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeyColumns]
                keySt =  wrapAndEscapeDouble . map escapeQuotes $ fkeyColumns
                keyStForFkeyColumnsWithPostFix = wrapAndEscapeDouble . map escapeQuotes $ fkeyColumnsWithPostFix
                vals = flip map contracts $ \((_, contractColumns), _) ->
                  let 
                    contractValEntries = Map.toList contractColumns 
                    fkeyVals = [(snd kv) | kv@(k, _) <- contractValEntries, k `elem` fkeys]
                  in wrapAndEscape fkeyVals
                inserts = csv $ Set.toList . Set.fromList $ vals
            in if not (null fkeyColumns) 
               then (: []) $
                  T.concat $
                    [ "UPDATE ",
                      abTableName,
                      "\n  SET ",
                      keyStForFkeyColumnsWithPostFix,
                      " = ",
                      inserts,
                      "\n  WHERE ",
                      keySt,
                      " = ",
                      inserts,
                      ";"
                    ]
               else []

updateFkeysQueryIndex :: (E.ProcessedContract, [T.Text]) -> [Text]
updateFkeysQueryIndex (c@E.ProcessedContract {contractData = contractData}, fkeys) =
  let contractColumns = Map.toList $ Map.mapMaybe valueToSQLTextFilterContract contractData
      tableName = indexTableName (E.creator c) (E.application c) (E.contractName c)
      fkeyValues = [(k, v) | (k, v) <- contractColumns, k `elem` fkeys]
      fkeyColumns = map fst fkeyValues
      fkeyColumnsWithPostFix = [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeyColumns]
      keySt = wrapAndEscapeDouble . map escapeQuotes $ fkeyColumns
      keyStForFkeyColumnsWithPostFix = wrapAndEscapeDouble . map escapeQuotes $ fkeyColumnsWithPostFix
      vals = map snd fkeyValues
      valsForSQL = csv [wrapAndEscape vals]
  in if not (null fkeyColumns) then
        [ T.concat
            [ "UPDATE ",
              tableNameToDoubleQuoteText tableName,
              "\n  SET",
              keyStForFkeyColumnsWithPostFix,
              " = ",
              valsForSQL,
              "\n  WHERE ",
              keySt,
              " = ",
              valsForSQL,
              ";"
            ]
        ]
     else []

insertHistoryTableQuery :: [E.ProcessedContract] -> [Text]
insertHistoryTableQuery [] = error "insertHistoryTableQuery: unhandled empty list"
insertHistoryTableQuery cs =
  concat $
    let cs' = (\c -> (c, Map.toList $ Map.mapMaybe valueToSQLText $ E.contractData c)) <$> cs
     in flip map (map snd $ partitionWith (length . snd) cs') $ \case
          [] -> []
          contracts@((x, list) : _) ->
            let tableName =
                  historyTableName
                    (E.creator x)
                    (E.application x)
                    (E.contractName x)
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst (fillFirstEmptyEntries list)
                baseVals =
                  [ tshow . E.address,
                    T.pack . keccak256ToHex . E.blockHash,
                    tshow . E.blockTimestamp,
                    tshow . E.blockNumber,
                    T.pack . keccak256ToHex . E.transactionHash,
                    tshow . E.transactionSender
                  ]
                vals = flip map contracts $ \(row, rowList) ->
                  wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList
                inserts = csv vals
             in (: []) . T.concat $
                  [ "INSERT INTO ",
                    tableNameToDoubleQuoteText tableName,
                    " ",
                    keySt,
                    "\n  VALUES ",
                    inserts,
                    "\n  ON CONFLICT DO NOTHING;"
                  ]

-- Creates tables for all event declarations, stores table name in
-- globals{createdEvents}
createExpandEventTables ::
  OutputM m =>
  IORef Globals ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m ()
createExpandEventTables globalsIORef c cc nameParts = mapM_ go . Map.toList $ c ^. events
  where
    go (evName, ev) = do
      createEventTable globalsIORef nameParts evName ev cc
      expandEventTable globalsIORef nameParts evName ev cc

createEventTable ::
  OutputM m =>
  IORef Globals ->
  (Text, Text, Text) ->
  SolidString ->
  EventF () ->
  CodeCollectionF () ->
  ConduitM () Text m ()
createEventTable globalsIORef (creator, a, n) evName ev cc = do
  let (crtr, app, cname) = constructTableNameParameters creator a n
      eventTable = EventTableName crtr app cname (escapeQuotes $ labelToText evName)
      cols = getTableColumnAndType cc [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries $ ev ^. eventLogs]
      colsCombined = map (\(x,y)-> x <> " " <> y) cols
  eventAlreadyCreated <- isTableCreated globalsIORef eventTable
  unless eventAlreadyCreated $ do
    setTableCreated globalsIORef eventTable $ colsCombined
    yield $ createEventTableQuery eventTable colsCombined

createEventTableQuery :: TableName -> TableColumns -> Text
createEventTableQuery tableName cols =
     T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $
            [ "id SERIAL NOT NULL",
              "address text",
              "block_hash text",
              "block_timestamp text",
              "block_number text",
              "transaction_hash text",
              "transaction_sender text"
            ]
              ++ cols,
          ");"
        ]

expandEventTable ::
  OutputM m =>
  IORef Globals ->
  (Text, Text, Text) ->
  SolidString ->
  EventF () ->
  CodeCollectionF() ->
  ConduitM () Text m ()
expandEventTable globalsIORef (creator, a, n) evName ev cc = do
  let (crtr, app, cname) = constructTableNameParameters creator a n
      tableName = EventTableName crtr app cname (escapeQuotes $ labelToText evName)
      (allTableCols :: [(T.Text, T.Text)]) = getTableColumnAndType cc [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries $ ev ^. eventLogs]
      allTableColsCombined = map (\(x,y)-> x <> " " <> y) allTableCols
  unless (null allTableCols) $ do
    $logInfoS "expandEventTable" . T.pack $ "We just got new fields for a contract that already has a table!"
    setTableCreated globalsIORef tableName allTableColsCombined
    $logInfoS "expandEventTable" $
      T.concat
        [ "Adding columns to ",
          (tableNameToText tableName),
          " for the following new fields: ",
          T.intercalate ", " allTableColsCombined
        ]
    yield $ expandTableQuery tableName allTableColsCombined

insertEventTables :: 
  OutputM m =>
  IORef Globals ->
  [AggregateEvent] ->
  ConduitM () Text m ()
insertEventTables globalsIORef evs = do
  let processedEvents = concatMap getAllEvents evs
  yieldMany . catMaybes =<< lift (mapM (insertEventTable globalsIORef) processedEvents)
  where
    getAllEvents :: 
      AggregateEvent -> 
      [AggregateEvent]
    getAllEvents aggEvent = do
      let newEvents = processParents aggEvent
       in aggEvent : newEvents

    processParents :: 
      AggregateEvent -> [AggregateEvent]
    processParents ae = createNewEvent <$> Map.toList (eventAbstracts ae)
      where
        createNewEvent :: 
          ((Account, Text), (Text, Text)) -> AggregateEvent
        createNewEvent ((_, n'), (c, a)) =
          ae { eventEvent = (eventEvent ae) {
            Action.evContractCreator = T.unpack c,
            Action.evContractApplication = T.unpack a,
            Action.evContractName = T.unpack n'
              }
          }

insertEventTable ::
  OutputM m =>
  IORef Globals ->
  AggregateEvent ->
  m (Maybe Text)
insertEventTable globalsIORef agEv@AggregateEvent {eventEvent = ev} = do
  let (creator, a, cname) =
        constructTableNameParameters
          (T.pack $ Action.evContractCreator ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
      eventTable = EventTableName creator a cname (escapeQuotes $ T.pack $ Action.evName ev)

  eventExists <- isTableCreated globalsIORef eventTable
  let q = insertEventTableQuery agEv
  multilineDebugLog "insertEventTable/SQL" $ T.unpack q
  if eventExists
    then return (Just q)
    else return Nothing

insertEventTableQuery :: AggregateEvent -> Text
insertEventTableQuery agEv@AggregateEvent {eventEvent = ev} =
  let (creator, a, cname) =
        constructTableNameParameters
          (T.pack $ Action.evContractCreator ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
      tableName = EventTableName creator a cname (escapeQuotes $ T.pack $ Action.evName ev)
      filledArgs = map fst . fillFirstEmptyEntries . map (first T.pack) $ Action.evArgs ev
      keySt = wrapAndEscapeDouble . map escapeQuotes $ ("id" : baseTableColumns) ++ filledArgs
      baseVals =
        [ tshow . _accountAddress . Action.evContractAccount . eventEvent,
          T.pack . keccak256ToHex . eventBlockHash,
          tshow . eventBlockTimestamp,
          tshow . eventBlockNumber,
          T.pack . keccak256ToHex . eventTxHash,
          tshow . eventTxSender
        ]
      vals = csv $ map (wrapSingleQuotes . escapeQuotes . ($ agEv)) baseVals ++ map (wrapSingleQuotes . escapeQuotes . T.pack . snd) (Action.evArgs ev)
   in T.concat $
        [ "INSERT INTO ",
          tableNameToDoubleQuoteText tableName,
          " ",
          keySt,
          "\n  VALUES ( DEFAULT,\n",
          vals,
          " )\n  ON CONFLICT DO NOTHING;"
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
solidityTypeToSQLType (SVMType.Array _ _) = Just "jsonb"
solidityTypeToSQLType (SVMType.Mapping _ _ _) = Nothing -- Just "jsonb"
solidityTypeToSQLType (SVMType.UnknownLabel _ _) = Just "text"
--solidityTypeToSQLType (SVMType.UnknownLabel x) = Just $ "text references " <> T.pack x <> "(id)"
solidityTypeToSQLType (SVMType.Struct _ _) = Just "jsonb"
solidityTypeToSQLType (SVMType.Enum _ _ _) = Just "text"
solidityTypeToSQLType (SVMType.Contract _) = Just "text"
solidityTypeToSQLType (SVMType.Error _ _) = Just "text"
solidityTypeToSQLType SVMType.Variadic = Nothing

--solidityTypeToSQLType x = error $ "undefined type in solidityTypeToSQLType: " ++ show (varType x)

------------------

solidityValueToText :: SolidityValue -> Text
solidityValueToText (SolidityValueAsString x) = escapeQuotes $ V.unEscapeStringValue x
solidityValueToText (SolidityBool x) = tshow x
solidityValueToText (SolidityNum x) = tshow x
solidityValueToText (SolidityBytes x) = escapeQuotes $ tshow x
solidityValueToText (SolidityArray x) = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ Aeson.encode x
solidityValueToText x@(SolidityObject _) = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ Aeson.encode x

valueToSQLTextFilterContract :: Value -> Maybe Text
valueToSQLTextFilterContract x = valueToSQLText x

valueToSQLText :: Value -> Maybe Text
valueToSQLText (SimpleValue (ValueBool x)) = Just $ wrapSingleQuotes $ tshow x
valueToSQLText (SimpleValue (ValueInt _ _ v)) = Just $ wrapSingleQuotes $ tshow v
valueToSQLText (SimpleValue (ValueString s)) = Just $ wrapSingleQuotes $ escapeQuotes s
valueToSQLText (SimpleValue (ValueAddress (Address 0))) = Just "NULL"
valueToSQLText (SimpleValue (ValueAddress (Address addr))) =
  if fromIntegral addr == (0 :: Integer)
  then Just "NULL"
  else Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ printf "%040x" (fromIntegral addr :: Integer)
valueToSQLText (SimpleValue (ValueAccount acct@(NamedAccount (Address addr) _))) = 
  if fromIntegral addr == (0 :: Integer)
  then Just "NULL"
  else Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show acct
valueToSQLText (SimpleValue (ValueBytes _ bytes)) = Just $
  wrapSingleQuotes $
    escapeQuotes $ case decodeUtf8' bytes of
      Left _ -> decodeUtf8 $ Base16.encode bytes
      Right x -> x
valueToSQLText (ValueEnum _ _ index) = Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show index
valueToSQLText (ValueContract acct@(NamedAccount (Address addr) _)) = 
  if fromIntegral addr == (0 :: Integer)
  then Just "NULL"
  else Just $ wrapSingleQuotes $ escapeQuotes $ T.pack $ show acct
valueToSQLText (ValueFunction _ _ _) = Nothing
valueToSQLText (ValueMapping _) = Nothing
valueToSQLText arr@(ValueArrayFixed _ _) = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ arr
valueToSQLText arr@(ValueArrayDynamic _) = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ arr
valueToSQLText struct@(ValueStruct _) = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ struct

valueToSQLText x = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ x
