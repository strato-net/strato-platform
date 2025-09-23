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
{-# LANGUAGE TypeFamilies #-}
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
  refreshMaterializedView,
  createFkeyFunctions,
  createIndexTable,
  createCollectionTable,
  createExpandEventTables,
  notifyPostgREST,
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
import           Blockchain.Slipstream.PostgresqlTypedShim
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

data OnConflict = OnConflict
  { conflictCols       :: [Text]
  , conflictUpdateCols :: [Text]
  , extraSQL           :: Maybe Text
  } deriving (Eq, Ord, Show)

type family Zip a b where
  Zip [a] [b] = [(a, b)]

data SlipstreamQuery = CreateTable TableName TableColumns [Text] (Maybe (Text, Text))
                     | CreateContractView TableName TableName [Text] [Text] TableColumns
                     | CreateCollectionView TableName [Text] [Text] TableColumns
                     | CreateEventView TableName [Text] [Text] TableColumns (Maybe [Text])
                     | CreateEventArrayView TableName [Text] [Text] TableColumns
                     | InsertTable TableName TableColumns [[Maybe Value]] (Maybe OnConflict)
                     | InsertTableWithUC TableName TableColumns [[Maybe Value]] (Maybe (Text, [Text]))
                     | AlterTableAddColumns TableName TableColumns
                     | AlterTableAddForeignKey Text ForeignKeyInfo
                     | CreateFkeyFunction TableName TableName Text
                     | UpdateTable TableName (Zip TableColumns [Either Text (Maybe Value)])
                                             (Zip TableColumns [Either Text (Maybe Value)])
                     | RefreshMaterializedView TableName
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
slipstreamQueryText _ (CreateContractView tableName storageTableName storageCols contractCols cols) = T.concat $
  [ "DROP MATERIALIZED VIEW IF EXISTS "
  , tableNameToDoubleQuoteText tableName
  , "; CREATE MATERIALIZED VIEW "
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
  , " FROM "
  , tableNameToDoubleQuoteText storageTableName
  , " s INNER JOIN contract c ON s.address = c.address WHERE c.creator = '"
  , tableNameCreator tableName
  , "' AND c.application = '"
  , tableNameApplication tableName
  , "' AND c.contract_name = '"
  , tableNameContractName tableName
  , "';"
  ]
slipstreamQueryText _ (CreateCollectionView tableName storageCols contractCols keyTypes) = T.concat $
  [ "DROP MATERIALIZED VIEW IF EXISTS "
  , tableNameToDoubleQuoteText tableName
  , "; CREATE MATERIALIZED VIEW "
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
  , ", value FROM mapping s INNER JOIN contract c ON s.address = c.address WHERE c.creator = '"
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
  [ "DROP MATERIALIZED VIEW IF EXISTS "
  , tableNameToDoubleQuoteText tableName
  , "; CREATE MATERIALIZED VIEW "
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
      , if c == "creator" then "arg_" <> c else c
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
slipstreamQueryText _ (CreateEventArrayView tableName eventArrayCols contractCols keyTypes) = T.concat $
  [ "DROP MATERIALIZED VIEW IF EXISTS "
  , tableNameToDoubleQuoteText tableName
  , "; CREATE MATERIALIZED VIEW "
  , tableNameToDoubleQuoteText tableName
  , " AS SELECT "
  , T.intercalate ", " $
      (("s." <>) <$> eventArrayCols)
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
  , ", value FROM event_array s INNER JOIN contract c ON s.address = c.address WHERE c.creator = '"
  , tableNameCreator tableName
  , "' AND c.application = '"
  , tableNameApplication tableName
  , "' AND c.contract_name = '"
  , tableNameContractName tableName
  , "' AND s.collection_name = '"
  , tableNameCollectionName tableName
  , "';"
  ]
slipstreamQueryText _ (InsertTable tableName cols valss mOnConflict) = T.concat $
  [ "INSERT INTO ",
    tableNameToDoubleQuoteText tableName,
    " ",
    wrapAndEscapeDouble $ fst <$> cols,
    "\n  VALUES ",
    csv $ wrapParens . csv . map
      (\((_,t),v) -> fromMaybe "NULL" $ valueToSQLText t =<< v)
      . zip cols
      <$> valss
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
    wrapAndEscapeDouble $ fst <$> cols,
    "\n  VALUES ",
    csv $ wrapParens . csv . map
      (\((_,t),v) -> fromMaybe "NULL" $ valueToSQLText t =<< v)
      . zip cols
      <$> valss,
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
slipstreamQueryText _ (CreateFkeyFunction srcTable dstTable colName) = T.concat
  [ "CREATE OR REPLACE FUNCTION \""
  , colName
  , "_fkey\"(\n  lp "
  , tableNameToDoubleQuoteText srcTable
  , "\n) RETURNS SETOF "
  , tableNameToDoubleQuoteText dstTable
  , "\nROWS 1\nLANGUAGE sql STABLE AS $$\n"
  , "  SELECT v.*\n  FROM "
  , tableNameToDoubleQuoteText dstTable
  , " AS v\n"
  , "  WHERE v.address = COALESCE(\n"
  , "           (lp).\""
  , colName
  , "\"::text,\n"
  , "           (lp).\""
  , colName
  , "\"\n"
  , "         )\n"
  , "  LIMIT 1;\n"
  , "$$;\n\n"
  , "GRANT EXECUTE ON FUNCTION \""
  , colName
  , "_fkey\"(\n  "
  , tableNameToDoubleQuoteText srcTable
  , "\n) TO postgres;\n\n"
  , "GRANT SELECT ON "
  , tableNameToDoubleQuoteText dstTable
  , " TO postgres;"
  ]
slipstreamQueryText _ (UpdateTable tableName updateColsAndVals whereColsAndVals) = T.concat
  [ "UPDATE "
  , tableNameToDoubleQuoteText tableName
  , "\n  SET "
  , case updateColsAndVals of
      [((col,t),v)] -> T.concat
        [ wrapEscapeDouble col
        , " = "
        , either id (fromMaybe "NULL" . (valueToSQLText t =<<)) v
        ]
      _ ->
        let updateCols = fst $ unzip updateColsAndVals
         in T.concat
              [ wrapAndEscapeDouble $ fst <$> updateCols
              , " = "
              , wrapParens . csv $
                (\((_,t),v) -> either id (fromMaybe "NULL" . (valueToSQLText t =<<)) v)
                <$> updateColsAndVals
              ]
  , "\n  WHERE "
  , let whereCols = fst $ unzip whereColsAndVals
     in T.concat
          [ wrapAndEscapeDouble $ fst <$> whereCols
          , " = "
          , wrapParens . csv $
              (\((_,t),v) -> either id (fromMaybe "NULL" . (valueToSQLText t =<<)) v)
              <$> whereColsAndVals
          ]
  , ";"
  ]
slipstreamQueryText _ (RefreshMaterializedView tableName) = T.concat
  [ "REFRESH MATERIALIZED VIEW "
  , tableNameToDoubleQuoteText tableName
  , ";"
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

getTableColumnAndType :: Bool -> CodeCollectionF () -> [(Text, SVMType.Type)] -> [(T.Text, SqlType, Maybe T.Text)]
getTableColumnAndType isEvent cc@(CodeCollection ccs _ _ _ _ _ _ _) = mapMaybe go . fillFirstEmptyEntries
  where
    go :: (Text, SVMType.Type) -> Maybe (T.Text, SqlType, Maybe T.Text)
    go (x, y) =
      (\v -> case y of
        SVMType.UnknownLabel s _ -> (x, v, bool Nothing (Just $ T.pack s) $ Map.member s ccs)
        _ -> (x, v, Nothing)
      ) <$> solidityTypeToSQLType isEvent Nothing cc y

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
      pgDBLogMessage = runLoggingT . $logInfoLS "pglog",
      pgDBParams = []
    }

dbQueryCatchError' :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> (Text, Maybe (TableName, TableColumns)) -> m ()
dbQueryCatchError' conn (insrt, b) = handle (handlePostgresError' b) $ dbQuery conn insrt

dbQueryCatchError :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQueryCatchError conn insrt = handle handlePostgresError $ dbQuery conn insrt

dbQuery :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQuery conn insrt = do
  $logDebugS "outputData" insrt
  liftIO . void . pgQuery conn $! encodeUtf8 insrt

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
  ConduitM () (Text, Maybe (TableName, TableColumns)) m a ->
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
  [ ("address", SqlText)
  , ("block_hash", SqlText)
  , ("block_timestamp", SqlText)
  , ("block_number", SqlText)
  , ("transaction_hash", SqlText)
  , ("transaction_sender", SqlText)
  , ("root", SqlText)
  ]

baseEventColumns :: TableColumns
baseEventColumns =
  [ ("address", SqlText)
  , ("block_hash", SqlText)
  , ("block_timestamp", SqlText)
  , ("block_number", SqlText)
  , ("transaction_hash", SqlText)
  , ("transaction_sender", SqlText)
  , ("event_index", SqlDecimal)
  , ("creator", SqlText)
  , ("application", SqlText)
  , ("contract_name", SqlText)
  ]

baseEventCollectionColumns :: TableColumns
baseEventCollectionColumns =
  baseEventColumns ++
  [ ("collection_name", SqlText)
  , ("collection_type", SqlText)
  ]

baseMappingColumns :: TableColumns
baseMappingColumns =
  [ ("address", SqlText)
  , ("block_hash", SqlText)
  , ("block_timestamp", SqlText)
  , ("block_number", SqlText)
  , ("transaction_hash", SqlText)
  , ("transaction_sender", SqlText)
  , ("root", SqlText)
  , ("collection_name", SqlText)
  , ("collection_type", SqlText)
  ]

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

notifyPostgREST ::
  OutputM m =>
  ConduitM i SlipstreamQuery m ()
notifyPostgREST = yield NotifyPostgREST

createIndexTable ::
  OutputM m=>
  --
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m [(TableName, TableName, Text)]
createIndexTable contract cc (creator, a, n) = do
  let tableName = indexTableName creator a n
      storageTableName = indexTableName "" "" "storage"
      histTableName = historyTableName creator a n
      storageHistoryTableName = historyTableName "" "" "storage"
      cols = getTableColumnAndType False cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
      contractCols = ["creator", "application", "contract_name"]
      cols' = (\(x, v, _) -> (x, v)) <$> cols
      fcols = mapMaybe (\(x, _, mf) -> (\f -> (tableName, indexTableName creator a f, x)) <$> mf) cols
  yieldMany
    [ CreateContractView tableName storageTableName (fst <$> baseColumns) contractCols cols'
    , CreateContractView histTableName storageHistoryTableName (fst <$> baseColumns) contractCols cols'
    ]
  pure fcols

createCollectionTable ::
  OutputM m =>
  (Text, Text, Text) ->
  ContractF () ->
  CodeCollectionF () ->
  (Text, [SVMType.Type], SVMType.Type) ->
  ConduitM () SlipstreamQuery m (Maybe (TableName, TableName, Text))
createCollectionTable (creator, a, n) c cc (collectionName, keyTypes, valueType) = do
  let tableName = collectionTableName creator a n collectionName
      keySqlTypes = fromMaybe SqlText . solidityTypeToSQLType False (Just c) cc <$> keyTypes
      keyNames = keyColumnNames keySqlTypes
      mappingCols = fst <$> baseMappingColumns
  yield $ CreateCollectionView tableName mappingCols [] keyNames
  pure $ case getTableColumnAndType False cc [("value", valueType)] of
    [(x, _, Just f)] -> Just (tableName, indexTableName creator a f, x)
    _ -> Nothing

createEventArrayTable ::
  OutputM m =>
  (Text, Text, Text, Text) ->
  CodeCollectionF () ->
  (Text, SVMType.Type) ->
  ConduitM () SlipstreamQuery m (Maybe (TableName, TableName, Text))
createEventArrayTable (creator, a, n, e) cc (arr, arrType) = do
  let tableName = eventCollectionTableName creator a n e arr
      cols = (fst <$> eventBaseColumnsQuery) ++
        [ "collection_name"
        , "collection_type"
        ]
  $logInfoS "createEventArrayTable/tableExists"  $ T.pack ( "Table Name: " ++ show tableName ++ ", table exists: ")
  $logInfoS "createEventArrayTable/(creator, a, n, e) " (T.pack $ show (creator, a, n, e))
  $logInfoS "createEventArrayTable/(arr, arrType) " (T.pack $ show (arr, arrType))
  yield $ CreateEventArrayView tableName cols ["creator", "application", "contract_name"] [("key", SqlText)]
  pure $ case getTableColumnAndType False cc [("value", arrType)] of
    [(x, _, Just f)] -> Just (tableName, indexTableName creator a f, x)
    _ -> Nothing

insertIndexTable ::
  OutputM m =>
  E.ProcessedContract ->
  ConduitM () SlipstreamQuery m ()
insertIndexTable cs =
  let cs' = (\c@E.ProcessedContract {contractData = contractData} -> (c, Map.toList contractData)) cs
      processContract (contract, list) =
          let storageTableName = indexTableName "" "" "storage"
              storageHistoryTableName = historyTableName "" "" "storage"
              contractTableName = indexTableName "" "" "contract"
              keySt = baseColumns ++ [("creator", SqlText), ("application", SqlText), ("contract_name", SqlText), ("data", SqlJsonb)]
              contractKeySt = (,SqlText) <$> ["address", "creator", "application", "contract_name"]
              baseVals =
                [ ValueAddress . E.address,
                  ValueString . T.pack . keccak256ToHex . E.blockHash,
                  ValueString . tshow . E.blockTimestamp,
                  ValueInt False Nothing . E.blockNumber,
                  ValueString . T.pack . keccak256ToHex . E.transactionHash,
                  ValueAddress . E.transactionSender,
                  ValueString . E.root,
                  ValueString . E.creator,
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
   in yieldMany $ processContract cs'

insertDelegatecall ::
  OutputM m =>
  Delegatecall ->
  ConduitM () SlipstreamQuery m ()
insertDelegatecall (Delegatecall s _ c a n) = do
  let contractTableName = indexTableName "" "" "contract"
      contractKeySt = (,SqlText) <$> ["address", "creator", "application", "contract_name"]
      contractValsForSQL = map (Just . SimpleValue)
        [ ValueAddress s,
          ValueString c,
          ValueString a,
          ValueString n
        ]
   in yield $ InsertTable contractTableName contractKeySt [contractValsForSQL] Nothing

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

refreshMaterializedView ::
  OutputM m =>
  TableName ->
  ConduitM () SlipstreamQuery m ()
refreshMaterializedView = yield . RefreshMaterializedView

processGroupedData :: [ProcessedCollectionRow] -> [SlipstreamQuery]
processGroupedData rows@(row:_) =
  case collection_type row of
    "Event Array" -> insertEventArrayTableQuery rows
    _ -> insertCollectionTableQuery rows
processGroupedData [] = []

createFkeyFunctions ::
  OutputM m =>
  [(TableName, TableName, Text)] ->
  ConduitM () SlipstreamQuery m ()
createFkeyFunctions rows = yieldMany $ (\(a,b,c) -> CreateFkeyFunction a b c) <$> rows

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

keyColumnNames :: [a] -> [(Text, a)]
keyColumnNames = zipWith (\i t -> ("key" <> (if i == 1 then "" else T.pack $ show i), t)) [(1 :: Int)..]

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
      let tblName = indexTableName "" "" "mapping"
          tblText = tableNameToDoubleQuoteText tblName

          onConflictCols = ["address", "collection_name", "key"]

          columns = baseMappingColumns ++ [("key", SqlJsonb), ("value", SqlJsonb)]

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
                keySt = baseEventCollectionColumns ++ [("key", SqlJsonb), ("value", SqlJsonb)]
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
                vals = map (Just . SimpleValue . ($ x)) baseVals ++ [Just k, Just v]
             in [InsertTable tableName keySt [vals] . Just $ OnConflict [] [] Nothing]

-- Creates tables for all event declarations, stores table name in
-- globals{createdEvents}
createExpandEventTables ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text, Text) ->
  ConduitM () SlipstreamQuery m [(TableName, TableName, Text)]
createExpandEventTables c cc nameParts = fmap concat . mapM go . Map.toList $ c ^. events
  where
    go (evName, ev) = createEventTable nameParts evName ev cc

createEventTable ::
  OutputM m =>
  (Text, Text, Text) ->
  SolidString ->
  EventF () ->
  CodeCollectionF () ->
  ConduitM () SlipstreamQuery m [(TableName, TableName, Text)]
createEventTable (creator, a, n) evName ev cc = do
  $logInfoS "createEventTable" . T.pack $ show ev
  let (crtr, app, cname) = constructTableNameParameters creator a n
      eventTable = EventTableName crtr app cname (escapeQuotes $ labelToText evName)
      isEvent = True
      evLogToPair (EventLog n' _ t') = (n', t')
      cols = getTableColumnAndType isEvent cc [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries . map evLogToPair $ ev ^. eventLogs]
      fcols = mapMaybe (\(x, _, mf) -> (\f -> (eventTable, indexTableName creator a f, x)) <$> mf) cols
      arrayNamesAndTypes = [(key, entry) | (key, IndexedType _ (SVMType.Array entry _)) <- map evLogToPair $ ev ^. eventLogs]
      indexedFields = map (wrapDoubleQuotes . escapeQuotes . fst)
                    . filter snd
                    . fillFirstEmptyEntries
                    $ [(key, indexed) | (EventLog key indexed _) <- ev ^. eventLogs]
      uniqueConstraint = "address" : indexedFields
  $logInfoS "keys" (T.pack $ show arrayNamesAndTypes)
  yieldMany $
    (\i ->
      let tableName' = if i then indexedEventTableName eventTable else eventTable
          cols' = (\(x, v, _) -> (x, v)) <$> cols
          mUc = if i then Just uniqueConstraint else Nothing
       in CreateEventView tableName' ("id":(fst <$> eventBaseColumnsQuery)) ["creator", "application", "contract_name"] cols' mUc
    ) <$> [False] -- , (True, tableNameToText tableName)]
  arrayFkeys <- forM arrayNamesAndTypes $
    createEventArrayTable (crtr, app, cname, escapeQuotes $ labelToText evName) cc
  pure $ fcols ++ catMaybes arrayFkeys

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
        [ ("event_name", SqlText)
        , ("attributes", SqlJsonb)
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

valueToSQLText :: SqlType -> Value -> Maybe Text
valueToSQLText t v =
  let v' = wrapEscapeSingle <$> valueToSQLText' True v
      pref = case t of
        SqlJsonb -> "to_jsonb("
        _ -> ""
      suff = case t of
        SqlJsonb -> case v of
          SimpleValue ValueBool{} -> "::boolean)"
          SimpleValue ValueInt{} -> "::numeric)"
          ValueEnum{} -> "::numeric)"
          ValueMapping{} -> "::jsonb)"
          ValueStruct{} -> "::jsonb)"
          _ -> "::text)"
        _ -> ""
   in (\w -> pref <> w <> suff) <$> v'