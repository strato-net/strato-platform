{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE MonoLocalBinds  #-}
{-# LANGUAGE BlockArguments #-}
{-# LANGUAGE DataKinds #-}


module Blockchain.Slipstream.OutputData (
  SqlType(..),
  sqlTypePostgres,
  SlipstreamQuery(..),
  slipstreamQueryPostgres,
  slipstreamQueryText,
  outputData,
  outputData',
  outputDataDedup,
  OutputM,
  ProcessedCollectionRow(..),
  insertEventTables,
  insertIndexTable,
  insertCollectionTable,
  insertCollectionTableQuery,
  insertAbstractTable,
  insertAbstractTableQuery,
  createIndexTable,
  createCollectionTable,
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
  processParents,
  dbQueryCatchError
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
import           Data.Maybe                      (catMaybes, fromMaybe, listToMaybe, mapMaybe)
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Traversable                (for)
import           Bloc.Server.Utils               (partitionWith)
import           BlockApps.Logging
import           Blockchain.Slipstream.Data.Action
import qualified Blockchain.Slipstream.Events               as E
import           Blockchain.Slipstream.Options
import           Blockchain.Slipstream.QueryFormatHelper
import           Blockchain.Slipstream.SolidityValue
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
import           SolidVM.Model.CodeCollection    hiding (contractName, contracts, parents)
import           SolidVM.Model.SolidString
import qualified SolidVM.Model.Type              as SVMType
import           Text.Printf
import           Text.Tools
import           UnliftIO.Exception              (SomeException, handle)
import qualified Data.Text.Encoding as TE

newtype First b a = First {unFirst :: (a, b)}

instance Functor (First b) where
  fmap f (First (a, b)) = First (f a, b)

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

data SqlType = SqlBool | SqlDecimal | SqlText | SqlJsonb deriving (Eq, Ord, Show)

sqlTypePostgres :: SqlType -> Text
sqlTypePostgres SqlBool    = "bool"
sqlTypePostgres SqlDecimal = "decimal"
sqlTypePostgres SqlText    = "text"
sqlTypePostgres SqlJsonb   = "jsonb"

data SlipstreamQuery = CreateTable TableName [(Text, SqlType)] [Text] (Maybe (Text, Text))
                     | CreateIndex Text TableName [Text]
                     | InsertTable TableName [Text] [[Maybe Value]] [Text] [Text] (Maybe Text)
                     | InsertTableWithUC TableName [Text] [[Maybe Value]] (Maybe (Text, [Text]))
                     | AlterTableAddColumns TableName [(Text, SqlType)]
                     | AlterTableAddForeignKey Text ForeignKeyInfo
                     | AlterTableAddPrimaryKey TableName Text
                     | UpdateTable TableName [Text] [[Either Text (Maybe Value)]] [Text] [[Either Text (Maybe Value)]]
                     | NotifyPostgREST
                     deriving (Eq, Ord, Show)

slipstreamQueryPostgres :: SlipstreamQuery -> Text
slipstreamQueryPostgres = slipstreamQueryText sqlTypePostgres

slipstreamQueryText :: (SqlType -> Text) -> SlipstreamQuery -> Text
slipstreamQueryText sqlTypeText (CreateTable tableName cols pk mUc) = T.concat $
  [ "CREATE TABLE IF NOT EXISTS ",
    tableNameToDoubleQuoteText tableName,
    " (",
    csv $ (\(c,t) -> wrapDoubleQuotes (escapeDoubleQuotes c) <> " " <> sqlTypeText t) <$> cols,
    case pk of
      [] -> ""
      _ -> ",\n  PRIMARY KEY " <> wrapAndEscapeDouble pk,
    case mUc of
      Nothing -> ""
      Just (n, uc) -> T.concat
        [
          ", CONSTRAINT ",
          wrapDoubleQuotes $ escapeQuotes n,
          " UNIQUE ",
          uc
        ],
    ");"
  ] ++ (case tableName of
    HistoryTableName c a n ->
      let normalTableName = indexTableName c a n
          triggerFunctionName = "\"" <> "insert_or_update_" <> tableNameToText normalTableName <> "_history_table" <> "\""
       in [ "\n\n",
            -- Create or replace the function for handling insert and update triggers
            "CREATE OR REPLACE FUNCTION ", triggerFunctionName, "() RETURNS TRIGGER AS $$\n",
            "BEGIN\n",
            "    RAISE NOTICE 'Trigger fired for % on table ", tableNameToText normalTableName, ": %', TG_OP, NEW.address;\n",
            "    IF TG_OP = 'INSERT' THEN\n",
            "        RAISE NOTICE 'Inserting into history table ", tableNameToText tableName, " for address: %', NEW.address;\n",
            "        INSERT INTO ",
            tableNameToDoubleQuoteText tableName,
            " VALUES (NEW.*);\n",
            "    ELSIF TG_OP = 'UPDATE' THEN\n",
            "        RAISE NOTICE 'Updating history table ", tableNameToText tableName, " for address: %', NEW.address;\n",
            "        INSERT INTO ",
            tableNameToDoubleQuoteText tableName,
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
    _ -> [])
slipstreamQueryText _ (CreateIndex indexName tableName cols) = T.concat
  [ "CREATE UNIQUE INDEX IF NOT EXISTS "
  , wrapDoubleQuotes indexName
  , "\n  ON "
  , tableNameToDoubleQuoteText tableName
  , " "
  , wrapAndEscapeDouble cols
  , ";"
  ]
slipstreamQueryText _ (InsertTable tableName cols valss conflictCols conflictUpdateCols mExtraSQL) = T.concat
  [ "INSERT INTO ",
    tableNameToDoubleQuoteText tableName,
    " ",
    wrapAndEscapeDouble cols,
    "\n  VALUES ",
    csv $ wrapParens . csv . map (maybe "NULL" (wrapSingleQuotes . escapeSingleQuotes) . (valueToSQLText =<<)) <$> valss,
    "\n ON CONFLICT ",
    wrapAndEscapeDouble conflictCols,
    " DO UPDATE SET ",
    tableUpsert conflictUpdateCols,
    maybe "" (", " <>) mExtraSQL,
    ";"
  ]
slipstreamQueryText _ (InsertTableWithUC tableName cols valss mOnConflict) = T.concat
  [ "INSERT INTO ",
    tableNameToDoubleQuoteText tableName,
    " ",
    wrapAndEscapeDouble cols,
    "\n  VALUES ",
    csv $ wrapParens . csv . map (maybe "NULL" (wrapSingleQuotes . escapeSingleQuotes) . (valueToSQLText =<<)) <$> valss,
    "\n ON CONFLICT ",
    case mOnConflict of
      Just (constraintName, conflictUpdateCols) ->
        T.concat
              [ "ON CONSTRAINT ",
                wrapDoubleQuotes $ escapeQuotes constraintName,
                " DO UPDATE SET ",
                tableUpsert conflictUpdateCols,
                ";"
              ]
      _ -> "DO NOTHING;",
    ";"
  ]
slipstreamQueryText sqlTypeText (AlterTableAddColumns tableName cols) = T.concat
  [ "ALTER TABLE ",
    tableNameToDoubleQuoteText tableName,
    T.intercalate "," $ (\(c,t) -> " ADD COLUMN IF NOT EXISTS " <> wrapDoubleQuotes (escapeDoubleQuotes c) <> " " <> sqlTypeText t) <$> cols,
    ";"
  ]
slipstreamQueryText _ (AlterTableAddForeignKey fkName ForeignKeyInfo{..}) = T.concat
  [ "ALTER TABLE "
  , tableNameToDoubleQuoteText tableName
  , " ADD CONSTRAINT "
  , wrapDoubleQuotes fkName
  , " FOREIGN KEY "
  , wrapAndEscapeDouble columnNames
  , " REFERENCES "
  , tableNameToDoubleQuoteText foreignTableName
  , " "
  , wrapAndEscapeDouble foreignColumnNames
  , ";"
  ]
slipstreamQueryText _ (AlterTableAddPrimaryKey tableName indexName) =
        "ALTER TABLE "
          <> tableNameToDoubleQuoteText tableName
          <> " ADD PRIMARY KEY USING INDEX "
          <> wrapDoubleQuotes indexName
          <> ";"
slipstreamQueryText _ (UpdateTable tableName updateCols updateVals whereCols whereVals) = T.concat
  [ "UPDATE ",
    tableNameToDoubleQuoteText tableName,
    "\n  SET ",
    wrapAndEscapeDouble updateCols,
    " = ",
    csv $ wrapParens . csv . map (either id (maybe "NULL" wrapSingleQuotes . (valueToSQLText =<<))) <$> updateVals,
    "\n  WHERE ",
    wrapAndEscapeDouble whereCols,
    " = ",
    csv $ wrapParens . csv . map (either id (maybe "NULL" wrapSingleQuotes . (valueToSQLText =<<))) <$> whereVals,
    ";"
  ]
slipstreamQueryText _ NotifyPostgREST = "NOTIFY pgrst, 'reload schema';"

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
    collectionDataKeys :: [V.Value],
    collectionDataValue :: V.Value
  }
  deriving (Show)

crashOnSQLError :: Bool
crashOnSQLError = False

type OutputM m = MonadLogger m

fillEmptyEntries :: Functor f => [f Text] -> [f Text]
fillEmptyEntries = zipWith go [(1 :: Int) ..]
  where
    go i = fmap (\t -> if T.null t then "val_" <> tshow i else t)

fillFirstEmptyEntries :: [(Text, a)] -> [(Text, a)]
fillFirstEmptyEntries = map unFirst . fillEmptyEntries . map First

getTableColumnAndType :: Bool -> CodeCollectionF () -> [(Text, SVMType.Type)] -> [(T.Text, SqlType)]
getTableColumnAndType isEvent cc@(CodeCollection ccs _ _ _ _ _ _ _) = concatMap go . fillFirstEmptyEntries
  where
    go :: (Text, SVMType.Type) -> [(T.Text, SqlType)]
    go (x, y) =
      case solidityTypeToSQLType isEvent Nothing cc y of
        Nothing -> []
        Just v ->
          let defaultColumn = (x, v)
          in case y of
            SVMType.UnknownLabel s _ -> defaultColumn : bool [] [(x <> "_fkey", v)] (Map.member s ccs)
            _ -> [defaultColumn]

-- Considered partial because I'm assuming the TableColumns will always be in this format:
-- ["\"myCol1\" type1", "\"myCol2\" type2", "\"myCol3\" type3"]

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
  (MonadUnliftIO m, OutputM m) =>
  PGConnection ->
  ConduitM () (Text, Maybe ( TableName, TableColumns)) m a ->
  m a
outputData' conn c = runConduit $ c `fuseUpstream` mapM_C (dbQueryCatchError' conn)

outputData ::
  OutputM m =>
  ConduitM () SlipstreamQuery m a ->
  ConduitM i [SlipstreamQuery] m a
outputData c = do
  (a, cmds) <- lift . runConduit $ c `fuseBoth` sinkList -- mapM_C (dbQueryCatchError conn)
  yield cmds
  pure a

dedupC :: (Monad m, Ord a) => ConduitM a a m ()
dedupC = go Set.empty
  where go seen = await >>= \case
          Just a | not (a `Set.member` seen) -> yield a >> go (Set.insert a seen)
          Just _ -> go seen
          Nothing -> pure ()

outputDataDedup ::
  OutputM m =>
  ConduitM () SlipstreamQuery m a ->
  ConduitM i [SlipstreamQuery] m a
outputDataDedup c = do
  (a, cmds) <- lift . runConduit $ c `fuseBoth` (dedupC .| sinkList) -- mapM_C (dbQueryCatchError conn))
  yield cmds
  pure a

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
constructTableNameParameters crtr app contract
  | T.null crtr = ("", "", contract)
  | app == contract = (crtr, "", contract)
  | otherwise = (crtr, app, contract)

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
compareCollectionRows x y = collectionDataKeys x == collectionDataKeys y &&
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
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createExpandIndexTable c cc nameParts = do
  creationForeignKeys <- createIndexTable c cc nameParts
  expansionForeignKeys <- expandIndexTable c cc nameParts
  return $ creationForeignKeys ++ expansionForeignKeys

createExpandAbstractTable ::
  OutputM m =>
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Address, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createExpandAbstractTable c nameParts abstracts cc = do
  creationForeignKeys <- createAbstractTable c nameParts abstracts cc
  expansionForeignKeys <- expandAbstractTable c nameParts abstracts cc
  return $ creationForeignKeys ++ expansionForeignKeys


createForeignIndexesForJoins ::
  OutputM m =>
  ForeignKeyInfo ->
  ConduitM () SlipstreamQuery m ()
createForeignIndexesForJoins foreignKey = do
  let fkNameSrcToTarget = T.intercalate "_"
        [ tableNameToText (tableName foreignKey)
        , T.intercalate "_" $ columnNames foreignKey
        , tableNameToText (foreignTableName foreignKey)
        , T.intercalate "_" $ foreignColumnNames foreignKey
        , "fk"
        ]
      fkNameHash = T.pack . take 40 . formatKeccak256WithoutColor . hash $ encodeUtf8 fkNameSrcToTarget
      logMessage =
        "createForeignIndexesForJoins srcTable: " <> (T.pack $ show $ tableName foreignKey) <>
        ", targetTable: " <> (T.pack $ show $ foreignTableName foreignKey)
  $logInfoS "createForeignIndexesForJoins" logMessage
  -- Add new foreign key
  yield $ AlterTableAddForeignKey fkNameHash foreignKey

notifyPostgREST ::
  OutputM m =>
  ConduitM i [SlipstreamQuery] m ()
notifyPostgREST = yield [NotifyPostgREST]
  -- dbQueryCatchError conn "NOTIFY pgrst, 'reload schema';"

createExpandHistoryTable ::
  OutputM m =>
  Bool ->

  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m ()
createExpandHistoryTable isAbstract c cc nameParts = do
  createHistoryTable' isAbstract c cc nameParts
  expandHistoryTable isAbstract c cc nameParts

getDeferredForeignKeys :: (MonadLogger m) => TableName -> ContractF () -> CodeCollectionF () -> Text -> Text -> m [ForeignKeyInfo] --circular dependancy only fixed for abstract tables
getDeferredForeignKeys tableName c (CodeCollection ccs _ _ _ _ _ _ _) creator a =
  fmap catMaybes . for [(theName, x) | (theName, VariableDecl {_varType = SVMType.UnknownLabel x _}) <- Map.toList (c ^. storageDefs)] $ \(theName, x) -> do
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

getDeferredForeignKeysAbstract ::
  (MonadLogger m) =>
  TableName -> ContractF () -> Text -> Text -> Map.Map (Address, Text) (Text, Text, [Text]) -> CodeCollectionF () -> m [ForeignKeyInfo]
getDeferredForeignKeysAbstract tableName c creator a abstracts' cc@(CodeCollection ccs _ _ _ _ _ _ _) =
  fmap catMaybes . for [(theName, x) | (theName, VariableDecl {_varType = SVMType.UnknownLabel x _}) <- Map.toList (c ^. storageDefs)] $ \(theName, x) -> do
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

getDeferredForeignKeysForCollectionType :: TableName -> Text -> Text -> Text -> [ForeignKeyInfo]
getDeferredForeignKeysForCollectionType tableName creator a collectionType =
  [ ForeignKeyInfo
      { tableName = tableName,
        columnNames = [T.pack "value_fkey"],
        foreignTableName = indexTableName creator a collectionType,
        foreignColumnNames = [T.pack "address"]
      }
  ]

createIndexTable ::
  OutputM m=>
  --
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createIndexTable contract cc (creator, a, n) = do
  let tableName = indexTableName creator a n

  let isEvent = False
      list = getTableColumnAndType isEvent cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
  yield $ createIndexTableQuery (creator, a, n) list
  getDeferredForeignKeys tableName contract cc creator a

createAbstractTable ::
  OutputM m =>
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Address, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createAbstractTable contract (creator, a, n) abstracts' cc = do
  let tableName = abstractTableName creator a n
  let storageDefs' =  Map.toList $ contract ^. storageDefs
      isEvent = False
      list = getTableColumnAndType isEvent cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ storageDefs'
  yield $ createAbstractTableQuery (creator, a, n) list
  getDeferredForeignKeysAbstract tableName contract creator a abstracts' cc

createCollectionTable ::
  OutputM m =>
  (Text, Text, Text) ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, [SVMType.Type], SVMType.Type) ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createCollectionTable (creator, a, n) c cc (collectionName, keyTypes, valueType) = do
  let tableName = collectionTableName creator a n collectionName
      keySqlTypes = fromMaybe SqlText . solidityTypeToSQLType False (Just c) cc <$> keyTypes
      valueSqlType = fromMaybe SqlText $ solidityTypeToSQLType False (Just c) cc valueType
  yield $ createCollectionTableQuery creator a n collectionName keySqlTypes valueSqlType
  let fkeys1 = getDeferredForeignKeysForCollection tableName creator a
      fkeys2 = case valueType of
                (SVMType.UnknownLabel contractNameForFkey _) -> getDeferredForeignKeysForCollectionType tableName creator a (T.pack $ contractNameForFkey)
                _  -> []
  return $ fkeys1 ++ fkeys2

createEventArrayTable ::
  OutputM m =>
  (Text, Text, Text, Text) ->
  (Text, Text) ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createEventArrayTable (creator, a, n, e) (arr, arrType) = do
  let tableName = eventCollectionTableName creator a n e arr
  $logInfoS "createEventArrayTable/tableExists"  $ T.pack ( "Table Name: " ++ show tableName ++ ", table exists: ")
  $logInfoS "createEventArrayTable/(creator, a, n, e) " (T.pack $ show (creator, a, n, e))
  $logInfoS "createEventArrayTable/(arr, arrType) " (T.pack $ show (arr, arrType))
  yield $ (createEventArrayTableQuery (creator, a, n, e, arr))
  -- let list = ["key", "value"]
  let fkeys1 = getDeferredForeignKeysForEventCollection tableName creator a
      fkeys2 = getDeferredForeignKeysForCollectionType tableName creator a arrType
  return $ fkeys1 ++ fkeys2

createHistoryTable' ::
  OutputM m =>
  Bool ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m ()
createHistoryTable' isAbstract contract cc (creator, a, n) = do
  let isEvent = False
      list = getTableColumnAndType isEvent cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
  yield $ createHistoryTableQuery isAbstract (creator, a, n) list

createHistoryTable ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m ()
createHistoryTable contract cc (creator, a, n) = do
  let list = getTableColumnAndType False cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
  yield $ createHistoryTableQuery False (creator, a, n) list
  yieldMany $ addHistoryUnique (creator, a, n)

-- Runs ALTER TABLE <name> [ADD COLUMN <column>] for any new fields added to a contract definition
expandIndexTable ::
  OutputM m =>
  --
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
expandIndexTable contract cc (creator, a, n) = do
  let tableName = indexTableName creator a n
  expandContractTable contract cc tableName

expandAbstractTable ::
  OutputM m =>
  ContractF () ->
  (Text, Text, Text) ->
  Map.Map (Address, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
expandAbstractTable  contract (creator, a, n) abstracts' cc = do
  let tableName = abstractTableName creator a n
  expandAbstractContractTable  contract tableName abstracts' cc

expandHistoryTable ::
  OutputM m =>
  Bool ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m ()
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
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
expandContractTable'  contract cc tableName = do
  let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
      isEvent = False
      cols = getTableColumnAndType isEvent cc list
      colsCombined = map (\(x,y) -> x <> " " <> tshow y) cols
  unless (null cols) $ do
    $logInfoS "expandTable" . T.pack $ "We just got fields for a contract that already has a table!"
    $logInfoS "expandTable" $
      T.concat
        [ "Adding columns to ",
          (tableNameToText tableName),
          " for the following fields: ",
          T.intercalate ", " colsCombined
        ]
    yield $ expandTableQuery tableName cols
  return $ []

expandContractTable ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  TableName ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
expandContractTable  contract cc tableName = do
    let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
        isEvent = False
        cols = getTableColumnAndType isEvent cc list
        colsCombined = map (\(x,y)-> x <> " " <> tshow y) cols
    unless (null colsCombined) $ do
      $logInfoS "expandTable" . T.pack $ "We just got fields for a contract that already has a table!"
      $logInfoS "expandTable" $
        T.concat
          [ "Adding columns to ",
            (tableNameToText tableName),
            " for the following fields: ",
            T.intercalate ", " colsCombined
          ]
      yield $ expandTableQuery tableName cols
    case tableName of
      IndexTableName creator a _ -> getDeferredForeignKeys tableName contract cc creator a
      _ -> return $ []

expandAbstractContractTable ::
  OutputM m =>
  ContractF () ->
  TableName ->
  Map.Map (Address, Text) (Text, Text, [Text]) ->
  CodeCollectionF () ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
expandAbstractContractTable  contract tableName abstracts' cc = do
  let list = fillFirstEmptyEntries . map (fmap _varType) . Map.toList $ Map.mapKeys labelToText $ contract ^. storageDefs
      isEvent = False
      cols = getTableColumnAndType isEvent cc list
      colsCombined = map (\(x,y)-> x <> " " <> tshow y) cols
  unless (null colsCombined) $ do
    $logInfoS "expandAbstractContractTable" . T.pack $ "We just got new fields for a contract that already has a table!"
    $logInfoS "expandAbstractContractTable" $
      T.concat
        [ "Adding columns to ",
          (tableNameToText tableName),
          " for the following new fields: ",
          T.intercalate ", " colsCombined
        ]
    yield $ expandAbstractTableQuery tableName cols
  case tableName of
    AbstractTableName creator a _ -> getDeferredForeignKeysAbstract tableName contract creator a abstracts' cc
    _ -> return $ []

expandTableQuery :: TableName -> [(Text, SqlType)] -> SlipstreamQuery
expandTableQuery = AlterTableAddColumns

expandAbstractTableQuery :: TableName -> [(Text, SqlType)] -> SlipstreamQuery
expandAbstractTableQuery tableName cols = AlterTableAddColumns tableName (cols ++ abstractCols)
  where abstractCols = [("contract_name", SqlText), ("data", SqlJsonb)]

insertIndexTable ::
  OutputM m =>
  (E.ProcessedContract, [T.Text]) ->
  ConduitM () SlipstreamQuery m ()
insertIndexTable contract = do
  yield $ insertIndexTableQuery contract

insertCollectionTable ::
  OutputM m =>
  [ProcessedCollectionRow] ->
  ConduitM () SlipstreamQuery m ()
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
  yieldMany results

processGroupedData :: [ProcessedCollectionRow] -> [SlipstreamQuery]
processGroupedData rows@(row:_) =
  case collectiontype row of
    "Event Array" -> insertEventArrayTableQuery rows
    _ -> insertCollectionTableQuery rows
processGroupedData [] = []

insertAbstractTable ::
  OutputM m =>
  [(E.ProcessedContract, [T.Text], TableName, TableColumns)] ->
  ConduitM () SlipstreamQuery m ()
insertAbstractTable [] = pure ()
insertAbstractTable cs@((_, _,abTableName, _) : _) = do
  $logInfoS "insertAbstractTable" $ "Inserting row in abstract table for: " <> tableNameToText abTableName
  multilineLog "insertAbstractTable/processedContract" $ show cs
  yieldMany $ insertAbstractTableQuery cs

updateForeignKeysFromNULLAbstract ::
  OutputM m =>
  [(E.ProcessedContract, [T.Text], TableName, TableColumns)] ->
  ConduitM () SlipstreamQuery m ()
updateForeignKeysFromNULLAbstract [] = pure ()
updateForeignKeysFromNULLAbstract cs = do
  multilineLog "updateForeignKeysFromNULLAbstract/processedContract" $ show cs
  yieldMany $ updateFkeysQueryAbstract cs

updateForeignKeysFromNULLIndex ::
  OutputM m =>
  (E.ProcessedContract, [T.Text]) ->
  ConduitM () SlipstreamQuery m ()
updateForeignKeysFromNULLIndex cs = do
  multilineLog "updateForeignKeysFromNULLIndex/processedContract" $ show cs
  yieldMany $ updateFkeysQueryIndex cs

updateForeignKeysFromNULLArray ::
  OutputM m =>
  [ProcessedCollectionRow] ->
  ConduitM () SlipstreamQuery m ()
updateForeignKeysFromNULLArray cs = do
  multilineLog "updateForeignKeysFromNULLArray/processedArrays" $ show cs
  yieldMany $ updateFkeysQueryArray cs

baseColumnsQuery :: [(Text, SqlType)]
baseColumnsQuery =
  [
    ("address", SqlText),
    ("block_hash", SqlText),
    ("block_timestamp", SqlText),
    ("block_number", SqlText),
    ("transaction_hash", SqlText),
    ("transaction_sender", SqlText),
    ("creator", SqlText),
    ("root", SqlText)
  ]

abstractBaseColumnsQuery :: [(Text, SqlType)]
abstractBaseColumnsQuery =
  baseColumnsQuery ++
  [
    ("contract_name", SqlText),
    ("data", SqlJsonb)
  ]

eventBaseColumnsQuery :: [(Text, SqlType)]
eventBaseColumnsQuery =
  [
    ("address", SqlText),
    ("block_hash", SqlText),
    ("block_timestamp", SqlText),
    ("block_number", SqlText),
    ("transaction_hash", SqlText),
    ("transaction_sender", SqlText),
    ("event_index", SqlDecimal)
  ]

createIndexTableQuery :: (Text, Text, Text) -> [(Text, SqlType)] -> SlipstreamQuery
createIndexTableQuery (creator, a, n) cols =
  let tableName = indexTableName creator a n
   in CreateTable tableName (baseColumnsQuery ++ cols) ["address"] Nothing

keyColumnNames :: [a] -> [(Text, a)]
keyColumnNames = zipWith (\i t -> ("key" <> (if i == 1 then "" else T.pack $ show i), t)) [(1 :: Int)..]

createCollectionTableQuery :: Text -> Text -> Text -> Text -> [SqlType] -> SqlType -> SlipstreamQuery
createCollectionTableQuery creator a n collectionName keyTypes valueType =
  let tableName = collectionTableName creator a n collectionName
      keyNames = keyColumnNames keyTypes
      cols = baseColumnsQuery ++
             [ ("contract_name", SqlText),
               ("collectionname", SqlText),
               ("collectiontype", SqlText)
             ]
             ++ keyNames ++
             [ ("value", valueType),
               ("value_fkey", SqlText)
             ]
      pk = "address" : (fst <$> keyNames)
   in CreateTable tableName cols pk Nothing

createEventArrayTableQuery :: (Text, Text, Text, Text, Text) -> SlipstreamQuery
createEventArrayTableQuery (creator, a, n, e, arr) =
  let tableName = eventCollectionTableName creator a n e arr
      cols = eventBaseColumnsQuery ++
        [ ("contract_name", SqlText),
          ("collectionname", SqlText),
          ("collectiontype", SqlText),
          ("key", SqlText),
          ("value", SqlText),
          ("value_fkey", SqlText)
        ]
   in CreateTable tableName cols [] Nothing

createAbstractTableQuery :: (Text, Text, Text) -> [(Text, SqlType)] -> SlipstreamQuery
createAbstractTableQuery (creator, a, n) list =
  let tableName = abstractTableName creator a n
   in CreateTable tableName (abstractBaseColumnsQuery ++ list) ["address"] Nothing

createHistoryTableQuery :: Bool -> (Text, Text, Text) -> [(Text, SqlType)] -> SlipstreamQuery
createHistoryTableQuery isAbstract (creator, a, n) cols =
  let historyTableName' = historyTableName creator a n
      cols' = bool baseColumnsQuery abstractBaseColumnsQuery isAbstract ++ cols
   in CreateTable historyTableName' cols' [] Nothing

addHistoryUnique :: (Text, Text, Text) -> [SlipstreamQuery]
addHistoryUnique (creator, a, n) =
  let (crtr, app, cname) = constructTableNameParameters creator a n
      historyName = HistoryTableName crtr app cname
      indexName = "index_" <> escapeQuotes (tableNameToText historyName)
   in [ CreateIndex indexName historyName ["address", "block_hash", "transaction_hash"],
        AlterTableAddPrimaryKey historyName indexName
      ]

insertIndexTableQuery :: (E.ProcessedContract, [T.Text]) -> SlipstreamQuery -- does not accomodate extra _fkey 
insertIndexTableQuery cs =
    let cs' = (\(c@E.ProcessedContract {contractData = contractData}, fkeys) -> ((c, Map.toList contractData), fkeys)) cs
        processContract ((contract, list), fkeys) =
            let tableName =
                  indexTableName
                    (fromMaybe (E.creator contract) (E.cc_creator contract))
                    (E.application contract)
                    (E.contractName contract)
                fkeyColumns = [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeys]
                keysForSQL = map fst list ++ fkeyColumns
                keySt = baseColumns ++ keysForSQL
                baseVals =
                  [ ValueAddress . E.address,
                    ValueString . T.pack . keccak256ToHex . E.blockHash,
                    ValueString . tshow . E.blockTimestamp,
                    ValueInt False Nothing . E.blockNumber,
                    ValueString . T.pack . keccak256ToHex . E.transactionHash,
                    ValueAddress . E.transactionSender,
                    ValueString . E.creator,
                    ValueString . E.root
                  ]
                baseRowVals = map (Just . SimpleValue . ($ contract)) baseVals
                contractValEntries = list
                regularVals = [Just (snd kv) | kv@(k, _) <- contractValEntries, k `elem` keysForSQL]
                fkeyVals = [Nothing | k <- fkeyColumns, k `elem` keysForSQL]
                valsForSQL = baseRowVals ++ regularVals ++ fkeyVals
                conflictUpdateBaseCols = ["address", "block_hash", "block_timestamp", "block_number", "transaction_hash", "transaction_sender"]
                conflictUpdateCols = conflictUpdateBaseCols ++ keysForSQL
            in InsertTable tableName keySt [valsForSQL] ["address"] conflictUpdateCols Nothing
    in processContract cs'

insertCollectionTableQuery :: [ProcessedCollectionRow] -> [SlipstreamQuery]
insertCollectionTableQuery [] = []
insertCollectionTableQuery rows =
  concatMap renderInsert groupedRows
  where
    prepareRow m =
      let val = collectionDataValue m
          isObject = case val of
                       V.ValueStruct _ -> True
                       _               -> False
          keyValuePairs = keyColumnNames (collectionDataKeys m) ++ [("value", val)]
       in (m, isObject,) $ fmap Just <$> keyValuePairs

    preparedRows = map prepareRow rows

    groupedRows =
      map snd $
        partitionWith (\(_, isObj, pairs) -> (length pairs, isObj)) preparedRows

    renderInsert [] = []
    renderInsert group@((x, isMerge, rowList) : _) =
      let tblName = collectionTableName (creator x) (application x) (contractname x) (collectionname x)
          tblText = tableNameToDoubleQuoteText tblName

          onConflictCols = "address" : map fst (keyColumnNames $ collectionDataKeys x)

          columns = baseMappingTableColumns ++ map fst (fillFirstEmptyEntries rowList) ++ ["value_fkey"]

          baseFields =
            [ ValueAddress . address,
              ValueString . T.pack . keccak256ToHex . blockHash,
              ValueString . tshow . blockTimestamp,
              ValueInt False Nothing . blockNumber,
              ValueString . T.pack . keccak256ToHex . transactionHash,
              ValueAddress . transactionSender,
              ValueString . creator,
              ValueString . root,
              ValueString . contractname,
              ValueString . collectionname,
              ValueString . collectiontype
            ]

          valueTuples =
            map
              ( \(row, _, kvs) ->
                  map (Just . SimpleValue . ($ row)) baseFields ++ map snd kvs ++ [Nothing]
              )
              group

          valueUpdateSQL =
            if isMerge
              then
                T.concat
                  [ "value = CASE WHEN excluded.value IS NOT NULL AND ",
                    tblText,
                    ".value IS NOT NULL ",
                    "AND pg_typeof(excluded.value) = 'jsonb'::regtype ",
                    "AND pg_typeof(",
                    tblText,
                    ".value) = 'jsonb'::regtype ",
                    "AND jsonb_typeof(excluded.value) = 'object' ",
                    "AND jsonb_typeof(",
                    tblText,
                    ".value) = 'object' ",
                    "THEN ",
                    tblText,
                    ".value || excluded.value ",
                    "WHEN excluded.value IS NOT NULL THEN excluded.value ",
                    "ELSE ",
                    tblText,
                    ".value END"
                  ]
              else
                T.concat
                  ["value = COALESCE(excluded.value, ", tblText, ".value)"]

          updateSet =
              [ "address",
                "block_hash",
                "block_timestamp",
                "block_number",
                "transaction_hash",
                "transaction_sender",
                "contract_name",
                "collectionname",
                "collectiontype"
              ]
       in [InsertTable tblName columns valueTuples onConflictCols updateSet (Just valueUpdateSQL)]

insertEventArrayTableQuery :: [ProcessedCollectionRow] -> [SlipstreamQuery]
insertEventArrayTableQuery [] = []
insertEventArrayTableQuery ms =
  concat $
    let ms' = mapMaybe (\m -> (\k -> (m, k, collectionDataValue m)) <$> listToMaybe (collectionDataKeys m)) ms
     in flip map ms' $ \case
          (x,k,v) ->
            let tableName =
                  eventCollectionTableName
                    (creator x)
                    (application x)
                    (contractname x)
                    (maybe "" fst $ eventInfo x)
                    (collectionname x)
                keySt = baseEventCollectionColumns ++ (T.pack <$> ["key", "value", "value_fkey"])
                baseVals =
                  [ ValueAddress . address,
                    ValueString . T.pack . keccak256ToHex . blockHash,
                    ValueString . tshow . blockTimestamp,
                    ValueInt False Nothing . blockNumber,
                    ValueString . T.pack . keccak256ToHex . transactionHash,
                    ValueAddress . transactionSender,
                    ValueInt False Nothing . fromIntegral . maybe 0 snd . eventInfo,
                    ValueString . contractname,
                    ValueString . collectionname,
                    ValueString . collectiontype
                  ]
                vals = map (Just . SimpleValue . ($ x)) baseVals ++ [Just k, Just v, Nothing]
             in [InsertTable tableName keySt [vals] [] [] Nothing]

insertAbstractTableQuery :: [(E.ProcessedContract, [T.Text], TableName, TableColumns)] -> [SlipstreamQuery]
insertAbstractTableQuery [] = error "insertAbstractTableQuery: unhandled empty list"
insertAbstractTableQuery cs =
  concat $
    let cs' = (\(c@E.ProcessedContract {contractData = contractData}, fkeys, ab, abColumns) ->
                ((c, contractData), (ab, abColumns, fkeys))) <$> cs
     in flip map (map snd $ partitionWith ((\(ab, _, _) -> ab) . snd) cs') $ \case
          [] -> []
          contracts@(((x, list), (abTableName, abColumns, fkeys)) : _) ->
            let contractTableName =
                  abstractTableName (E.creator x) (E.application x) (E.contractName x)
                list' = Map.toList $ Map.filterWithKey (\k _ -> k `elem` abColumns) list
                fkeyColumns = [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeys, k `elem` abColumns]
                keysForSQL = map fst list' ++ fkeyColumns
                keySt = baseAbstractColumns ++ keysForSQL
                baseVals =
                  [ ValueAddress . E.address,
                    ValueString . T.pack . keccak256ToHex . E.blockHash,
                    ValueString . tshow . E.blockTimestamp,
                    ValueInt False Nothing . E.blockNumber,
                    ValueString . T.pack . keccak256ToHex . E.transactionHash,
                    ValueAddress . E.transactionSender,
                    ValueString . E.creator,
                    ValueString . E.root
                  ]
                (vals, dataVals') = unzip $ flip map contracts $ \((row, contractColumns), _) ->
                  let baseRowVals = map (Just . SimpleValue . ($ row)) baseVals
                      contractNameVal = [Just . SimpleValue . ValueString $ escapeQuotes (tableNameToText contractTableName)]
                      dataVals = [Just . ValueMapping . Map.fromList $ mapMaybe
                        (\(k, v) -> if k `notElem` abColumns
                                      then Just (ValueString k, v)
                                      else Nothing) $ Map.toList contractColumns]
                      dataValsText = [wrapSingleQuotes (decodeUtf8 . BL.toStrict $ Aeson.encode $ MapWrapper $ aesonHelper (Map.filterWithKey (\k _ -> k `notElem` abColumns) $ Map.mapMaybe valueToSQLText contractColumns )) <> "::jsonb"]
                      -- jsonPathz = T.concat ["'{", csv (map (\(k, _) -> T.concat ["\"", escapeQuotes k, "\""]) (Map.toList dataVals)), "}'"]
                      -- jsonValuez = csv (map (wrapSingleQuotes . wrapDoubleQuotes . removeSingleQuotes . removeSingleQuotes) $ Map.elems dataVals)
                      regularVals = [Just $ snd kv | kv@(k, _) <- Map.toList contractColumns, k `elem` keysForSQL]
                      fkeyVals = [Nothing | k <- fkeyColumns, k `elem` keysForSQL]  -- This avoids circular dependencies as the inserts occur first and set fkeys=null
                      valsForSQL = baseRowVals ++ contractNameVal ++ dataVals ++ regularVals ++ fkeyVals
                  in (valsForSQL, wrapAndEscape dataValsText)
                dataVals'' = csv dataVals'
                updateSet =
                  [ "block_hash",
                    "block_timestamp",
                    "block_number",
                    "transaction_hash",
                    "transaction_sender",
                    "contract_name"
                  ] ++ keysForSQL
                mExtraSQL = Just $ T.concat
                  [ "    data = ",
                    tableNameToDoubleQuoteText abTableName,
                    ".data || ",
                    if dataVals'' == "{}"
                      then "excluded.data::jsonb"
                      else dataVals''
                  ]
            in [InsertTable abTableName keySt vals ["address"] updateSet mExtraSQL]

-- Result: UPDATE table SET (fkey1,fkey2, ...)=(val1,val2, ...) where (fkey1_fkey,fkey2_fkey, ...)=(val1,val2, ...);
updateFkeysQueryAbstract :: [(E.ProcessedContract, [T.Text], TableName, TableColumns)] -> [SlipstreamQuery]
updateFkeysQueryAbstract cs =
  concat $
    let cs' = (\(c@E.ProcessedContract {contractData = contractData}, fkeys, ab, abColumns) ->
                ((c, contractData), (ab, abColumns, fkeys))) <$> cs
     in flip map (map snd $ partitionWith ((\(ab, _, _) -> ab) . snd) cs') $ \case
          [] -> []
          contracts@(((_, _), (abTableName, abColumns, fkeys)) : _) ->
            let fkeyColumns = [ k | k <- fkeys, k `elem` abColumns]
                fkeyColumnsWithPostFix = (<> "_fkey") <$> fkeyColumns
                vals = flip map contracts $ \((_, contractColumns), _) ->
                  let
                    contractValEntries = Map.toList contractColumns
                    fkeyVals = [Right . Just $ snd kv | kv@(k, _) <- contractValEntries, k `elem` fkeys]
                   in fkeyVals
            in [UpdateTable abTableName fkeyColumnsWithPostFix vals fkeyColumns vals | not (null fkeyColumns)]

updateFkeysQueryIndex :: (E.ProcessedContract, [T.Text]) -> [SlipstreamQuery]
updateFkeysQueryIndex (c@E.ProcessedContract {contractData = contractData}, fkeys) =
  let contractColumns = Map.toList contractData
      tableName = indexTableName (E.creator c) (E.application c) (E.contractName c)
      fkeyValues = [(k, v) | (k, v) <- contractColumns, k `elem` fkeys]
      fkeyColumns = map fst fkeyValues
      fkeyColumnsWithPostFix = (<> "_fkey") <$> fkeyColumns
      vals = Right . Just . snd <$> fkeyValues
  in [UpdateTable tableName fkeyColumnsWithPostFix [vals] fkeyColumns [vals] | not (null fkeyColumns)]

updateFkeysQueryArray :: [ProcessedCollectionRow] -> [SlipstreamQuery]
updateFkeysQueryArray rows = concatMap createUpdateQuery rows
  where
    createUpdateQuery :: ProcessedCollectionRow -> [SlipstreamQuery]
    createUpdateQuery c =
      let
        tableName = case eventInfo c of
              Just x  -> eventCollectionTableName (creator c) (application c) (contractname c) (fst x) (collectionname c)
              Nothing -> collectionTableName (creator c) (application c) (contractname c) (collectionname c)
      in [UpdateTable tableName ["value_fkey"] [[Left "value"]] ["value"] [[Right . Just $ collectionDataValue c]]]

-- Creates tables for all event declarations, stores table name in
-- globals{createdEvents}
createExpandEventTables ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
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

  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
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
  yieldMany $ createEventTableQuery eventTable cols uniqueConstraint
  eventArrayFkeys <- fmap concat . forM arrayNamesAndTypes $
    createEventArrayTable (crtr, app, cname, escapeQuotes $ labelToText evName)
  return $ eventFkeys ++ eventArrayFkeys


createEventTableQuery :: TableName -> [(Text, SqlType)] -> Maybe Text -> [SlipstreamQuery]
createEventTableQuery tableName cols uniqueConstraint =
  (\(i,n) ->
    let tableName' = if i then indexedEventTableName tableName else tableName
        pKey = ["transaction_hash", "event_index"]
        mUc = case (i, uniqueConstraint) of
          (True, Just uc) -> Just (n <> "_indexed", uc)
          _ -> Nothing
     in CreateTable tableName' (eventBaseColumnsQuery ++ cols) pKey mUc
  ) <$> [(False, tableNameToText tableName), (True, tableNameToText tableName)]

expandEventTable ::
  OutputM m =>
  (Text, Text, Text) ->
  SolidString ->
  EventF () ->
  CodeCollectionF() ->
  ConduitM () SlipstreamQuery m ()
expandEventTable  (creator, a, n) evName ev cc = do
  let (crtr, app, cname) = constructTableNameParameters creator a n
      tableName = EventTableName crtr app cname (escapeQuotes $ labelToText evName)
      indexedTableName = EventTableName ("indexed@" <> crtr) app cname (escapeQuotes $ labelToText evName)
      isEvent = True
      evLogToPair (EventLog n' _ t') = (n', t')
      (allTableCols :: [(T.Text, SqlType)]) = getTableColumnAndType isEvent cc [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries . map evLogToPair $ ev ^. eventLogs]
      allTableColsCombined = map (\(x,y)-> x <> " " <> tshow y) allTableCols
  unless (null allTableCols) $ do
    $logInfoS "expandEventTable" . T.pack $ "We just got new fields for a contract that already has a table!"
    $logInfoS "expandEventTable" $
      T.concat
        [ "Adding columns to ",
          (tableNameToText tableName),
          " for the following new fields: ",
          T.intercalate ", " allTableColsCombined
        ]
    yield $ expandTableQuery tableName allTableCols
    yield $ expandTableQuery indexedTableName allTableCols

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
    { address = Action.evContractAddress ev,
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
      transactionSender = eventTxSender ae,
      collectionDataKeys = [index],
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
  ConduitM () SlipstreamQuery m ()
insertEventTables processedEventArrays processedEventsWithoutArrays = do
  $logInfoS "insertEventTables/processedEventArrays" . T.pack $ show processedEventArrays
  $logInfoS "insertEventTables/processedEventsWithoutArrays" . T.pack $ show processedEventsWithoutArrays
  yieldMany . concat =<< lift (mapM insertEventTable processedEventsWithoutArrays)

  -- yieldMany . catMaybes =<< lift (mapM (insertEventTable) processedEventsWithoutArrays)
  unless (null processedEventArrays) .
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
      ((Address, Text), (Text, Text, [Text])) -> AggregateEvent
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
  m [SlipstreamQuery]
insertEventTable agEv = do
  let q = insertEventTableQuery agEv
  multilineDebugLog "insertEventTable/SQL" $ T.unpack $ T.intercalate "\n" $ slipstreamQueryText tshow <$> q
  return q

insertEventTableQuery :: AggregateEvent -> [SlipstreamQuery]
insertEventTableQuery agEv@AggregateEvent {eventEvent = ev} =
  let (creator, a, cname) =
        constructTableNameParameters
          (T.pack $ Action.evContractCreator ev)
          (T.pack $ Action.evContractApplication ev)
          (T.pack $ Action.evContractName ev)
      tableName = EventTableName creator a cname (escapeQuotes $ T.pack $ Action.evName ev)
      filledArgs = map fst . fillFirstEmptyEntries . map (\(aa, bb, _) -> (T.pack aa, bb)) $ Action.evArgs ev
      keySt = baseTableColumnsForEvent ++ filledArgs
      baseVals =
        [ ValueAddress . Action.evContractAddress . eventEvent,
          ValueString . T.pack . keccak256ToHex . eventBlockHash,
          ValueString . tshow . eventBlockTimestamp,
          ValueInt False Nothing . eventBlockNumber,
          ValueString . T.pack . keccak256ToHex . eventTxHash,
          ValueAddress . eventTxSender,
          ValueInt False Nothing . fromIntegral . eventIndex
        ]
      vals = Just . SimpleValue <$> map ($ agEv) baseVals ++ map (\(_, x, _) -> ValueString $ T.pack x) (Action.evArgs ev)

   in (\(i,n) ->
        let tn = if i then indexedEventTableName n else n
            occs = ["address", "block_hash", "block_timestamp", "block_number", "transaction_hash", "transaction_sender"]
            mOc = if i
                   then Just (tableNameToText n <> "_indexed", occs ++ filledArgs)
                   else Nothing
         in InsertTableWithUC tn keySt [vals] mOc
      ) <$> [(False, tableName), (True, tableName)]

------------------

--This is a temporary function that converts solidity types to a sample value...  I am just using this now to convert table creation from the old way (value based when values come through) to the new way (direct from the types when a CC is registered)
solidityTypeToSQLType :: Bool -> Maybe (ContractF ()) -> CodeCollectionF () -> SVMType.Type -> Maybe SqlType
solidityTypeToSQLType _ _ _ SVMType.Bool = Just SqlBool
solidityTypeToSQLType _ _ _ SVMType.Int{} = Just SqlDecimal
solidityTypeToSQLType _ _ _ SVMType.String{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Bytes{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.UserDefined{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Decimal = Just SqlDecimal
solidityTypeToSQLType _ _ _ SVMType.Address{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Account{} = Just SqlText
solidityTypeToSQLType isEvent _ _ SVMType.Array{} = if isEvent then Just SqlJsonb else Nothing
solidityTypeToSQLType _ _ _ SVMType.Mapping{} = Nothing -- Just SqlJsonb
solidityTypeToSQLType _ mc cc (SVMType.UnknownLabel l _) = Just . maybe SqlText (const SqlJsonb) $ (\c -> structDef c cc l) =<< mc
--solidityTypeToSQLType _ (SVMType.UnknownLabel x) = Just $ "text references " <> T.pack x <> "(id)"
solidityTypeToSQLType _ _ _ SVMType.Struct{} = Just SqlJsonb
solidityTypeToSQLType _ _ _ SVMType.Enum{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Contract{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Error{} = Just SqlText
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

valueToSQLText' :: Bool -> Value -> Maybe Text
valueToSQLText' _ (SimpleValue (ValueBool x)) = Just $ tshow x
valueToSQLText' _ (SimpleValue (ValueInt _ _ v)) = Just $ tshow v
valueToSQLText' _ (SimpleValue (ValueString s)) = Just s
valueToSQLText' z (SimpleValue (ValueAddress (Address 0))) = if z then Nothing else Just "0000000000000000000000000000000000000000"
valueToSQLText' z (SimpleValue (ValueAddress (Address addr))) =
  if z && fromIntegral addr == (0 :: Integer)
    then Nothing
    else Just . T.pack $ printf "%040x" (fromIntegral addr :: Integer)
valueToSQLText' z (SimpleValue (ValueAccount acct@(NamedAccount (Address addr) _))) =
  if z && fromIntegral addr == (0 :: Integer)
    then Nothing
    else Just . T.pack $ show acct
valueToSQLText' _ (SimpleValue (ValueBytes _ bytes)) = Just $
  case decodeUtf8' bytes of
    Left _ -> decodeUtf8 $ Base16.encode bytes
    Right x -> x
valueToSQLText' _ (ValueEnum _ _ index) = Just . T.pack $ show index
valueToSQLText' z (ValueContract acct@(NamedAccount (Address addr) _)) =
  if z && fromIntegral addr == (0 :: Integer)
    then Nothing
    else Just . T.pack $ show acct
valueToSQLText' _ ValueFunction{} = Nothing
valueToSQLText' _ ValueMapping{} = Nothing
valueToSQLText' _ ValueArrayFixed{} = Nothing
valueToSQLText' _ ValueArrayDynamic{} = Nothing
valueToSQLText' _ struct@ValueStruct{} = solidityValueToText <$> valueToSolidityValue struct

valueToSQLText' _ x = solidityValueToText <$> valueToSolidityValue x

valueToSQLText :: Value -> Maybe Text
valueToSQLText = valueToSQLText' True
