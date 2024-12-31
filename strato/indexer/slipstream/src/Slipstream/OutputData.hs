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
  outputDataDedup,
  OutputM,
  ProcessedCollectionRow(..),
  insertEventTables,
  insertIndexTable,
  insertForeignKeys,
  insertCollectionTable,
  insertMappingTableQuery,
  insertArrayTableQuery,
  insertAbstractTable,
  insertAbstractTableQuery,
  createIndexTable,
  createMappingTable,
  createArrayTable,
  createAbstractTable,
  createExpandEventTables,
  createExpandIndexTable,
  createForeignIndexesForJoins,
  createExpandAbstractTable,
  createHistoryTable',
  createHistoryTable,
  expandAbstractTable,
  expandAbstractContractTable,
  notifyPostgREST,
  createExpandHistoryTable,
  updateForeignKeysFromNULLAbstract,
  updateForeignKeysFromNULLIndex,
  updateForeignKeysFromNULLArray,
  cirrusInfo,
  historyTableName,
  getTableColumnAndType,
  aggEventToCollectionRow,
  aggEventToCollectionRows,
  removeArrayEvArgs,
  getArraysFromEvents,
  getAllEvents,
  processParents
  ) where


import           BlockApps.Solidity.Value as V
import           Conduit
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
import           Data.Maybe                      (catMaybes, fromMaybe)
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Traversable                (for)
import           Bloc.Server.Utils               (partitionWith)
import           BlockApps.Logging
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
-- import           Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Event   as Action
import           Blockchain.Strato.Model.Keccak256
-- import           Data.Bifunctor                  (first)
-- import           Data.Function                   (on)
import           Data.List                       ( groupBy, nubBy, sortBy)
import           Data.Ord (comparing)
import           Data.Text.Encoding              (decodeUtf8, decodeUtf8', encodeUtf8)
import           Data.Time
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Protocol
import           Database.PostgreSQL.Typed.Query
import           Slipstream.Data.Action
import qualified Slipstream.Events               as E
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
import qualified Data.Text.Encoding as TE


newtype First b a = First {unFirst :: (a, b)}

instance Functor (First b) where
  fmap f (First (a, b)) = First (f a, b)


data ProcessedCollectionRow = ProcessedCollectionRow
  { address :: Address,
    -- codehash :: Maybe CodePtr,
    creator :: Text,
    cc_creator :: Maybe Text,
    root :: Text,
    application :: Text,
    contractname :: Text,
    eventInfo :: Maybe (Text, Int),
    collectionname :: Text,
    collectiontype ::Text,
    blockHash :: Keccak256,
    blockTimestamp :: UTCTime,
    blockNumber :: Integer,
    transactionHash :: Keccak256,
    transactionSender :: Address,
    collectionDataKey :: V.Value,
    collectionDataValue :: V.Value
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

getTableColumnAndType :: Bool -> CodeCollectionF () -> [(Text, SVMType.Type)] -> [(T.Text, T.Text)]
getTableColumnAndType isEvent cc@(CodeCollection ccs _ _ _ _ _ _ _) = concatMap go . fillFirstEmptyEntries
  where
    go :: (Text, SVMType.Type) -> [(T.Text, T.Text)]
    go (x, y) = 
      case solidityTypeToSQLType isEvent Nothing cc y of
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

dbQueryCatchError' :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> (Text, Maybe (TableName, TableColumns)) -> m ()
dbQueryCatchError' conn (insrt, b) = handle (handlePostgresError' b) $ dbQuery conn insrt

dbQueryCatchError :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQueryCatchError conn insrt = handle handlePostgresError $ dbQuery conn insrt

dbQuery :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQuery conn insrt = do
  $logDebugS "outputData" insrt
  liftIO . void . pgQuery conn . rawPGSimpleQuery $! encodeUtf8 insrt

handlePostgresError' :: (MonadLogger m) => Maybe (TableName, TableColumns) -> SomeException -> m ()
handlePostgresError' myStuff e =
  case myStuff of
    Nothing -> handlePostgresError e
    Just (_, _) -> handlePostgresError e

handlePostgresError :: MonadLogger m => SomeException -> m ()
handlePostgresError e =
  if crashOnSQLError
    then error . show $ e
    else $logErrorLS "handlePGError" e

outputData' ::
  OutputM m =>
  PGConnection ->
  ConduitM () (Text, Maybe ( TableName, TableColumns)) m a ->
  m a
outputData' conn c = runConduit $ c `fuseUpstream` mapM_C (dbQueryCatchError' conn)

outputData ::
  OutputM m =>
  PGConnection ->
  ConduitM () Text m a ->
  m a
outputData conn c = runConduit $ c `fuseUpstream` mapM_C (dbQueryCatchError conn)

dedupC :: (Monad m, Ord a) => ConduitM a a m ()
dedupC = go Set.empty
  where go seen = await >>= \case
          Just a | not (a `Set.member` seen) -> yield a >> go (Set.insert a seen)
          Just _ -> go seen
          Nothing -> pure ()

outputDataDedup ::
  OutputM m =>
  PGConnection ->
  ConduitM () Text m a ->
  m a
outputDataDedup conn c = runConduit $ c `fuseUpstream` (dedupC .| mapM_C (dbQueryCatchError conn))

baseColumns :: TableColumns
baseColumns =
  [ "address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root"
  ]

baseEventColumns :: TableColumns
baseEventColumns =
  [ "address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "event_index"
  ]

baseEventCollectionColumns :: TableColumns
baseEventCollectionColumns =
  baseEventColumns ++
  [
    "contract_name",
    "collectionname",
    "collectiontype"
  ]

baseMappingColumns :: TableColumns
baseMappingColumns =
  [ "address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "creator",
    "root",
    "contract_name",
    "collectionname",
    "collectiontype"
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
    "root",
    "contract_name",
    "data"
  ]

-- baseTableColumns :: TableColumns
-- baseTableColumns = baseColumns

baseTableColumnsForEvent :: TableColumns
baseTableColumnsForEvent = baseEventColumns

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

collectionTableName :: Text -> Text -> Text -> Text -> TableName
collectionTableName creator a n m =
  let (c', a', n') = constructTableNameParameters creator a n
   in CollectionTableName c' a' n' m

eventTableName :: Text -> Text -> Text -> Text -> TableName
eventTableName creator a n e =
  let (c', a', n') = constructTableNameParameters creator a n
   in EventTableName c' a' n' e

eventCollectionTableName :: Text -> Text -> Text -> Text -> Text -> TableName
eventCollectionTableName creator a n e m =
  let (c', a', n') = constructTableNameParameters creator a n
   in EventCollectionTableName c' a' n' e m

uncurry3 :: (a -> b -> c -> d) -> (a, b, c) -> d
uncurry3 f (x, y, z) = f x y z

compareCollectionRows :: ProcessedCollectionRow -> ProcessedCollectionRow -> Bool
compareCollectionRows x y = collectionDataKey x == collectionDataKey y &&
                   creator x == creator y &&
                   application x == application y &&
                   contractname x == contractname y &&
                   collectionname x == collectionname y

compareCollectionRows' :: ProcessedCollectionRow -> ProcessedCollectionRow -> Bool
compareCollectionRows' x y =
                   creator x == creator y &&
                   application x == application y &&
                   contractname x == contractname y &&
                   collectionname x == collectionname y

createExpandIndexTable ::
  OutputM m =>
  --
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
createExpandIndexTable c cc nameParts = do
  creationForeignKeys <- createIndexTable c cc nameParts
  expansionForeignKeys <- expandIndexTable c cc nameParts
  return $ creationForeignKeys ++ expansionForeignKeys

createExpandAbstractTable ::
  OutputM m =>
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Account, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
createExpandAbstractTable c nameParts abstracts cc = do
  creationForeignKeys <- createAbstractTable c nameParts abstracts cc
  expansionForeignKeys <- expandAbstractTable c nameParts abstracts cc
  return $ creationForeignKeys ++ expansionForeignKeys


data ForeignKeyInfo = ForeignKeyInfo
  { tableName :: TableName,
    columnNames :: [Text],
    foreignTableName :: TableName,
    foreignColumnNames :: [Text]
  }
  deriving (Show)

instance Eq ForeignKeyInfo where
    x == y =
        tableName x == tableName y &&
        columnNames x == columnNames y &&
        foreignTableName x == foreignTableName y &&
        foreignColumnNames x == foreignColumnNames y

instance Ord ForeignKeyInfo where
    compare x y =
        compare (tableName x, columnNames x, foreignTableName x, foreignColumnNames x)
                (tableName y, columnNames y, foreignTableName y, foreignColumnNames y)

createForeignIndexesForJoins ::
  OutputM m =>
  ForeignKeyInfo ->
  ConduitM () Text m ()
createForeignIndexesForJoins foreignKey = do
  let srcTable = textToDoubleQuoteText $ tableNameToTextPostgres (tableName foreignKey)
      srcColumns = csv $ wrapDoubleQuotes <$> columnNames foreignKey
      targetTable = textToDoubleQuoteText $ tableNameToTextPostgres (foreignTableName foreignKey)
      targetColumns = csv $ wrapDoubleQuotes <$> foreignColumnNames foreignKey
      fkNameSrcToTarget = textToDoubleQuoteText $ tableNameToTextPostgres (tableName foreignKey) <> "_" <> tableNameToTextPostgres (foreignTableName foreignKey) <> "_fk"
      -- fkNameTargetToSrc = textToDoubleQuoteText $ tableNameToTextPostgres (foreignTableName foreignKey) <> "_" <> tableNameToTextPostgres (tableName foreignKey) <> "_fk"
      logMessage = 
        "createForeignIndexesForJoins srcTable: " <> (T.pack $ show $ tableName foreignKey) <>
        ", targetTable: " <> (T.pack $ show $ foreignTableName foreignKey) 
  $logInfoS "createForeignIndexesForJoins" logMessage
  -- Add new foreign key
  yield $ "ALTER TABLE " <> srcTable 
          <> " ADD CONSTRAINT " <> fkNameSrcToTarget <> " FOREIGN KEY (" 
          <> srcColumns <> ") REFERENCES " <> targetTable <> " (" <> targetColumns <> ");"

notifyPostgREST ::
  OutputM m =>
  PGConnection ->
  m ()
notifyPostgREST conn = do
  dbQueryCatchError conn "NOTIFY pgrst, 'reload schema';"

createExpandHistoryTable ::
  OutputM m =>
  Bool ->
  
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m ()
createExpandHistoryTable isAbstract c cc nameParts = do
  createHistoryTable' isAbstract c cc nameParts
  expandHistoryTable isAbstract c cc nameParts

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
                    columnNames = [labelToText $ theName++"_fkey"],
                    foreignTableName = indexTableName creator a $ labelToText x,
                    foreignColumnNames = [labelToText "address"]
                  }
        Nothing -> return Nothing
  return result

getDeferredForeignKeysAbstract ::
  (MonadLogger m) =>
  TableName -> ContractF () -> Text -> Text -> Map.Map (Account, Text) (Text, Text, [Text]) -> CodeCollectionF () -> m [ForeignKeyInfo]
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
                                              Just (creator'', a'', _) -> (creator'', a'', _contractName c')
                  pure $ Just $ ForeignKeyInfo
                    { tableName = tableName,
                      columnNames = [labelToText $ theName++"_fkey"],
                      foreignTableName = abstractTableName creator' a' $ T.pack n',
                      foreignColumnNames = [labelToText "address"]
                      }
                Nothing -> return Nothing
        Nothing -> return Nothing
  return result

getDeferredForeignKeysForCollection :: TableName -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeysForCollection tableName creator a =
  [ ForeignKeyInfo
      { tableName = tableName,
        columnNames = [T.pack "address"],
        foreignTableName =
          indexTableName creator a $
            ( \case
                CollectionTableName _ _ n' _ -> n'
                _ -> ""
            )
              tableName,
        foreignColumnNames = [T.pack "address"]
      }
  ]

getDeferredForeignKeysForEvent :: TableName -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeysForEvent tableName creator a =
  [ ForeignKeyInfo
      { tableName = tableName,
        columnNames = [T.pack "address"],
        foreignTableName =
          indexTableName creator a $
            ( \case
                EventTableName _ _ n' _ -> n'
                _ -> ""
            )
              tableName,
        foreignColumnNames = [T.pack "address"]
      }
  ]

getDeferredForeignKeysForEventCollection :: TableName -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeysForEventCollection tableName creator a =
  [ ForeignKeyInfo
      { tableName = tableName,
        columnNames = [T.pack "transaction_hash", T.pack "event_index"],
        foreignTableName =
          uncurry (eventTableName creator a) $
            ( \case
                EventCollectionTableName _ _ n' e' _ -> (n', e')
                _ -> ("", "")
            )
              tableName,
        foreignColumnNames = [T.pack "transaction_hash", T.pack "event_index"]
      }
  ]

getDeferredForeignKeysForArrayType :: TableName -> Text -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeysForArrayType tableName creator a arrType =
  [ ForeignKeyInfo
      { tableName = tableName,
        columnNames = [T.pack "value_fkey"],
        foreignTableName = indexTableName creator a arrType,
        foreignColumnNames = [T.pack "address"]
      }
  ]

createIndexTable ::
  OutputM m=>
  --
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
createIndexTable contract cc (creator, a, n) = do
  let tableName = indexTableName creator a n

  let isEvent = False
      list = getTableColumnAndType isEvent cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
      listCombined = map (\(x,y)-> x <> " " <> y) list
  yield $ createIndexTableQuery (creator, a, n) listCombined
  getDeferredForeignKeys tableName contract cc creator a

createAbstractTable ::
  OutputM m =>
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Account, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
createAbstractTable contract (creator, a, n) abstracts' cc = do
  let tableName = abstractTableName creator a n
  let storageDefs' =  Map.toList $ contract ^. storageDefs
      isEvent = False
      list = getTableColumnAndType isEvent cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ storageDefs'
      listCombined = map (\(x,y)-> x <> " " <> y) list
  yield $ createAbstractTableQuery (creator, a, n) listCombined
  getDeferredForeignKeysAbstract tableName contract creator a abstracts' cc

-- if flag from solidvm that it is a record, vmevent
createMappingTable ::
  OutputM m =>
  --
  (Text, Text, Text) ->
  Text ->
  ConduitM () Text m [ForeignKeyInfo]
createMappingTable (creator, a, n) m = do
  let tableName = collectionTableName creator a n m
  yield $ (createMappingTableQuery (creator, a, n, m))
  return $ getDeferredForeignKeysForCollection tableName creator a

createArrayTable ::
  OutputM m =>
  (Text, Text, Text) ->
  (Text, SVMType.Type) ->
  ContractF () ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
createArrayTable (creator, a, n) (arr, arrType) c cc = do
  let tableName = collectionTableName creator a n arr
      arrSqlType = fromMaybe "text" $ solidityTypeToSQLType False (Just c) cc arrType
  yield $ (createArrayTableQuery (creator, a, n, arr, arrSqlType))
  let fkeys1 = getDeferredForeignKeysForCollection tableName creator a
      fkeys2 = case arrType of
                (SVMType.UnknownLabel contractNameForFkey _) -> getDeferredForeignKeysForArrayType tableName creator a (T.pack $ contractNameForFkey)
                _  -> []
  return $ fkeys1 ++ fkeys2

createEventArrayTable ::
  OutputM m =>
  (Text, Text, Text, Text) ->
  (Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
createEventArrayTable (creator, a, n, e) (arr, arrType) = do
  let tableName = eventCollectionTableName creator a n e arr
  $logInfoS "createEventArrayTable/tableExists"  $ T.pack ( "Table Name: " ++ show tableName ++ ", table exists: ")
  $logInfoS "createEventArrayTable/(creator, a, n, e) " (T.pack $ show (creator, a, n, e))
  $logInfoS "createEventArrayTable/(arr, arrType) " (T.pack $ show (arr, arrType))
  yield $ (createEventArrayTableQuery (creator, a, n, e, arr))
  -- let list = ["key", "value"]
  let fkeys1 = getDeferredForeignKeysForEventCollection tableName creator a
      fkeys2 = getDeferredForeignKeysForArrayType tableName creator a arrType
  return $ fkeys1 ++ fkeys2

createHistoryTable' ::
  OutputM m =>
  Bool ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m ()
createHistoryTable' isAbstract contract cc (creator, a, n) = do
  let isEvent = False
      list = getTableColumnAndType isEvent cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
      listCombined = map (\(x, y) -> x <> " " <> y) list
  yield $ createHistoryTableQuery isAbstract (creator, a, n) listCombined

createHistoryTable ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m ()
createHistoryTable contract cc (creator, a, n) = do
  let list = getTableColumnAndType False cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
      listCombined = map (\(x,y)-> x <> " " <> y) list
  yield $ (createHistoryTableQuery False (creator, a, n) listCombined)
  yieldMany $ addHistoryUnique (creator, a, n)

-- Runs ALTER TABLE <name> [ADD COLUMN <column>] for any new fields added to a contract definition
expandIndexTable ::
  OutputM m =>
  --
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
expandIndexTable contract cc (creator, a, n) = do
  let tableName = indexTableName creator a n
  expandContractTable contract cc tableName

expandAbstractTable ::
  OutputM m =>
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Account, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
expandAbstractTable  contract (creator, a, n) abstracts' cc = do
  let tableName = abstractTableName creator a n
  expandAbstractContractTable  contract tableName abstracts' cc

expandHistoryTable ::
  OutputM m =>
  Bool ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m ()
expandHistoryTable isAbstract  contract cc (creator, a, n) = do
  let tableName = historyTableName creator a n
  void $ 
    if isAbstract
      then expandAbstractContractTable contract tableName Map.empty cc --abstracts' needs to be passed in for fkeys
      else expandContractTable' contract cc tableName

expandContractTable' ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  TableName ->
  ConduitM () Text m [ForeignKeyInfo]
expandContractTable'  contract cc tableName = do
  let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
      isEvent = False
      cols = getTableColumnAndType isEvent cc list
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
    yield $ expandTableQuery tableName colsCombined
  return $ []

expandContractTable ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  TableName ->
  ConduitM () Text m [ForeignKeyInfo]
expandContractTable  contract cc tableName = do
    let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
        isEvent = False
        cols = getTableColumnAndType isEvent cc list
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
      yield $ expandTableQuery tableName colsCombined
    case tableName of
      IndexTableName creator a _ -> getDeferredForeignKeys tableName contract cc creator a
      _ -> return $ []

expandAbstractContractTable ::
  OutputM m =>
  ContractF () ->
  TableName ->
  Map.Map (Account, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () Text m [ForeignKeyInfo]
expandAbstractContractTable  contract tableName abstracts' cc = do
  let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
      isEvent = False
      cols = getTableColumnAndType isEvent cc list
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

-- TODO: Remove once marketplace uses new naming convention ('-')
oldExpandTableQuery :: TableName -> TableColumns -> Text
oldExpandTableQuery tableName cols =
  T.concat
    [ "ALTER TABLE ",
      oldTableNameToDoubleQuoteText tableName,
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

insertCollectionTable ::
  OutputM m =>
  [ProcessedCollectionRow] ->
  ConduitM () Text m ()
insertCollectionTable [] = error "insertCollectionTable: unhandled empty list"
insertCollectionTable maps = do
  -- Removing duplicates with all relevant fields
  let newMaps = nubBy compareCollectionRows maps
  multilineLog "insertCollectionTable/newCollections" $ boringBox $ map show newMaps
  -- Sorting by 'creator', 'application', 'contractname' before grouping
  let sortedMaps = sortBy (comparing (\x -> (creator x, application x, contractname x))) newMaps
  -- Grouping by 'creator', 'application', 'contractname'
  let grouped = groupBy compareCollectionRows' sortedMaps
  -- Processing grouped data with another function if necessary
  let results = concatMap processGroupedData grouped
  yieldMany $ results

processGroupedData :: [ProcessedCollectionRow] -> [Text]
processGroupedData rows@(row:_) =
  case collectiontype row of
    "Array" -> insertArrayTableQuery rows
    "Event Array" -> insertEventArrayTableQuery rows
    _ -> insertMappingTableQuery rows
processGroupedData [] = []

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

insertAbstractTable ::
  OutputM m =>
  [(E.ProcessedContract, [T.Text], T.Text, TableColumns)] ->
  ConduitM () Text m ()
insertAbstractTable [] = pure ()
insertAbstractTable cs@((_, _,abTableName, _) : _) = do
  $logInfoS "insertAbstractTable" $ T.pack $ "Inserting row in abstract table for: " ++ show abTableName
  multilineLog "insertAbstractTable/processedContract" $ show cs
  yieldMany $ insertAbstractTableQuery cs
  
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

updateForeignKeysFromNULLArray ::
  OutputM m =>
  [ProcessedCollectionRow] ->
  ConduitM () Text m ()
updateForeignKeysFromNULLArray cs = do
  multilineLog "updateForeignKeysFromNULLArray/processedArrays" $ show cs
  yieldMany $ updateFkeysQueryArray cs

baseColumnsQuery :: [Text]
baseColumnsQuery = 
  [ 
    "address text",
    "block_hash text",
    "block_timestamp text",
    "block_number text",
    "transaction_hash text",
    "transaction_sender text",
    "creator text",
    "root text"
  ]

abstractBaseColumnsQuery :: [Text]
abstractBaseColumnsQuery = 
  baseColumnsQuery ++ 
  [
    "contract_name text",
    "data jsonb"
  ]

eventBaseColumnsQuery :: [Text]
eventBaseColumnsQuery =
  [
    "address text",
    "block_hash text",
    "block_timestamp text",
    "block_number text",
    "transaction_hash text",
    "transaction_sender text",
    "event_index int"
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
  let tableName = collectionTableName creator a n m
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $ baseColumnsQuery ++
            [ "contract_name text",
              "collectionname text",
              "collectiontype text",
              "key text",
              "value text"
            ],
          ",\n  PRIMARY KEY (address, key));"
        ]

createArrayTableQuery :: (Text, Text, Text, Text, Text) -> Text
createArrayTableQuery (creator, a, n, arr, arrType) =
  let tableName = collectionTableName creator a n arr
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $ baseColumnsQuery ++
            [ "contract_name text",
              "collectionname text",
              "collectiontype text",
              "key text",
              "value " <> arrType,
              "value_fkey text"
            ],
          ",\n  PRIMARY KEY (address, key));"
        ]

createEventArrayTableQuery :: (Text, Text, Text, Text, Text) -> Text
createEventArrayTableQuery (creator, a, n, e, arr) =
  let tableName = eventCollectionTableName creator a n e arr
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $ eventBaseColumnsQuery ++
            [ "contract_name text",
              "collectionname text",
              "collectiontype text",
              "key text",
              "value text",
              "value_fkey text"
            ],
          ");"
        ]


createAbstractTableQuery :: (Text, Text, Text) -> TableColumns -> Text
createAbstractTableQuery (creator, a, n) list =
  let tableName = abstractTableName creator a n
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText tableName,
          " (",
          csv $ abstractBaseColumnsQuery
              ++ list,
          ",\n  PRIMARY KEY (address));"
        ]

createHistoryTableQuery :: Bool -> (Text, Text, Text) ->  TableColumns -> Text
createHistoryTableQuery isAbstract (creator, a, n) cols =
  let historyTableName' = historyTableName creator a n
      normalTableName = bool (indexTableName creator a n) (abstractTableName creator a n) isAbstract
      triggerFunctionName = "\"" <> "insert_or_update_" <> tableNameToText normalTableName <> "_history_table" <> "\""
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          tableNameToDoubleQuoteText historyTableName',
          " (",
          csv $
            (bool baseColumnsQuery abstractBaseColumnsQuery isAbstract)
              ++ cols,
          ");\n\n",
          -- Create or replace the function for handling insert and update triggers
          "CREATE OR REPLACE FUNCTION ", triggerFunctionName, "() RETURNS TRIGGER AS $$\n",
          "BEGIN\n",
          "    RAISE NOTICE 'Trigger fired for % on table ", tableNameToText normalTableName, ": %', TG_OP, NEW.address;\n",
          "    IF TG_OP = 'INSERT' THEN\n",
          "        RAISE NOTICE 'Inserting into history table ", tableNameToText historyTableName', " for address: %', NEW.address;\n",
          "        INSERT INTO ",
          tableNameToDoubleQuoteText historyTableName',
          " VALUES (NEW.*);\n",
          "    ELSIF TG_OP = 'UPDATE' THEN\n",
          "        RAISE NOTICE 'Updating history table ", tableNameToText historyTableName', " for address: %', NEW.address;\n",
          "        INSERT INTO ",
          tableNameToDoubleQuoteText historyTableName',
          " VALUES (NEW.*);\n",
          "    END IF;\n",
          "    RETURN NEW;\n",
          "END;\n",
          "$$ LANGUAGE plpgsql;\n\n",
          -- Create trigger for insert operations
          "CREATE TRIGGER \"after_insert_on_",
          tableNameToText normalTableName, "\"",
          "\nAFTER INSERT ON ",
          tableNameToDoubleQuoteText normalTableName,
          "\nFOR EACH ROW EXECUTE PROCEDURE ", triggerFunctionName, "();\n\n",
          -- Create trigger for update operations
          "CREATE TRIGGER \"after_update_on_",
          tableNameToText normalTableName, "\"",
          "\nAFTER UPDATE ON ",
          tableNameToDoubleQuoteText normalTableName,
          "\nFOR EACH ROW EXECUTE PROCEDURE ", triggerFunctionName, "();"
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
            let tableName = 
                  indexTableName 
                    (case (E.cc_creator contract) of 
                      Just cc_creator' -> cc_creator' 
                      Nothing -> (E.creator contract)) 
                    (E.application contract)
                    (E.contractName contract)
                fkeyColumns = [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeys]
                keysForSQL = map fst list ++ fkeyColumns
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseColumns ++ keysForSQL
                baseVals =
                  [ tshow . E.address,
                    T.pack . keccak256ToHex . E.blockHash,
                    tshow . E.blockTimestamp,
                    tshow . E.blockNumber,
                    T.pack . keccak256ToHex . E.transactionHash,
                    tshow . E.transactionSender,
                    E.creator,
                    E.root
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


insertMappingTableQuery :: [ProcessedCollectionRow] -> [Text]
insertMappingTableQuery [] = []
insertMappingTableQuery ms =
  concat $
    let ms' = (\m -> (m, Map.toList $ Map.mapMaybe valueToSQLText $ Map.fromList [("key", collectionDataKey m), ("value", collectionDataValue m)])) <$> ms
     in flip map (map snd $ partitionWith (length . snd) ms') $ \case
          [] -> []
          mappings@((x, list) : _) ->
            let tableName =
                  collectionTableName
                    (case (cc_creator x) of 
                      Just cc_creator' -> cc_creator'
                      Nothing -> (creator x))
                    (application x)
                    (contractname x)
                    (collectionname x)
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseMappingTableColumns ++ map fst (fillFirstEmptyEntries list)
                baseVals =
                  [ tshow . address,
                    T.pack . keccak256ToHex . blockHash,
                    tshow . blockTimestamp,
                    tshow . blockNumber,
                    T.pack . keccak256ToHex . transactionHash,
                    tshow . transactionSender,
                    creator,
                    root,
                    contractname,
                    collectionname,
                    collectiontype
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
    collectionname = excluded.collectionname,
    collectiontype = excluded.collectiontype,
    value = excluded.value|],
                      ";"
                    ]

insertArrayTableQuery :: [ProcessedCollectionRow] -> [Text]
insertArrayTableQuery [] = []
insertArrayTableQuery ms =
  concat $
    let ms' = (\m -> (m, Map.toList $ Map.mapMaybe valueToSQLText $ Map.fromList [("key", collectionDataKey m), ("value", collectionDataValue m)])) <$> ms
     in flip map (map snd $ partitionWith (length . snd) ms') $ \case
          [] -> []
          arrays@((x, list) : _) ->
            let tableName =
                  collectionTableName
                    (creator x)
                    (application x)
                    (contractname x)
                    (collectionname x)
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseMappingTableColumns ++ map fst (fillFirstEmptyEntries list) ++ [T.pack "value_fkey"]
                baseVals =
                  [ tshow . address,
                    T.pack . keccak256ToHex . blockHash,
                    tshow . blockTimestamp,
                    tshow . blockNumber,
                    T.pack . keccak256ToHex . transactionHash,
                    tshow . transactionSender,
                    creator,
                    root,
                    contractname,
                    collectionname,
                    collectiontype
                  ]
                vals = flip map arrays $ \(row, rowList) ->
                  wrapAndEscape $ map (wrapSingleQuotes . ($ row)) baseVals ++ map snd rowList ++ [T.pack "NULL"]--value_fkey
                valsForSQL = vals
                inserts = csv valsForSQL
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
    collectionname = excluded.collectionname,
    collectiontype = excluded.collectiontype,
    value = excluded.value|],
                      ";"
                    ]

insertEventArrayTableQuery :: [ProcessedCollectionRow] -> [Text]
insertEventArrayTableQuery [] = []
insertEventArrayTableQuery ms =
  concat $
    let ms' = (\m -> (m, valueToSQLText $ collectionDataKey m, valueToSQLText $ collectionDataValue m)) <$> ms
     in flip map ms' $ \case
          (x,mk,mv) ->
            let tNull = T.pack "NULL"
                tableName =
                  eventCollectionTableName
                    (creator x)
                    (application x)
                    (contractname x)
                    (maybe "" fst $ eventInfo x)
                    (collectionname x)
                keySt = wrapAndEscapeDouble . map escapeQuotes $ baseEventCollectionColumns ++ (T.pack <$> ["key", "value", "value_fkey"])
                baseVals =
                  [ tshow . address,
                    T.pack . keccak256ToHex . blockHash,
                    tshow . blockTimestamp,
                    tshow . blockNumber,
                    T.pack . keccak256ToHex . transactionHash,
                    tshow . transactionSender,
                    tshow . maybe 0 snd . eventInfo,
                    contractname,
                    collectionname,
                    collectiontype
                  ]
                vals = wrapAndEscape $ map (wrapSingleQuotes . ($ x)) baseVals ++ [fromMaybe tNull mk, fromMaybe tNull mv, T.pack "NULL"]
             in (: []) $
                  T.concat
                    [ "INSERT INTO ",
                      tableNameToDoubleQuoteText tableName,
                      " ",
                      keySt,
                      "\n  VALUES ",
                      vals,
                      ";"
                    ]
insertAbstractTableQuery :: [(E.ProcessedContract, [T.Text], T.Text, TableColumns)] -> [Text]
insertAbstractTableQuery [] = error "insertAbstractTableQuery: unhandled empty list"
insertAbstractTableQuery cs =
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
                    E.creator,
                    E.root
                  ]
                (vals, dataVals') = unzip $ flip map contracts $ \((row, contractColumns), _) ->
                  let baseRowVals = map (wrapSingleQuotes . ($ row)) baseVals 
                      contractNameVal = [wrapSingleQuotes $ escapeQuotes (tableNameToText contractTableName)] 
                      dataVals = [wrapSingleQuotes (decodeUtf8 . BL.toStrict $ Aeson.encode $ MapWrapper $ aesonHelper (Map.filterWithKey (\k _ -> k `notElem` abColumns) contractColumns )) <> "::jsonb"]
                      -- jsonPathz = T.concat ["'{", csv (map (\(k, _) -> T.concat ["\"", escapeQuotes k, "\""]) (Map.toList dataVals)), "}'"]
                      -- jsonValuez = csv (map (wrapSingleQuotes . wrapDoubleQuotes . removeSingleQuotes . removeSingleQuotes) $ Map.elems dataVals)
                      regularVals = [(snd kv) | kv@(k, _) <- Map.toList contractColumns, k `elem` keysForSQL]
                      fkeyVals = ["NULL" | k <- fkeyColumns, k `elem` keysForSQL]  -- This avoids circular dependencies as the inserts occur first and set fkeys=null
                      valsForSQL = baseRowVals ++ contractNameVal ++ dataVals ++ regularVals ++ fkeyVals
                  in (wrapAndEscape valsForSQL, wrapAndEscape dataVals)
                inserts = csv vals
                dataVals'' = csv dataVals'
            in (: []) $
                  T.concat $
                    [ "INSERT INTO ",
                      abTableName,
                      " ",
                      keySt,
                      "\n  VALUES ",
                      inserts,
                      " ON CONFLICT (address) DO UPDATE SET\n",
                      "    block_hash = excluded.block_hash,\n",
                      "    block_timestamp = excluded.block_timestamp,\n",
                      "    block_number = excluded.block_number,\n",
                      "    transaction_hash = excluded.transaction_hash,\n",
                      "    transaction_sender = excluded.transaction_sender,\n",
                      "    contract_name = excluded.contract_name,\n",
                      "    data = ",
                      abTableName,
                      ".data || ",
                      if dataVals'' == "{}"
                        then "excluded.data::jsonb" 
                        else dataVals'',
                      if null keysForSQL then "" else ",\n    ",
                      tableUpsert keysForSQL,
                      ";"
                          ]

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

updateFkeysQueryArray :: [ProcessedCollectionRow] -> [Text]
updateFkeysQueryArray rows = concatMap createUpdateQuery rows
  where
    createUpdateQuery :: ProcessedCollectionRow -> [Text]
    createUpdateQuery c =
      let
        tableName = case eventInfo c of
              Just x  -> eventCollectionTableName (creator c) (application c) (contractname c) (fst x) (collectionname c)
              Nothing -> collectionTableName (creator c) (application c) (contractname c) (collectionname c)
        value_fkey = wrapAndEscapeDouble . map escapeQuotes $ [T.pack "value_fkey"]
        value = wrapAndEscapeDouble . map escapeQuotes $ [T.pack "value"]
        value' = wrapAndEscape [fromMaybe T.empty (valueToSQLText $ collectionDataValue c)]
      in
        [T.concat [ "UPDATE "
        , tableNameToDoubleQuoteText tableName
        , "\n  SET "
        , value_fkey
        , " = "
        , value
        , "\n  WHERE "
        , value
        , " = "
        , value'
        , ";"
        ]]

-- Creates tables for all event declarations, stores table name in
-- globals{createdEvents}
createExpandEventTables ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () Text m [ForeignKeyInfo]
createExpandEventTables c cc nameParts = fmap concat . mapM go . Map.toList $ c ^. events
  where
    go (evName, ev) = do
      fkInfo <- createEventTable nameParts evName ev cc
      expandEventTable nameParts evName ev cc
      return fkInfo

extractLabelOrEntry :: SVMType.Type -> T.Text
extractLabelOrEntry (SVMType.UnknownLabel solidString _) = T.pack solidString
extractLabelOrEntry entry = T.pack (show entry)

createEventTable ::
  OutputM m =>
  (Text, Text, Text) ->
  SolidString ->
  EventF () ->
  CodeCollectionF () ->

  ConduitM () Text m [ForeignKeyInfo]
createEventTable (creator, a, n) evName ev cc = do
  $logInfoS "createEventTable" . T.pack $ show ev
  let (crtr, app, cname) = constructTableNameParameters creator a n
      eventTable = EventTableName crtr app cname (escapeQuotes $ labelToText evName)
      isEvent = True
      evLogToPair (EventLog n' _ t') = (n', t')
      cols = getTableColumnAndType isEvent cc [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries . map evLogToPair $ ev ^. eventLogs]
      arrayNamesAndTypes = [(key, extractLabelOrEntry entry) | (key, IndexedType _ (SVMType.Array entry _)) <- map evLogToPair $ ev ^. eventLogs]
      indexedFields = map (wrapDoubleQuotes . escapeQuotes . fst)
                    . filter snd
                    . fillFirstEmptyEntries
                    $ [(key, indexed) | (EventLog key indexed _) <- ev ^. eventLogs]
      uniqueConstraint = case indexedFields of
        [] -> Nothing
        _ -> Just . wrapParens . csv $ "address" : indexedFields
      colsCombined = map (\(x,y)-> x <> " " <> y) cols
      eventFkeys = getDeferredForeignKeysForEvent eventTable crtr app
  $logInfoS "keys" (T.pack $ show arrayNamesAndTypes)
  -- eventAlreadyCreated <- isTableCreated eventTable
  -- unless eventAlreadyCreated $ do
  --   setTableCreated globalsIORef eventTable $ colsCombined
  --   yield $ createEventTableQuery eventTable colsCombined
  -- if eventAlreadyCreated
  --   then return []
  --   else do
    -- setTableCreated eventTable $ colsCombined
  yieldMany $ createEventTableQuery eventTable colsCombined uniqueConstraint
  eventArrayFkeys <- fmap concat . forM arrayNamesAndTypes $ \anat -> do
    createEventArrayTable (crtr, app, cname, (escapeQuotes $ labelToText evName)) anat
  return $ eventFkeys ++ eventArrayFkeys


createEventTableQuery :: TableName -> TableColumns -> Maybe Text -> [Text]
createEventTableQuery tableName cols uniqueConstraint =
  (\(i,n) -> T.concat
        [ "CREATE TABLE IF NOT EXISTS ",
          wrapDoubleQuotes . escapeQuotes $ (if i then "indexed@" else "") <> n,
          " (",
          csv $ ("id SERIAL NOT NULL" : eventBaseColumnsQuery) ++ cols,
          ", PRIMARY KEY (transaction_hash, event_index)",
          case (i, uniqueConstraint) of
            (True, Just uc) -> T.concat
              [
                ", CONSTRAINT ",
                wrapDoubleQuotes . escapeQuotes $ n <> "_indexed",
                " UNIQUE ",
                uc
              ]
            _ -> "",
          ");"
        ]
  ) <$> [(False, tableNameToText tableName), (False, oldTableNameToText tableName), (True, tableNameToText tableName)]

expandEventTable ::
  OutputM m =>
  (Text, Text, Text) ->
  SolidString ->
  EventF () ->
  CodeCollectionF() ->
  ConduitM () Text m ()
expandEventTable  (creator, a, n) evName ev cc = do
  let (crtr, app, cname) = constructTableNameParameters creator a n
      tableName = EventTableName crtr app cname (escapeQuotes $ labelToText evName)
      indexedTableName = EventTableName ("indexed@" <> crtr) app cname (escapeQuotes $ labelToText evName)
      isEvent = True
      evLogToPair (EventLog n' _ t') = (n', t')
      (allTableCols :: [(T.Text, T.Text)]) = getTableColumnAndType isEvent cc [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries . map evLogToPair $ ev ^. eventLogs]
      allTableColsCombined = map (\(x,y)-> x <> " " <> y) allTableCols
  unless (null allTableCols) $ do
    $logInfoS "expandEventTable" . T.pack $ "We just got new fields for a contract that already has a table!"
    $logInfoS "expandEventTable" $
      T.concat
        [ "Adding columns to ",
          (tableNameToText tableName),
          " for the following new fields: ",
          T.intercalate ", " allTableColsCombined
        ]
    yield $ expandTableQuery tableName allTableColsCombined
    yield $ oldExpandTableQuery tableName allTableColsCombined
    yield $ expandTableQuery indexedTableName allTableColsCombined

-- Function to convert AggregateEvent to ProcessedCollectionRow
aggEventToCollectionRows :: AggregateEvent -> [ProcessedCollectionRow]
aggEventToCollectionRows ae =
  case Action.evArgs ev of
    [] -> []
    args -> 
      let (arrayName, arrayElements) = getArraysFromEvents args
      in map (aggEventToCollectionRow ae ev (T.pack arrayName)) arrayElements
  where
    ev = eventEvent ae

aggEventToCollectionRow :: AggregateEvent -> Action.Event -> Text -> (Value, Value) -> ProcessedCollectionRow
aggEventToCollectionRow ae ev arrayName (index, value) =
  ProcessedCollectionRow
    { address = (_accountAddress . Action.evContractAccount) ev,
      creator = T.pack $ Action.evContractCreator ev,
      application = T.pack $ Action.evContractApplication ev,
      contractname = T.pack $ Action.evContractName ev,
      eventInfo = Just (T.pack $ Action.evName ev, eventIndex ae),
      collectionname = arrayName,
      collectiontype = "Event Array",
      blockHash = eventBlockHash ae,
      blockTimestamp = eventBlockTimestamp ae,
      blockNumber = eventBlockNumber ae,
      transactionHash = eventTxHash ae,
      transactionSender = _accountAddress $ eventTxSender ae,
      collectionDataKey = index,
      collectionDataValue = value,
      root = "",
      cc_creator = Just ""
    }

removeArrayEvArgs :: Action.Event -> Action.Event
removeArrayEvArgs ev = ev { Action.evArgs = filter (\(_, _, c) -> c /= "Array") (Action.evArgs ev) }

getArraysFromEvents :: [(String, String, String)] -> (String, [(Value, Value)])
getArraysFromEvents evArgs = do 
  let li = [(a, b) | (a, b, c) <- evArgs, c == "Array"]
  case li of 
    [] -> ("", [])
    (arrayName, arrayStr):_ -> 
         let elements = fromMaybe [] (Aeson.decode (BL.fromStrict $ TE.encodeUtf8 $ T.pack arrayStr) :: Maybe [String])
         in (arrayName, zip (map (SimpleValue . ValueString . T.pack . show) [0 :: Int ..]) 
                            (map (SimpleValue . ValueString . T.pack) elements))

insertEventTables :: 
  OutputM m =>
  [ProcessedCollectionRow] ->
  [AggregateEvent] ->
  ConduitM () Text m ()
insertEventTables processedEventArrays processedEventsWithoutArrays = do
  $logInfoS "insertEventTables/processedEventArrays" . T.pack $ show processedEventArrays
  $logInfoS "insertEventTables/processedEventsWithoutArrays" . T.pack $ show processedEventsWithoutArrays
  yieldMany . concat =<< lift (mapM (insertEventTable) processedEventsWithoutArrays)
      
  -- yieldMany . catMaybes =<< lift (mapM (insertEventTable) processedEventsWithoutArrays)
  when (not (null processedEventArrays)) $
    yieldMany $ insertEventArrayTableQuery processedEventArrays

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
      ((Account, Text), (Text, Text, [Text])) -> AggregateEvent
    createNewEvent ((_, n'), (c, a, _)) =
      ae { eventEvent = (eventEvent ae) {
        Action.evContractCreator = T.unpack c,
        Action.evContractApplication = T.unpack a,
        Action.evContractName = T.unpack n'
          }
      }

-- insertEventTable ::
--   OutputM m =>
--   AggregateEvent ->
--   m (Text)
-- insertEventTable agEv = do
--   let q = insertEventTableQuery agEv
--   multilineDebugLog "insertEventTable/SQL" $ T.unpack q
--   return q


insertEventTable ::
  OutputM m =>
  AggregateEvent ->
  m [Text]
insertEventTable agEv = do
  let q = insertEventTableQuery agEv
  multilineDebugLog "insertEventTable/SQL" $ T.unpack $ T.intercalate "\n" q
  return q

insertEventTableQuery :: AggregateEvent -> [Text]
insertEventTableQuery agEv@AggregateEvent {eventEvent = ev} =
  let (creator, a, cname) =
        constructTableNameParameters
          (T.pack $ Action.evContractCreator ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
      tableName = EventTableName creator a cname (escapeQuotes $ T.pack $ Action.evName ev)
      filledArgs = map fst . fillFirstEmptyEntries . map (\(aa, bb, _) -> (T.pack aa, bb)) $ Action.evArgs ev
      keySt = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumnsForEvent ++ filledArgs
      baseVals =
        [ tshow . _accountAddress . Action.evContractAccount . eventEvent,
          T.pack . keccak256ToHex . eventBlockHash,
          tshow . eventBlockTimestamp,
          tshow . eventBlockNumber,
          T.pack . keccak256ToHex . eventTxHash,
          tshow . eventTxSender,
          tshow . eventIndex
        ]
      vals = csv $ map (wrapSingleQuotes . escapeQuotes . ($ agEv)) baseVals ++ map (wrapSingleQuotes . escapeSingleQuotes . T.pack . (\(_, x, _) -> x)) (Action.evArgs ev)

   in (\(i,n) -> T.concat $
        [ "INSERT INTO ",
          wrapDoubleQuotes . escapeQuotes $ (if i then "indexed@" else "") <> n,
          " ",
          keySt,
          "\n  VALUES ( \n",
          vals,
          " )\n  ON CONFLICT ",
          if i
            then T.concat
              [ "ON CONSTRAINT ",
                wrapDoubleQuotes . escapeQuotes $ n <> "_indexed",
                " DO UPDATE SET",
                [r|
    address = excluded.address,
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender|],
                if null filledArgs then "" else ",\n    ",
                tableUpsert filledArgs,
                ";"
              ]
            else "DO NOTHING;"
        ]
      ) <$> [(False, tableNameToText tableName), (False, oldTableNameToText tableName), (True, tableNameToText tableName)]

------------------

--This is a temporary function that converts solidity types to a sample value...  I am just using this now to convert table creation from the old way (value based when values come through) to the new way (direct from the types when a CC is registered)
solidityTypeToSQLType :: Bool -> Maybe (ContractF ()) -> CodeCollectionF () -> SVMType.Type -> Maybe Text
solidityTypeToSQLType _ _ _ SVMType.Bool = Just "bool"
solidityTypeToSQLType _ _ _ (SVMType.Int _ _) = Just "decimal"
solidityTypeToSQLType _ _ _ (SVMType.String _) = Just "text"
solidityTypeToSQLType _ _ _ (SVMType.Bytes _ _) = Just "text"
solidityTypeToSQLType _ _ _ (SVMType.UserDefined _ _) = Just "text"
solidityTypeToSQLType _ _ _ SVMType.Decimal = Just "decimal"
solidityTypeToSQLType _ _ _ (SVMType.Address _) = Just "text"
solidityTypeToSQLType _ _ _ (SVMType.Account _) = Just "text"
solidityTypeToSQLType isEvent _ _ (SVMType.Array _ _) = if isEvent then Just "jsonb" else Nothing
solidityTypeToSQLType _ _ _ (SVMType.Mapping _ _ _) = Nothing -- Just "jsonb"
solidityTypeToSQLType _ mc cc (SVMType.UnknownLabel l _) = Just . maybe "text" (const "jsonb") $ (\c -> structDef c cc l) =<< mc
--solidityTypeToSQLType _ (SVMType.UnknownLabel x) = Just $ "text references " <> T.pack x <> "(id)"
solidityTypeToSQLType _ _ _ (SVMType.Struct _ _) = Just "jsonb"
solidityTypeToSQLType _ _ _ (SVMType.Enum _ _ _) = Just "text"
solidityTypeToSQLType _ _ _ (SVMType.Contract _) = Just "text"
solidityTypeToSQLType _ _ _ (SVMType.Error _ _) = Just "text"
solidityTypeToSQLType _ _ _ SVMType.Variadic = Nothing

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
valueToSQLText (ValueArrayFixed _ _) = Nothing
valueToSQLText (ValueArrayDynamic _) = Nothing
valueToSQLText struct@(ValueStruct _) = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ struct

valueToSQLText x = Just . wrapSingleQuotes . solidityValueToText . valueToSolidityValue $ x