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
  insertGlobalEventTable,
  pipeInsertGlobalEventTable,
  insertIndexTable,
  insertDelegatecall,
  insertCollectionTable,
  insertCollectionTableQuery,
  createIndexTable,
  createCollectionTable,
  createExpandEventTables,
  createForeignIndexesForJoins,
  notifyPostgREST,
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
import qualified Blockchain.Strato.Model.Event   as Action
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Stream.Action        (Delegatecall(..))
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

data SqlType = SqlBool | SqlDecimal | SqlText | SqlJsonb | SqlSerial deriving (Eq, Ord, Show)

sqlTypePostgres :: SqlType -> Text
sqlTypePostgres SqlBool    = "bool"
sqlTypePostgres SqlDecimal = "decimal"
sqlTypePostgres SqlText    = "text"
sqlTypePostgres SqlJsonb   = "jsonb"
sqlTypePostgres SqlSerial  = "serial"

data OnConflict = OnConflict [Text] [Text] (Maybe Text) deriving (Eq, Ord, Show)

data SlipstreamQuery = CreateTable TableName [(Text, SqlType)] [Text] (Maybe (Text, Text))
                     | CreateContractView TableName [Text] [Text] [(Text, SqlType)]
                     | CreateCollectionView TableName [Text] [Text] [(Text, SqlType)]
                     | CreateEventView TableName [Text] [Text] [(Text, SqlType)] (Maybe [Text])
                     | InsertTable TableName [Text] [[Maybe Value]] (Maybe OnConflict)
                     | InsertTableWithUC TableName [Text] [[Maybe Value]] (Maybe (Text, [Text]))
                     | AlterTableAddColumns TableName [(Text, SqlType)]
                     | AlterTableAddForeignKey Text ForeignKeyInfo
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
    case tableName of
      EventTableName{} -> case sqlTypeText SqlSerial of
        "" -> ""
        serial -> "id " <> serial <> " NOT NULL, "
      _ -> "",
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
slipstreamQueryText _ (CreateContractView tableName storageCols contractCols cols) = T.concat $
  [ "CREATE OR REPLACE VIEW "
  , tableNameToDoubleQuoteText tableName
  , " AS SELECT "
  , T.intercalate ", " $
      (("s." <>) <$> storageCols)
   ++ (("c." <>) <$> contractCols)
   ++ ((\(c, t) -> T.concat
      [ "CASE WHEN s.data ? '"
      , c
      , "' "
      , case t of
          SqlDecimal -> "AND (s.data->>'" <> c <> "') ~ '^\\s*-?\\d+\\s*$' "
          SqlBool -> "AND jsonb_typeof(s.data->'" <> c <> "') = 'boolean' "
          _ -> ""
      , case t of
          SqlJsonb -> "THEN (s.data->'"
          _ -> "THEN (s.data->>'"
      , c
      , "')"
      , case t of
          SqlDecimal -> "::numeric"
          SqlBool -> "::boolean"
          _ -> ""
      , " ELSE "
      , case t of
          SqlBool    -> "false::boolean"
          SqlDecimal -> "0::numeric"
          SqlText    -> "''::text"
          SqlJsonb   -> "to_jsonb(''::text)"
          SqlSerial  -> "0::numeric"
      , " END AS \""
      , c
      , "\""
      ]) <$> cols)
  , " FROM storage s INNER JOIN contract c ON s.address = c.address WHERE c.creator = '"
  , tableNameCreator tableName
  , "' AND c.application = '"
  , tableNameApplication tableName
  , "' AND c.contract_name = '"
  , tableNameContractName tableName
  , "';"
  ]
slipstreamQueryText _ (CreateCollectionView tableName storageCols contractCols keyTypes) = T.concat $
  [ "CREATE OR REPLACE VIEW "
  , tableNameToDoubleQuoteText tableName
  , " AS SELECT "
  , T.intercalate ", " $
      (("s." <>) <$> storageCols)
   ++ (("c." <>) <$> contractCols)
   ++ ((\(c, t) -> T.concat
      [ "CASE WHEN s.key ? '"
      , c
      , "' "
      , case t of
          SqlDecimal -> "AND (s.key->>'" <> c <> "') ~ '^\\s*-?\\d+\\s*$' "
          SqlBool -> "AND jsonb_typeof(s.key->'" <> c <> "') = 'boolean' "
          _ -> ""
      , case t of
          SqlJsonb -> "THEN (s.key->'"
          _ -> "THEN (s.key->>'"
      , c
      , "')"
      , case t of
          SqlDecimal -> "::numeric"
          SqlBool -> "::boolean"
          _ -> ""
      , " ELSE "
      , case t of
          SqlBool    -> "false::boolean"
          SqlDecimal -> "0::numeric"
          SqlText    -> "''::text"
          SqlJsonb   -> "to_jsonb(''::text)"
          SqlSerial  -> "0::numeric"
      , " END AS \""
      , c
      , "\""
      ]) <$> keyTypes)
  , ", value FROM record s INNER JOIN contract c ON s.address = c.address WHERE c.creator = '"
  , tableNameCreator tableName
  , "' AND c.application = '"
  , tableNameApplication tableName
  , "' AND c.contract_name = '"
  , tableNameContractName tableName
  , "' AND s.collection_name = '"
  , tableNameCollectionName tableName
  , "';"
  ]
slipstreamQueryText _ (CreateEventView tableName eventCols contractCols cols _) = T.concat $
  [ "CREATE OR REPLACE VIEW "
  , tableNameToDoubleQuoteText tableName
  , " AS SELECT "
  , T.intercalate ", " $
      (("e." <>) <$> eventCols)
   ++ (("c." <>) <$> contractCols)
   ++ ((\(c, t) -> T.concat
      [ "CASE WHEN e.attributes ? '"
      , c
      , "' "
      , case t of
          SqlDecimal -> "AND (e.attributes->>'" <> c <> "') ~ '^\\s*-?\\d+\\s*$' "
          SqlBool -> "AND jsonb_typeof(e.attributes->'" <> c <> "') = 'boolean' "
          _ -> ""
      , case t of
          SqlJsonb -> "THEN (e.attributes->'"
          _ -> "THEN (e.attributes->>'"
      , c
      , "')"
      , case t of
          SqlDecimal -> "::numeric"
          SqlBool -> "::boolean"
          _ -> ""
      , " ELSE "
      , case t of
          SqlBool    -> "false::boolean"
          SqlDecimal -> "0::numeric"
          SqlText    -> "''::text"
          SqlJsonb   -> "to_jsonb(''::text)"
          SqlSerial  -> "0::numeric"
      , " END AS \""
      , c
      , "\""
      ]) <$> cols)
  , " FROM event e INNER JOIN contract c ON e.address = c.address WHERE c.creator = '"
  , tableNameCreator tableName
  , "' AND c.application = '"
  , tableNameApplication tableName
  , "' AND c.contract_name = '"
  , tableNameContractName tableName
  , "' AND e.event_name = '"
  , tableNameEventName tableName
  , "';"
  ]
slipstreamQueryText _ (InsertTable tableName cols valss mOnConflict) = T.concat $
  [ "INSERT INTO ",
    tableNameToDoubleQuoteText tableName,
    " ",
    wrapAndEscapeDouble cols,
    "\n  VALUES ",
    csv $ wrapParens . csv . map (maybe "NULL" (wrapSingleQuotes . escapeSingleQuotes) . (valueToSQLText =<<)) <$> valss
  ] ++ (case mOnConflict of
    Nothing -> []
    Just (OnConflict conflictCols conflictUpdateCols mExtraSQL) ->
      [ "\n ON CONFLICT ",
        wrapAndEscapeDouble conflictCols,
        " DO UPDATE SET ",
        tableUpsert conflictUpdateCols,
        maybe "" (", " <>) mExtraSQL,
        ";"
      ])
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
    creator :: Text,
    cc_creator :: Maybe Text,
    root :: Text,
    application :: Text,
    contractname :: Text,
    eventInfo :: Maybe (Text, Int),
    collection_name :: Text,
    collection_type ::Text,
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
    "collection_name",
    "collection_type"
  ]

baseMappingColumns :: TableColumns
baseMappingColumns =
  [ "address",
    "block_hash",
    "block_timestamp",
    "block_number",
    "transaction_hash",
    "transaction_sender",
    "root",
    "collection_name",
    "collection_type"
  ]

baseMappingTableColumns :: TableColumns
baseMappingTableColumns = baseMappingColumns

compareCollectionRows :: ProcessedCollectionRow -> ProcessedCollectionRow -> Bool
compareCollectionRows x y = collectionDataKeys x == collectionDataKeys y &&
                   creator x == creator y &&
                   application x == application y &&
                   contractname x == contractname y &&
                   collection_name x == collection_name y

compareCollectionRows' :: ProcessedCollectionRow -> ProcessedCollectionRow -> Bool
compareCollectionRows' x y =
                   creator x == creator y &&
                   application x == application y &&
                   contractname x == contractname y &&
                   collection_name x == collection_name y

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
  yieldMany $ createIndexTableQuery (creator, a, n) list
  getDeferredForeignKeys tableName contract cc creator a

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
  let fkeys1 = getDeferredForeignKeysForEventCollection tableName creator a
      fkeys2 = getDeferredForeignKeysForCollectionType tableName creator a arrType
  return $ fkeys1 ++ fkeys2

insertIndexTable ::
  OutputM m =>
  (E.ProcessedContract, [T.Text]) ->
  ConduitM () SlipstreamQuery m ()
insertIndexTable contract = do
  yieldMany $ insertContractTableQuery contract

insertDelegatecall ::
  OutputM m =>
  Delegatecall ->
  ConduitM () SlipstreamQuery m ()
insertDelegatecall d = do
  yieldMany $ insertDelegatecallQuery d

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
  case collection_type row of
    "Event Array" -> insertEventArrayTableQuery rows
    _ -> insertCollectionTableQuery rows
processGroupedData [] = []

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

createIndexTableQuery :: (Text, Text, Text) -> [(Text, SqlType)] -> [SlipstreamQuery]
createIndexTableQuery (creator, a, n) cols =
  let tableName = indexTableName creator a n
      histTableName = historyTableName creator a n
   in [ CreateContractView tableName (filter (/= "creator") baseColumns) ["creator", "application", "contract_name"] cols
      , CreateContractView histTableName (filter (/= "creator") baseColumns) ["creator", "application", "contract_name"] cols
      ]

keyColumnNames :: [a] -> [(Text, a)]
keyColumnNames = zipWith (\i t -> ("key" <> (if i == 1 then "" else T.pack $ show i), t)) [(1 :: Int)..]

createCollectionTableQuery :: Text -> Text -> Text -> Text -> [SqlType] -> SqlType -> SlipstreamQuery
createCollectionTableQuery creator a n collectionName keyTypes _ =
  let tableName = collectionTableName creator a n collectionName
      keyNames = keyColumnNames keyTypes
      recordCols = filter (\c -> (c /= "creator") && (c /= "contract_name")) baseMappingColumns
   in CreateCollectionView tableName recordCols [] keyNames

createEventArrayTableQuery :: (Text, Text, Text, Text, Text) -> SlipstreamQuery
createEventArrayTableQuery (creator, a, n, e, arr) =
  let tableName = eventCollectionTableName creator a n e arr
      cols = eventBaseColumnsQuery ++
        [ ("contract_name", SqlText),
          ("collection_name", SqlText),
          ("collection_type", SqlText),
          ("key", SqlText),
          ("value", SqlText),
          ("value_fkey", SqlText)
        ]
   in CreateTable tableName cols [] Nothing

jsonbUpdateClause :: Text -> Text -> Text
jsonbUpdateClause tblText colText = T.concat
  [ colText
  , " = CASE WHEN excluded."
  , colText
  , " IS NOT NULL AND "
  , tblText
  , "."
  , colText
  , " IS NOT NULL "
  , "AND pg_typeof(excluded."
  , colText
  , ") = 'jsonb'::regtype AND pg_typeof("
  , tblText
  , "."
  , colText
  , ") = 'jsonb'::regtype AND jsonb_typeof(excluded."
  , colText
  , ") = 'object' AND jsonb_typeof("
  , tblText
  , "."
  , colText
  , ") = 'object' THEN "
  , tblText
  , "."
  , colText
  , " || excluded."
  , colText
  , " WHEN excluded."
  , colText
  , " IS NOT NULL THEN excluded."
  , colText
  , " ELSE "
  , tblText
  , "."
  , colText
  , " END"
  ]

insertContractTableQuery :: (E.ProcessedContract, [T.Text]) -> [SlipstreamQuery] -- does not accomodate extra _fkey 
insertContractTableQuery cs =
    let cs' = (\(c@E.ProcessedContract {contractData = contractData}, _) -> (c, Map.toList contractData)) cs
        processContract (contract, list) =
            let storageTableName = indexTableName "" "" "storage"
                storageHistoryTableName = historyTableName "" "" "storage"
                contractTableName = indexTableName "" "" "contract"
                keySt = baseColumns ++ ["application", "contract_name", "data"]
                contractKeySt = ["address", "creator", "application", "contract_name"]
                baseVals =
                  [ ValueAddress . E.address,
                    ValueString . T.pack . keccak256ToHex . E.blockHash,
                    ValueString . tshow . E.blockTimestamp,
                    ValueInt False Nothing . E.blockNumber,
                    ValueString . T.pack . keccak256ToHex . E.transactionHash,
                    ValueAddress . E.transactionSender,
                    ValueString . E.creator,
                    ValueString . E.root,
                    ValueString . E.application,
                    ValueString . E.contractName
                  ]
                baseRowVals = map (Just . SimpleValue . ($ contract)) baseVals
                dataVals = [Just . ValueMapping . Map.fromList $ (\(k, v) -> (ValueString k, v)) <$> list]
                valsForSQL = baseRowVals ++ dataVals
                contractValsForSQL = map (Just . SimpleValue . ($ contract))
                  [ ValueAddress . E.address,
                    ValueString . E.creator,
                    ValueString . E.application,
                    ValueString . E.contractName
                  ]
                conflictUpdateCols = ["address", "block_hash", "block_timestamp", "block_number", "transaction_hash", "transaction_sender"]
                tblText = tableNameToDoubleQuoteText storageTableName
                dataUpdateSQL = jsonbUpdateClause tblText "data"
            in [ InsertTable storageTableName keySt [valsForSQL] . Just $ OnConflict ["address"] conflictUpdateCols (Just dataUpdateSQL)
               , InsertTable storageHistoryTableName keySt [valsForSQL] Nothing
               , InsertTable contractTableName contractKeySt [contractValsForSQL] Nothing
               ]
    in processContract cs'

insertDelegatecallQuery :: Delegatecall -> [SlipstreamQuery] -- does not accomodate extra _fkey 
insertDelegatecallQuery (Delegatecall s _ c a n) =
  let contractTableName = indexTableName "" "" "contract"
      contractKeySt = ["address", "creator", "application", "contract_name"]
      contractValsForSQL = map (Just . SimpleValue)
        [ ValueAddress s,
          ValueString c,
          ValueString a,
          ValueString n
        ]
   in [InsertTable contractTableName contractKeySt [contractValsForSQL] Nothing]

-- insertIndexTableQuery :: (E.ProcessedContract, [T.Text]) -> SlipstreamQuery -- does not accomodate extra _fkey 
-- insertIndexTableQuery cs =
--     let cs' = (\(c@E.ProcessedContract {contractData = contractData}, fkeys) -> ((c, Map.toList contractData), fkeys)) cs
--         processContract ((contract, list), fkeys) =
--             let tableName =
--                   indexTableName
--                     (fromMaybe (E.creator contract) (E.cc_creator contract))
--                     (E.application contract)
--                     (E.contractName contract)
--                 fkeyColumns = [T.pack ((T.unpack k) ++ "_fkey") | k <- fkeys]
--                 keysForSQL = map fst list ++ fkeyColumns
--                 keySt = baseColumns ++ keysForSQL
--                 baseVals =
--                   [ ValueAddress . E.address,
--                     ValueString . T.pack . keccak256ToHex . E.blockHash,
--                     ValueString . tshow . E.blockTimestamp,
--                     ValueInt False Nothing . E.blockNumber,
--                     ValueString . T.pack . keccak256ToHex . E.transactionHash,
--                     ValueAddress . E.transactionSender,
--                     ValueString . E.creator,
--                     ValueString . E.root
--                   ]
--                 baseRowVals = map (Just . SimpleValue . ($ contract)) baseVals
--                 contractValEntries = list
--                 regularVals = [Just (snd kv) | kv@(k, _) <- contractValEntries, k `elem` keysForSQL]
--                 fkeyVals = [Nothing | k <- fkeyColumns, k `elem` keysForSQL]
--                 valsForSQL = baseRowVals ++ regularVals ++ fkeyVals
--                 conflictUpdateBaseCols = ["address", "block_hash", "block_timestamp", "block_number", "transaction_hash", "transaction_sender"]
--                 conflictUpdateCols = conflictUpdateBaseCols ++ keysForSQL
--             in InsertTable tableName keySt [valsForSQL] . Just $ OnConflict ["address"] conflictUpdateCols Nothing
--     in processContract cs'

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
          keyValuePairs =
            [ ValueMapping
              . Map.fromList
              $ (\(t,k) -> (ValueString t, k))
              <$> keyColumnNames (collectionDataKeys m)
            , val
            ]
       in (m, isObject,) $ Just <$> keyValuePairs

    preparedRows = map prepareRow rows

    groupedRows =
      map snd $
        partitionWith (\(_, isObj, _) -> isObj) preparedRows

    renderInsert [] = []
    renderInsert group@((_, isMerge, _) : _) =
      let tblName = indexTableName "" "" "record"
          tblText = tableNameToDoubleQuoteText tblName

          onConflictCols = ["address", "collection_name", "key"]

          columns = baseMappingTableColumns ++ ["key", "value"]

          baseFields =
            [ ValueAddress . address,
              ValueString . T.pack . keccak256ToHex . blockHash,
              ValueString . tshow . blockTimestamp,
              ValueInt False Nothing . blockNumber,
              ValueString . T.pack . keccak256ToHex . transactionHash,
              ValueAddress . transactionSender,
              ValueString . root,
              ValueString . collection_name,
              ValueString . collection_type
            ]

          valueTuples =
            map
              ( \(row, _, kvs) ->
                  map (Just . SimpleValue . ($ row)) baseFields ++ kvs
              )
              group

          valueUpdateSQL =
            if isMerge
              then jsonbUpdateClause tblText "value"
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
                "collection_name",
                "collection_type"
              ]
       in [InsertTable tblName columns valueTuples . Just $ OnConflict onConflictCols updateSet (Just valueUpdateSQL)]

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
                    (collection_name x)
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
                    ValueString . collection_name,
                    ValueString . collection_type
                  ]
                vals = map (Just . SimpleValue . ($ x)) baseVals ++ [Just k, Just v, Nothing]
             in [InsertTable tableName keySt [vals] . Just $ OnConflict [] [] Nothing]

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
              Just x  -> eventCollectionTableName (creator c) (application c) (contractname c) (fst x) (collection_name c)
              Nothing -> collectionTableName (creator c) (application c) (contractname c) (collection_name c)
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
    go (evName, ev) = createEventTable nameParts evName ev cc

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
      uniqueConstraint = "address" : indexedFields
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


createEventTableQuery :: TableName -> [(Text, SqlType)] -> [Text] -> [SlipstreamQuery]
createEventTableQuery tableName cols uniqueConstraint =
  (\i ->
    let tableName' = if i then indexedEventTableName tableName else tableName
        mUc = if i then Just uniqueConstraint else Nothing
     in CreateEventView tableName' (fst <$> eventBaseColumnsQuery) [] cols mUc
  ) <$> [False] -- , (True, tableNameToText tableName)]

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
      collection_name = arrayName,
      collection_type = "Event Array",
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

pipeInsertGlobalEventTable :: OutputM m => [AggregateEvent] -> ConduitM () SlipstreamQuery m ()
pipeInsertGlobalEventTable aggregatedEvents =
  yieldMany =<< lift (mapM insertGlobalEventTable aggregatedEvents)

insertGlobalEventTable :: OutputM m => AggregateEvent -> m SlipstreamQuery
insertGlobalEventTable agEv = do
  let query = insertGlobalEventTableQuery agEv
  $logInfoS "insertGlobalEventTable/query" . T.pack $ show query
  return query

-- | Generates an INSERT SQL statement for the global 'events' table.
--
-- This function creates a SQL INSERT statement that adds a single event record
-- to the centralized 'events' table. Unlike event-specific tables that are
-- created dynamically per contract/event type, this global table has a fixed
-- schema and stores all events in a normalized format.
--
-- Event arguments are converted to a JSON object and stored in the 'attributes'
-- column, where each argument name becomes a key and its value becomes the
-- corresponding JSON value.
insertGlobalEventTableQuery :: AggregateEvent -> SlipstreamQuery
insertGlobalEventTableQuery agEv@AggregateEvent {eventEvent = ev} =
  let creator = T.pack $ Action.evContractCreator ev
      application = T.pack $ Action.evContractApplication ev
      contractName = T.pack $ Action.evContractName ev
      eventName = T.pack $ Action.evName ev
      address = Action.evContractAddress ev
      blockHash = T.pack . keccak256ToHex $ eventBlockHash agEv
      blockTimestamp = tshow $ eventBlockTimestamp agEv
      blockNumber = eventBlockNumber agEv
      transactionHash = T.pack . keccak256ToHex $ eventTxHash agEv
      transactionSender = eventTxSender agEv
      eventIdx = eventIndex agEv

      attributesMap = ValueMapping $
        Map.fromList [(ValueString $ T.pack name, SimpleValue . ValueString $ T.pack value) | (name, value, _) <- Action.evArgs ev]

      columns =
        baseEventColumns ++
        [ "event_name"
        , "attributes"
        ]

      values = Just <$>
        [ SimpleValue $ ValueAddress address
        , SimpleValue $ ValueString blockHash
        , SimpleValue $ ValueString blockTimestamp
        , SimpleValue $ ValueInt False Nothing blockNumber
        , SimpleValue $ ValueString transactionHash
        , SimpleValue $ ValueAddress transactionSender
        , SimpleValue . ValueInt False Nothing $ fromIntegral eventIdx
        , SimpleValue $ ValueString creator
        , SimpleValue $ ValueString application
        , SimpleValue $ ValueString contractName
        , SimpleValue $ ValueString eventName
        , attributesMap
        ]
  in InsertTable (IndexTableName "" "" "event") columns [values] Nothing

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

------------------

-- This is a temporary function that converts solidity types to a sample
-- value...  I am just using this now to convert table creation from the old way
-- (value based when values come through) to the new way (direct from the types
-- when a CC is registered)
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
solidityTypeToSQLType _ _ _ SVMType.Struct{} = Just SqlJsonb
solidityTypeToSQLType _ _ _ SVMType.Enum{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Contract{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Error{} = Just SqlText
solidityTypeToSQLType _ _ _ SVMType.Variadic = Just SqlJsonb


------------------

solidityValueToText :: SolidityValue -> Text
solidityValueToText (SolidityValueAsString x) = escapeQuotes $ V.unEscapeStringValue x
solidityValueToText (SolidityBool x) = tshow x
solidityValueToText (SolidityNum x) = tshow x
solidityValueToText (SolidityBytes x) = escapeQuotes $ tshow x
solidityValueToText (SolidityArray x) = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ Aeson.encode x
solidityValueToText x@(SolidityObject _) = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ Aeson.encode x

valueToSQLText' :: Bool -> Value -> Maybe Text
valueToSQLText' _ (SimpleValue (ValueBool x)) = Just $ if x then "true" else "false"
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
valueToSQLText' z (ValueMapping m) = Just
  . decodeUtf8
  . BL.toStrict
  . Aeson.encode
  . MapWrapper
  . aesonHelper
  . Map.fromList
  . mapMaybe (\(k,v) -> (,) <$> valueToSQLText' z (SimpleValue k) <*> valueToSQLText' z v)
  $ Map.toList m
valueToSQLText' _ ValueArrayFixed{} = Nothing
valueToSQLText' _ ValueArrayDynamic{} = Nothing
valueToSQLText' _ struct@ValueStruct{} = solidityValueToText <$> valueToSolidityValue struct

valueToSQLText' _ x = solidityValueToText <$> valueToSolidityValue x

valueToSQLText :: Value -> Maybe Text
valueToSQLText = valueToSQLText' True
