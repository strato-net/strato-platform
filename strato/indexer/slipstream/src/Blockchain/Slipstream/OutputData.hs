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

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Slipstream.OutputData (
  SqlType(..),
  TableConstraint(..),
  OnConflict(..),
  SlipstreamQuery(..),
  slipstreamQueryPostgres,
  slipstreamQueryText,
  dedupC,
  ProcessedCollectionRow(..),
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
  aggEventToCollectionRows,
  valueToSQLText',
  initialSlipstreamQueries
  ) where


import           BlockApps.Solidity.Value as V
import qualified BlockApps.SolidVMStorageDecoder as SolidVM
import           Conduit
import           Control.Lens ((^.))
import           Control.Monad
import qualified Data.Aeson                      as Aeson
import           Data.Bool                       (bool)
import qualified Data.Set as Set
import qualified Data.ByteString.Base16         as Base16
import qualified Data.ByteString.Lazy            as BL
import           Data.Map                        (Map)
import qualified Data.Map.Strict                 as Map
import           Data.Maybe                      (catMaybes, fromMaybe, listToMaybe, mapMaybe)
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Bloc.Server.Utils               (partitionWith)
import           BlockApps.Logging
import           Blockchain.Slipstream.Data.Action
import qualified Blockchain.Slipstream.Events               as E
import           Blockchain.Slipstream.QueryFormatHelper
import           Blockchain.Slipstream.SolidityValue
import           Blockchain.Strato.Model.Address
import qualified Blockchain.Strato.Model.Event   as Action
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Stream.Action        (Delegatecall(..))
import           Data.Text.Encoding              (decodeUtf8, decodeUtf8')
import           Data.Time
import           SolidVM.Model.CodeCollection    hiding (Contract, contractName, contracts, parents)
import qualified SolidVM.Model.CodeCollection.VarDef as VarDef
import           SolidVM.Model.SolidString
import           SolidVM.Model.Storable
import qualified SolidVM.Model.Type              as SVMType
import           Text.Printf
import qualified Data.Text.Encoding as TE

newtype First b a = First {unFirst :: (a, b)}

instance Functor (First b) where
  fmap f (First (a, b)) = First (f a, b)

data ForeignKeyInfo = ForeignKeyInfo
  { fkiSourceTableName :: TableName
  , fkiDestTableName   :: TableName
  , fkiColumnName      :: Text
  , fkiColumnType      :: SqlType
  }
  deriving (Eq, Ord, Show)

data TableConstraint = Unique Text Text
                     | Foreign Text [Text] TableName [Text]
                     deriving (Eq, Ord, Show)

data OnConflict = DoNothing
                | OnConflict
  { conflictCols       :: [Text]
  , conflictUpdateCols :: [Text]
  , extraSQL           :: Maybe Text
  } deriving (Eq, Ord, Show)

data SlipstreamQuery = CreateTable
                        { tableName :: TableName
                        , tableColumns :: TableColumns
                        , primaryKeyColumns :: [Text]
                        , tableConstraint :: Maybe TableConstraint
                        , tableIndexes :: [(Text, [Text])]
                        }
                     | CreateView
                        { viewName :: TableName
                        , inheritedContractNames :: [Text]
                        , sourceTableName :: TableName
                        , sourceTableColumns :: [Text]
                        , contractTableColumns :: [Text]
                        , viewColumns :: [(TableColumns, Text)]
                        , jsonbColumns :: [(TableColumns, Text)]
                        , primaryKeyColumns :: [Text]
                        , extraJoinColumns :: [([Either Text Text], Maybe Text, Text)]
                        }
                     | InsertTable
                        { tableName :: TableName
                        , tableColumns :: TableColumns
                        , values :: [[Maybe Value]]
                        , onConflict :: Maybe OnConflict
                        }
                     | InsertDelegatecall Delegatecall
                     | CreateFkeyFunction ForeignKeyInfo
                     | RefreshMaterializedView TableName
                     | NotifyPostgREST
                     | RawSQL Text
                     deriving (Eq, Ord, Show)

slipstreamQueryPostgres :: SlipstreamQuery -> Text
slipstreamQueryPostgres = slipstreamQueryText sqlTypePostgres

slipstreamQueryText :: (SqlType -> Text) -> SlipstreamQuery -> Text
slipstreamQueryText sqlTypeText CreateTable{..} = T.concat $
  [ "CREATE TABLE IF NOT EXISTS "
  , tableNameToDoubleQuoteText tableName
  , " ("
  , csv $ (\(c,t) -> wrapEscapeDouble c <> " " <> sqlTypeText t
                   <> case t of SqlSerial -> " NOT NULL"; _ -> "") <$> tableColumns
  , case primaryKeyColumns of
      [] -> ""
      _ -> ",\n  PRIMARY KEY " <> wrapAndEscapeDouble primaryKeyColumns
  , case tableConstraint of
      Nothing -> ""
      Just (Unique n uc) -> T.concat
        [ ", CONSTRAINT "
        , wrapEscapeDouble n
        , " UNIQUE "
        , uc
        ]
      Just (Foreign n lCols ftName fCols) -> T.concat
        [ ", CONSTRAINT "
        , wrapEscapeDouble n
        , " FOREIGN KEY "
        , wrapAndEscapeDouble lCols
        , " REFERENCES "
        , tableNameToDoubleQuoteText ftName
        , " "
        , wrapAndEscapeDouble fCols
        ]
  , ");\n"
  , T.concat $ (\(indexName, indexCols) -> T.concat
      [ "CREATE INDEX IF NOT EXISTS "
      , wrapEscapeDouble indexName
      , " ON "
      , tableNameToDoubleQuoteText tableName
      , wrapAndEscapeDouble indexCols
      , ";\n"
      ]
    ) <$> tableIndexes
  ] ++ (case tableName of
    HistoryTableName c n@"storage" ->
      let normalTableName = indexTableName c n
          triggerFunctionName = "\"" <> "insert_or_update_" <> tableNameToText normalTableName <> "_history_table" <> "\""
       in [ "\n\n",
            -- Create or replace the function for handling insert and update triggers
            "CREATE OR REPLACE FUNCTION ", triggerFunctionName, "() RETURNS TRIGGER AS $$\n",
            "BEGIN\n",
            "    RAISE NOTICE 'Trigger fired for % on table ", tableNameToText normalTableName, ": %', TG_OP, NEW.address;\n",
            "  UPDATE ",
            tableNameToDoubleQuoteText tableName <> " h\n",
            "  SET valid_to = CAST(NEW.block_timestamp AS timestamp)\n",
            "  WHERE h.address = NEW.address\n",
            "    AND h.valid_to = 'infinity'::timestamp;\n",
            "    IF TG_OP = 'INSERT' THEN\n",
            "        RAISE NOTICE 'Inserting into history table ", tableNameToText tableName, " for address: %', NEW.address;\n",
            "        INSERT INTO ",
            tableNameToDoubleQuoteText tableName,
            "  SELECT NEW.*,\n",
            "         CAST(NEW.block_timestamp AS timestamp),\n",
            "         'infinity'::timestamp;\n",
            "    ELSIF TG_OP = 'UPDATE' THEN\n",
            "        RAISE NOTICE 'Updating history table ", tableNameToText tableName, " for address: %', NEW.address;\n",
            "        INSERT INTO ",
            tableNameToDoubleQuoteText tableName,
            "  SELECT NEW.*,\n",
            "         CAST(NEW.block_timestamp AS timestamp),\n",
            "         'infinity'::timestamp;\n",
            "    END IF;\n",
            "    RETURN NEW;\n",
            "END;\n",
            "$$ LANGUAGE plpgsql;\n\n",
            -- Create trigger for insert operations
            "CREATE OR REPLACE TRIGGER \"after_insert_on_",
            tableNameToText normalTableName, "\"",
            "\nAFTER INSERT ON ",
            tableNameToDoubleQuoteText normalTableName,
            "\nFOR EACH ROW EXECUTE PROCEDURE ", triggerFunctionName, "();\n\n",
            -- Create trigger for update operations
            "CREATE OR REPLACE TRIGGER \"after_update_on_",
            tableNameToText normalTableName, "\"",
            "\nAFTER UPDATE ON ",
            tableNameToDoubleQuoteText normalTableName,
            "\nFOR EACH ROW EXECUTE PROCEDURE ", triggerFunctionName, "();"
          ]
    HistoryTableName c n@"mapping" ->
      let normalTableName = indexTableName c n
          triggerFunctionName = "\"" <> "insert_or_update_" <> tableNameToText normalTableName <> "_history_table" <> "\""
       in [ "\n\n",
            -- Create or replace the function for handling insert and update triggers
            "CREATE OR REPLACE FUNCTION ", triggerFunctionName, "() RETURNS TRIGGER AS $$\n",
            "BEGIN\n",
            "    RAISE NOTICE 'Trigger fired for % on table ", tableNameToText normalTableName, ": %.%', TG_OP, NEW.address, NEW.path;\n",
            "  UPDATE ",
            tableNameToDoubleQuoteText tableName <> " h\n",
            "  SET valid_to = CAST(NEW.block_timestamp AS timestamp)\n",
            "  WHERE h.address = NEW.address\n",
            "    AND h.path = NEW.path\n",
            "    AND h.valid_to = 'infinity'::timestamp;\n",
            "    IF TG_OP = 'INSERT' THEN\n",
            "        RAISE NOTICE 'Inserting into history table ", tableNameToText tableName, " for address: %.%', NEW.address, NEW.path;\n",
            "        INSERT INTO ",
            tableNameToDoubleQuoteText tableName,
            "  SELECT NEW.*,\n",
            "         CAST(NEW.block_timestamp AS timestamp),\n",
            "         'infinity'::timestamp;\n",
            "    ELSIF TG_OP = 'UPDATE' THEN\n",
            "        RAISE NOTICE 'Updating history table ", tableNameToText tableName, " for address: %.%', NEW.address, NEW.path;\n",
            "        INSERT INTO ",
            tableNameToDoubleQuoteText tableName,
            "  SELECT NEW.*,\n",
            "         CAST(NEW.block_timestamp AS timestamp),\n",
            "         'infinity'::timestamp;\n",
            "    END IF;\n",
            "    RETURN NEW;\n",
            "END;\n",
            "$$ LANGUAGE plpgsql;\n\n",
            -- Create trigger for insert operations
            "CREATE OR REPLACE TRIGGER \"after_insert_on_",
            tableNameToText normalTableName, "\"",
            "\nAFTER INSERT ON ",
            tableNameToDoubleQuoteText normalTableName,
            "\nFOR EACH ROW EXECUTE PROCEDURE ", triggerFunctionName, "();\n\n",
            -- Create trigger for update operations
            "CREATE OR REPLACE TRIGGER \"after_update_on_",
            tableNameToText normalTableName, "\"",
            "\nAFTER UPDATE ON ",
            tableNameToDoubleQuoteText normalTableName,
            "\nFOR EACH ROW EXECUTE PROCEDURE ", triggerFunctionName, "();"
          ]
    _ -> [])
slipstreamQueryText _ CreateView{..} =
  let baseColumnSet = Set.fromList $ sourceTableColumns ++ contractTableColumns
   in T.concat $
        [ "DROP VIEW IF EXISTS "
        , tableNameToDoubleQuoteText viewName
        , " CASCADE;\nCREATE VIEW " -- \nBEGIN;\nCREATE VIEW "
        , tableNameToDoubleQuoteText viewName
        , " AS SELECT "
        , T.intercalate ", " $
            (("s." <>) <$> sourceTableColumns)
         ++ (("c." <>) <$> contractTableColumns)
         ++ concatMap (\(cols', dataColumn) -> (\(c, t) -> T.concat
            [ "CASE WHEN jsonb_exists(s."
            , wrapEscapeDouble dataColumn
            , ", '"
            , c
            , "') "
            , case t of
                SqlDecimal -> T.concat
                  [ "AND (s."
                  , wrapEscapeDouble dataColumn
                  , "->>'"
                  , c
                  , "') ~ '^\\s*-{0,1}\\d+(\\.\\d*){0,1}\\s*$' "
                  ]
                SqlBool -> T.concat
                  [ "AND jsonb_typeof(s."
                  , wrapEscapeDouble dataColumn
                  , "->'"
                  , c
                  , "') = 'string' "
                  ]
                _ -> ""
            , case t of
                SqlJsonbArray -> T.concat
                  [ "THEN jsonb_obj_to_array(s."
                  , wrapEscapeDouble dataColumn
                  , "->'"
                  , c
                  , "')"
                  , " ELSE '[]'::jsonb"
                  ]
                SqlJsonb -> T.concat
                  [ "THEN (s."
                  , wrapEscapeDouble dataColumn
                  , "->'"
                  , c
                  , "')"
                  , " ELSE to_jsonb(''::text)"
                  ]
                _ -> T.concat
                  [ "THEN (s."
                  , wrapEscapeDouble dataColumn
                  , "->>'"
                  , c
                  , "')"
                  , case t of
                      SqlDecimal -> "::numeric"
                      SqlBool -> " = 'true'"
                      _ -> ""
                  , " ELSE "
                  , case t of
                      SqlBool      -> "false::boolean"
                      SqlDecimal   -> "0::numeric"
                      SqlText      -> "''::text"
                      SqlTimestamp -> "'infinity'::timestamp)"
                      SqlSerial    -> "0::numeric"
                  ]
            , " END AS "
            , wrapEscapeDouble $ if c `Set.member` baseColumnSet then "arg_" <> c else c
            ]) <$> cols') viewColumns
         ++ ((\(cols', dataColumn) ->
            (<> T.concat [") AS ", wrapEscapeDouble dataColumn])
            . ("jsonb_build_object(" <>)
            . T.intercalate ", " $ concatMap (\(c, t) ->
            [ wrapEscapeSingle $ if c `Set.member` baseColumnSet then "arg_" <> c else c
            , case t of
                SqlJsonbArray -> T.concat
                  [ "CASE WHEN jsonb_exists(s."
                  , wrapEscapeDouble dataColumn
                  , ", '"
                  , c
                  , "') THEN jsonb_obj_to_array(s."
                  , wrapEscapeDouble dataColumn
                  , "->'"
                  , c
                  , "')"
                  , " ELSE '[]'::jsonb END"
                  ]
                _ -> T.concat
                  [ "to_jsonb(CASE WHEN jsonb_exists(s."
                  , wrapEscapeDouble dataColumn
                  , ", '"
                  , c
                  , "') "
                  , case t of
                      SqlJsonb -> T.concat
                        [ "THEN (s."
                        , wrapEscapeDouble dataColumn
                        , "->'"
                        , c
                        , "')"
                        ]
                      _ -> T.concat
                        [ "THEN (s."
                        , wrapEscapeDouble dataColumn
                        , "->>'"
                        , c
                        , "')"
                        ]
                  , case t of
                      SqlBool -> "::text = 'true'"
                      _ -> ""
                  , " ELSE "
                  , case t of
                      SqlBool      -> "false::boolean"
                      SqlDecimal   -> "'0'::text"
                      SqlText      -> "''::text"
                      SqlJsonb     -> "to_jsonb(''::text)"
                      SqlTimestamp -> "'infinity'::timestamp)"
                      SqlSerial    -> "0::numeric"
                  , " END)"
                  ]
            ]) cols') <$> jsonbColumns)
        , " FROM "
        , tableNameToDoubleQuoteText sourceTableName
        , " s INNER JOIN "
        , tableNameToText contractTableName
        , " c ON s.address = c.address WHERE c.creator = '"
        , tableNameCreator viewName
        , "' AND (c.contract_name = '"
        , tableNameContractName viewName
        , T.concat $ ("' OR c.contract_name = '" <>) <$> inheritedContractNames
        , "')"
        , T.concat $ (\(cols, mOp, val) -> T.concat
            [ " AND "
            , T.concat $ (\case
                Right col -> "s." <> wrapEscapeDouble col
                Left raw -> raw
              ) <$> cols
            , " "
            , fromMaybe "=" mOp
            , " "
            , val
            ]
          ) <$> extraJoinColumns
        , ";\n"
        -- , " WITH NO DATA;\n"
        -- , "CREATE UNIQUE INDEX \""
        -- , T.pack
        --     . take 32 . BC.unpack
        --     . Base16.encode . keccak256ToByteString
        --     . hash . encodeUtf8
        --     $ tableNameToText viewName
        -- , "_index\"\n  ON "
        -- , tableNameToDoubleQuoteText viewName
        -- , wrapAndEscapeDouble primaryKeyColumns
        -- , ";\n"
        -- , "COMMIT;\n"
        -- , "REFRESH MATERIALIZED VIEW "
        -- , tableNameToDoubleQuoteText viewName
        -- , ";"
        ]
slipstreamQueryText _ InsertTable{..} = T.concat $
  [ "INSERT INTO ",
    tableNameToDoubleQuoteText tableName,
    " ",
    wrapAndEscapeDouble $ fst <$> tableColumns,
    "\n  VALUES ",
    csv $ wrapParens . csv . map
      (\((_,t),v) -> fromMaybe "NULL" $ valueToSQLText t =<< v)
      . zip tableColumns
      <$> values
  ] ++ (case onConflict of
    Nothing -> []
    Just DoNothing -> ["\n ON CONFLICT DO NOTHING;"]
    Just (OnConflict conflictCols conflictUpdateCols mExtraSQL) ->
      [ "\n ON CONFLICT ",
        wrapAndEscapeDouble conflictCols,
        " DO UPDATE SET ",
        tableUpsert conflictUpdateCols,
        maybe "" (", " <>) mExtraSQL,
        ";"
      ])
slipstreamQueryText _ InsertDelegatecall{} = ""
slipstreamQueryText _ (CreateFkeyFunction ForeignKeyInfo{..}) = T.concat
  [ "CREATE OR REPLACE FUNCTION \""
  , fkiColumnName
  , "_fkey\"(\n  lp "
  , tableNameToDoubleQuoteText fkiSourceTableName
  , "\n) RETURNS SETOF "
  , tableNameToDoubleQuoteText fkiDestTableName
  , "\nROWS 1\nLANGUAGE sql STABLE AS $$\n"
  , "  SELECT v.*\n  FROM "
  , tableNameToDoubleQuoteText fkiDestTableName
  , " AS v\n"
  , case fkiColumnType of
      SqlJsonb -> T.concat
        [ "  WHERE v.address = COALESCE(\n"
        , "    (lp).\""
        , fkiColumnName
        , "\"->>'address',\n"
        , "    CASE WHEN jsonb_typeof((lp).\""
        , fkiColumnName
        , "\") = 'string'\n"
        , "         THEN btrim((lp).\""
        , fkiColumnName
        , "\"::text, '\"')\n"
        , "    END\n"
        , "  )\n"
        ]
      _ -> T.concat
        [ "  WHERE v.address = COALESCE(\n"
        , "    (lp).\""
        , fkiColumnName
        , "\"::text,\n"
        , "    (lp).\""
        , fkiColumnName
        , "\"\n"
        , "  )\n"
        ]
  , "  LIMIT 1;\n"
  , "$$;\n\n"
  , "GRANT EXECUTE ON FUNCTION \""
  , fkiColumnName
  , "_fkey\"(\n  "
  , tableNameToDoubleQuoteText fkiSourceTableName
  , "\n) TO postgres;\n\n"
  , "GRANT SELECT ON "
  , tableNameToDoubleQuoteText fkiDestTableName
  , " TO postgres;"
  ]
slipstreamQueryText _ (RefreshMaterializedView _tableName) = T.concat []
  -- [ "REFRESH MATERIALIZED VIEW CONCURRENTLY "
  -- , tableNameToDoubleQuoteText tableName
  -- , ";"
  -- ]
slipstreamQueryText _ NotifyPostgREST = "NOTIFY pgrst, 'reload schema';"
slipstreamQueryText _ (RawSQL t) = t

data ProcessedCollectionRow = ProcessedCollectionRow
  { address :: Address,
    eventInfo :: Maybe (Text, Int),
    collection_name :: Text,
    collection_type ::Text,
    blockHash :: Keccak256,
    blockTimestamp :: UTCTime,
    blockNumber :: Integer,
    collectionDataKeys :: [V.Value],
    collectionDataValue :: V.Value
  }
  deriving (Show)

type OutputM m = (MonadLogger m, MonadIO m)

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
        SVMType.UnknownLabel s -> (x, v, bool Nothing (Just $ T.pack s) $ Map.member s ccs)
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

dedupC :: (MonadLogger m, Ord a) => ConduitM a a m ()
dedupC = go Set.empty
  where go seen = await >>= \case
          Just a | not (a `Set.member` seen) -> do
                     yield a
                     go (Set.insert a seen)
          Just _ -> go seen
          Nothing -> pure ()

baseColumns :: TableColumns
baseColumns =
  [ ("address", SqlText)
  , ("block_hash", SqlText)
  , ("block_timestamp", SqlText)
  , ("block_number", SqlText)
  ]

baseEventColumns :: TableColumns
baseEventColumns =
  [ ("address", SqlText)
  , ("block_hash", SqlText)
  , ("block_timestamp", SqlText)
  , ("block_number", SqlText)
  , ("transaction_sender", SqlText)
  , ("event_index", SqlDecimal)
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
  , ("collection_name", SqlText)
  , ("collection_type", SqlText)
  ]

notifyPostgREST ::
  OutputM m =>
  ConduitM i SlipstreamQuery m ()
notifyPostgREST = yield NotifyPostgREST

createIndexTable ::
  OutputM m=>
  --
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text) ->
  [Text] ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createIndexTable contract cc (creator, n) inherited = do
  let tableName = indexTableName creator n
      -- histTableName = historyTableName creator a n
      cols = getTableColumnAndType False cc $ map (\(x, y) -> (labelToText x, y ^. varType)) $ Map.toList $ contract ^. storageDefs
      contractCols = ["creator", "contract_name"]
      cols' = [(x, t) | (x, t, _) <- cols, t /= SqlJsonbArray]
      fkeys = mapMaybe (\(x, t, mf) -> (\f -> ForeignKeyInfo tableName (indexTableName creator f) x t) <$> mf) cols
  yield $ CreateView
    tableName
    inherited
    storageTableName
    (fst <$> baseColumns)
    contractCols
    [(cols', "data")]
    []
    ["address"]
    []
  pure fkeys

createCollectionTable ::
  OutputM m =>
  (Text, Text) ->
  ContractF () ->
  CodeCollectionF () ->
  [Text] ->
  (Text, [SVMType.Type], SVMType.Type) ->
  ConduitM () SlipstreamQuery m (Maybe ForeignKeyInfo)
createCollectionTable (creator, n) c cc inherited (collectionName, keyTypes, valueType) = do
  let tableName = collectionTableName creator n collectionName
      keySqlTypes = fromMaybe SqlText . solidityTypeToSQLType False (Just c) cc <$> keyTypes
      keyNames = keyColumnNames keySqlTypes
      mStructName = case valueType of
        SVMType.UnknownLabel structName -> Just structName
        SVMType.Struct _ structName -> Just structName
        _ -> Nothing
      mStructVal = map (\(fieldName, fieldType, _) ->
        ( labelToText fieldName
        , maybe SqlText id $ solidityTypeToSQLType
            False
            (Just c)
            cc
            (VarDef.fieldTypeType fieldType)
        )) <$> (structDef c cc =<< mStructName)
      mappingCols = (fst <$> baseMappingColumns)
        ++ maybe ["value"] (const []) mStructVal
  yield $ CreateView
    tableName
    inherited
    mappingTableName
    mappingCols
    []
    [(keyNames, "key")]
    (maybe [] (\s -> [(s, "value")]) mStructVal)
    (["address", "collection_name"] ++ (fst <$> keyNames))
    [ ([Right "collection_name"], Nothing, wrapEscapeSingle $ tableNameCollectionName tableName)
    , ([Right "value"], Just "IS", "NOT NULL")
    , ([Right "value", Left "::text"], Just "NOT IN", "('\"\"', '0', 'false')")
    , ([Left "jsonb_typeof(", Right "value", Left ")"], Just "IS", "NOT NULL")
    ]
  pure $ case getTableColumnAndType False cc [("value", valueType)] of
    [(x, _, Just f)] -> Just $ ForeignKeyInfo tableName (indexTableName creator f) x SqlJsonb
    _ -> Nothing

createEventArrayTable ::
  OutputM m =>
  (Text, Text, Text) ->
  CodeCollectionF () ->
  [Text] ->
  (Text, SVMType.Type) ->
  ConduitM () SlipstreamQuery m (Maybe ForeignKeyInfo)
createEventArrayTable (creator, n, e) cc inherited (arr, arrType) = do
  let keyTypes (SVMType.Array t _) = SqlDecimal : keyTypes t
      keyTypes _                   = []
      tableName = eventCollectionTableName creator n e arr
      cols = (fst <$> eventBaseColumnsQuery) ++
        [ "collection_name"
        , "collection_type"
        , "value"
        ]
      keyNames = keyColumnNames $ keyTypes arrType
  $logInfoS "createEventArrayTable/tableExists"  $ T.pack ( "Table Name: " ++ show tableName ++ ", table exists: ")
  $logInfoS "createEventArrayTable/(creator, n, e) " (T.pack $ show (creator, n, e))
  $logInfoS "createEventArrayTable/(arr, arrType) " (T.pack $ show (arr, arrType))
  yield $ CreateView
    tableName
    inherited
    eventArrayTableName
    cols
    ["creator", "contract_name"]
    [(keyNames, "key")]
    []
    (["address", "block_hash", "event_index", "collection_name"] ++ (fst <$> keyNames))
    [ ([Right "event_name"], Nothing, wrapEscapeSingle $ tableNameEventName tableName)
    , ([Right "collection_name"], Nothing, wrapEscapeSingle $ tableNameCollectionName tableName)
    ]
  pure $ case getTableColumnAndType False cc [("value", arrType)] of
    [(x, _, Just f)] -> Just $ ForeignKeyInfo tableName (indexTableName creator f) x SqlJsonb
    _ -> Nothing

insertIndexTable ::
  OutputM m =>
  E.ProcessedContract ->
  ConduitM () SlipstreamQuery m ()
insertIndexTable cs =
  let cs' = (\c@E.ProcessedContract {contractData = contractData} -> (c, contractData)) cs
      processContract :: (E.ProcessedContract, Map StoragePath BasicValue) -> [SlipstreamQuery]
      processContract (contract, list) =
          let keySt = baseColumns ++ [("data", SqlJsonb)]
              baseVals =
                [ ValueAddress . E.address,
                  ValueString . T.pack . keccak256ToHex . E.blockHash,
                  ValueString . tshow . E.blockTimestamp,
                  ValueInt False Nothing . E.blockNumber
                ]
              baseRowVals = map (Just . SimpleValue . ($ contract)) baseVals
              dataVals = either (const []) ((:[]) . Just . ValueMapping . Map.mapKeys ValueString . Map.fromList) $ SolidVM.decodeCacheValues list
              valsForSQL = baseRowVals ++ dataVals
              conflictUpdateCols = ["address", "block_hash", "block_timestamp", "block_number"]
              tblText = tableNameToDoubleQuoteText storageTableName
              dataUpdateSQL = jsonbUpdateClause tblText "data"
          in [ InsertTable storageTableName keySt [valsForSQL] . Just $ OnConflict ["address"] conflictUpdateCols (Just dataUpdateSQL)
             ]
   in yieldMany $ processContract cs'

insertDelegatecall ::
  OutputM m =>
  Delegatecall ->
  ConduitM () SlipstreamQuery m ()
insertDelegatecall = yield . InsertDelegatecall

insertCollectionTable ::
  OutputM m =>
  [ProcessedCollectionRow] ->
  ConduitM () SlipstreamQuery m ()
insertCollectionTable [] = error "insertCollectionTable: unhandled empty list"
insertCollectionTable maps = do
  let results = processGroupedData maps
  yieldMany results

refreshMaterializedView ::
  -- OutputM m =>
  TableName ->
  ConduitM () SlipstreamQuery m ()
refreshMaterializedView tn = case tableNameContractName tn of
  "" -> pure ()
  _ -> pure () -- yield $ RefreshMaterializedView tn

processGroupedData :: [ProcessedCollectionRow] -> [SlipstreamQuery]
processGroupedData rows@(row:_) =
  case collection_type row of
    "Event Array" -> insertEventArrayTableQuery rows
    _ -> insertCollectionTableQuery rows
processGroupedData [] = []

createFkeyFunctions ::
  OutputM m =>
  [ForeignKeyInfo] ->
  ConduitM () SlipstreamQuery m ()
createFkeyFunctions rows = yieldMany $ CreateFkeyFunction <$> rows

eventBaseColumnsQuery :: [(Text, SqlType)]
eventBaseColumnsQuery =
  [
    ("address", SqlText),
    ("block_hash", SqlText),
    ("block_timestamp", SqlText),
    ("block_number", SqlText),
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
  , ") = 'object' THEN jsonb_merge_deep("
  , tblText
  , "."
  , colText
  , ", excluded."
  , colText
  , ")"
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
            , SimpleValue . ValueString $ T.concat
                [ collection_name m
                , "["
                , T.intercalate "][" $ fromMaybe "NULL" . valueToSQLText' False <$> collectionDataKeys m
                , "]"
                ]
            , val
            ]
       in (m, isObject,) $ Just <$> keyValuePairs

    preparedRows = map prepareRow rows

    groupedRows =
      map snd $
        partitionWith (\(_, isObj, _) -> isObj) preparedRows

    renderInsert [] = []
    renderInsert group@((_, isMerge, _) : _) =
      let tblName = mappingTableName
          tblText = tableNameToDoubleQuoteText tblName

          onConflictCols = ["address", "path"]

          columns = baseMappingColumns ++ [("key", SqlJsonb), ("path", SqlText), ("value", SqlJsonb)]

          baseFields =
            [ ValueAddress . address,
              ValueString . T.pack . keccak256ToHex . blockHash,
              ValueString . tshow . blockTimestamp,
              ValueInt False Nothing . blockNumber,
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
            let tableName = eventArrayTableName
                keySt = baseEventCollectionColumns ++ [("key", SqlJsonb), ("value", SqlJsonb)]
                baseVals =
                  [ ValueAddress . address,
                    ValueString . T.pack . keccak256ToHex . blockHash,
                    ValueString . tshow . blockTimestamp,
                    ValueInt False Nothing . blockNumber,
                    const $ ValueString "",
                    ValueInt False Nothing . fromIntegral . maybe 0 snd . eventInfo,
                    ValueString . collection_name,
                    ValueString . collection_type
                  ]
                vals = map (Just . SimpleValue . ($ x)) baseVals ++ [Just k, Just v]
             in [InsertTable tableName keySt [vals] $ Just DoNothing]

-- Creates tables for all event declarations, stores table name in
-- globals{createdEvents}
createExpandEventTables ::
  OutputM m =>
  ContractF () ->
  CodeCollectionF () ->
  (Text, Text) ->
  [Text] ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createExpandEventTables c cc nameParts inherited = fmap concat . mapM go . Map.toList $ c ^. events
  where
    go (evName, ev) = createEventTable nameParts evName ev cc inherited

createEventTable ::
  OutputM m =>
  (Text, Text) ->
  SolidString ->
  EventF () ->
  CodeCollectionF () ->
  [Text] ->
  ConduitM () SlipstreamQuery m [ForeignKeyInfo]
createEventTable (creator, n) evName ev cc inherited = do
  $logInfoS "createEventTable" . T.pack $ show ev
  let (crtr, cname) = constructTableNameParameters creator n
      eventTable = EventTableName crtr cname (escapeQuotes $ labelToText evName)
      isEvent = True
      evLogToPair (EventLog n' _ t') = (n', t')
      cols = getTableColumnAndType isEvent cc [(x, indexedTypeType y) | (x, y) <- fillFirstEmptyEntries . map evLogToPair $ ev ^. eventLogs]
      fcols = mapMaybe (\(x, t, mf) -> (\f -> ForeignKeyInfo eventTable (indexTableName creator f) x t) <$> mf) cols
      arrayNamesAndTypes = [(key, entry) | (key, IndexedType _ (SVMType.Array entry _)) <- map evLogToPair $ ev ^. eventLogs]
  $logInfoS "keys" (T.pack $ show arrayNamesAndTypes)
  yieldMany $
    (\i ->
      let tableName' = if i then indexedEventTableName eventTable else eventTable
          cols' = (\(x, v, _) -> (x, v)) <$> cols
       in CreateView
            tableName'
            inherited
            globalEventTableName
            ("id":(fst <$> eventBaseColumnsQuery))
            ["creator", "contract_name"]
            [(cols', "attributes")]
            []
            ["address", "block_hash", "event_index"]
            [([Right "event_name"], Nothing, wrapEscapeSingle $ tableNameEventName tableName')]
    ) <$> [False] -- , (True, tableNameToText tableName)]
  arrayFkeys <- forM arrayNamesAndTypes $
    createEventArrayTable (crtr, cname, escapeQuotes $ labelToText evName) cc inherited
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
      eventInfo = Just (T.pack $ Action.evName ev, eventIndex ae),
      collection_name = arrayName,
      collection_type = "Event Array",
      blockHash = eventBlockHash ae,
      blockTimestamp = eventBlockTimestamp ae,
      blockNumber = eventBlockNumber ae,
      collectionDataKeys = [index],
      collectionDataValue = value
    }

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
pipeInsertGlobalEventTable aggregatedEvents = do
  queries <- lift (mapM insertGlobalEventTable aggregatedEvents)
  yieldMany queries

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
  let eventName = T.pack $ Action.evName ev
      address = Action.evContractAddress ev
      blockHash = T.pack . keccak256ToHex $ eventBlockHash agEv
      blockTimestamp = tshow $ eventBlockTimestamp agEv
      blockNumber = eventBlockNumber agEv
      transactionSender = Action.evTxSender ev
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
        , SimpleValue $ ValueAddress transactionSender
        , SimpleValue . ValueInt False Nothing $ fromIntegral eventIdx
        , SimpleValue $ ValueString eventName
        , attributesMap
        ]
  in InsertTable globalEventTableName columns [values] Nothing

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
solidityTypeToSQLType isEvent _ _ SVMType.Array{} = Just $ if isEvent then SqlJsonb else SqlJsonbArray
solidityTypeToSQLType _ _ _ SVMType.Mapping{} = Nothing -- Just SqlJsonb
solidityTypeToSQLType _ mc cc (SVMType.UnknownLabel l) = Just . maybe SqlText (const SqlJsonb) $ (\c -> structDef c cc l) =<< mc
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
valueToSQLText' _ (SimpleValue (ValueAddress (Address 0))) = Just ""
valueToSQLText' _ (SimpleValue (ValueAddress (Address addr))) =
  Just . T.pack $ printf "%040x" (fromIntegral addr :: Integer)
valueToSQLText' _ (SimpleValue (ValueBytes _ bytes)) = Just $
  case decodeUtf8' bytes of
    Left _ -> decodeUtf8 $ Base16.encode bytes
    Right x -> x
valueToSQLText' _ (ValueEnum _ _ index) = Just . T.pack $ show index
valueToSQLText' _ (ValueContract addr) =
  if addr == 0
    then Just ""
    else Just . T.pack $ show addr
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
        SqlJsonb      -> "to_jsonb("
        SqlJsonbArray -> "to_jsonb("
        _ -> ""
      suff = case t of
        SqlJsonbArray -> "::jsonb)"
        SqlJsonb -> case v of
          SimpleValue ValueBool{} -> "::boolean)"
          SimpleValue ValueInt{} -> "::numeric)"
          ValueEnum{} -> "::numeric)"
          ValueMapping{} -> "::jsonb)"
          ValueStruct{} -> "::jsonb)"
          _ -> "::text)"
        _ -> ""
   in (\w -> pref <> w <> suff) <$> v'

storageTableName :: TableName
storageTableName = indexTableName "" "storage"

storageHistoryTableName :: TableName
storageHistoryTableName = historyTableName "" "storage"

globalEventTableName :: TableName
globalEventTableName = indexTableName "" "event"

contractTableName :: TableName
contractTableName = indexTableName "" "contract"

mappingTableName :: TableName
mappingTableName = indexTableName "" "mapping"

mappingHistoryTableName :: TableName
mappingHistoryTableName = historyTableName "" "mapping"

eventArrayTableName :: TableName
eventArrayTableName = indexTableName "" "event_array"

initialSlipstreamQueries :: [SlipstreamQuery]
initialSlipstreamQueries =
  [ {-CreateTable
      storageTableName
      [ ("address", SqlText)
      , ("block_hash", SqlText)
      , ("block_timestamp", SqlText)
      , ("block_number", SqlText)
      , ("data", SqlJsonb)
      ]
      ["address"]
      Nothing
  , -}
    CreateTable
      storageHistoryTableName
      [ ("address", SqlText)
      , ("block_hash", SqlText)
      , ("block_timestamp", SqlText)
      , ("block_number", SqlText)
      , ("data", SqlJsonb)
      , ("valid_from", SqlTimestamp)
      , ("valid_to", SqlTimestamp)
      ]
      []
      Nothing
      [("storage_history_idx", ["address","valid_to"])]
{-  , CreateTable
      contractTableName
      [ ("address", SqlText)
      , ("creator", SqlText)
      , ("contract_name", SqlText)
      ]
      ["address", "creator", "contract_name"]
      (Just $ Foreign "contract_storage" ["address"] storageTableName ["address"])-}
  , CreateTable
      mappingTableName
      [ ("address", SqlText)
      , ("block_hash", SqlText)
      , ("block_timestamp", SqlText)
      , ("block_number", SqlText)
      , ("collection_name", SqlText)
      , ("collection_type", SqlText)
      , ("key", SqlJsonb)
      , ("path", SqlText)
      , ("value", SqlJsonb)
      ]
      ["address", "path"]
      (Just $ Foreign "contract_mapping" ["address"] storageTableName ["address"])
      [("mapping_idx", ["address","path"])]
  , CreateTable
      mappingHistoryTableName
      [ ("address", SqlText)
      , ("block_hash", SqlText)
      , ("block_timestamp", SqlText)
      , ("block_number", SqlText)
      , ("collection_name", SqlText)
      , ("collection_type", SqlText)
      , ("key", SqlJsonb)
      , ("path", SqlText)
      , ("value", SqlJsonb)
      , ("valid_from", SqlTimestamp)
      , ("valid_to", SqlTimestamp)
      ]
      []
      Nothing
      [("mapping_history_idx", ["address","path","valid_to"])]
  , CreateTable
      globalEventTableName
      [ ("id", SqlSerial)
      , ("address", SqlText)
      , ("block_hash", SqlText)
      , ("block_timestamp", SqlText)
      , ("block_number", SqlText)
      , ("transaction_sender", SqlText)
      , ("event_index", SqlDecimal)
      , ("event_name", SqlText)
      , ("attributes", SqlJsonb)
      ]
      ["address", "block_hash", "event_index"]
      (Just $ Foreign "contract_event" ["address"] storageTableName ["address"])
      []
  , CreateTable
      eventArrayTableName
      [ ("address", SqlText)
      , ("block_hash", SqlText)
      , ("block_timestamp", SqlText)
      , ("block_number", SqlText)
      , ("transaction_sender", SqlText)
      , ("event_name", SqlText)
      , ("event_index", SqlDecimal)
      , ("collection_name", SqlText)
      , ("collection_type", SqlText)
      , ("key", SqlJsonb)
      , ("value", SqlJsonb)
      ]
      ["address", "block_hash", "event_index", "collection_name", "key"]
      (Just $ Foreign "event_event_array" ["address", "block_hash", "event_index"] globalEventTableName ["address", "block_hash", "event_index"])
      []
  , RawSQL jsonbMergeDeepSQL
  , RawSQL jsonbObjToArraySQL
  ]

jsonbMergeDeepSQL :: Text
jsonbMergeDeepSQL = T.unlines
  [ "CREATE OR REPLACE FUNCTION jsonb_merge_deep(a jsonb, b jsonb) RETURNS jsonb AS $fn$"
  , "DECLARE result jsonb; key text; arr_obj jsonb; i int; len int;"
  , "BEGIN"
  , "  IF jsonb_typeof(a) = 'array' AND jsonb_typeof(b) = 'object' THEN"
  , "    arr_obj := '{}'::jsonb;"
  , "    FOR i IN 0..jsonb_array_length(a)-1 LOOP"
  , "      arr_obj := jsonb_set(arr_obj, ARRAY[i::text], a->i);"
  , "    END LOOP;"
  , "    RETURN jsonb_merge_deep(arr_obj, b);"
  , "  END IF;"
  , "  IF jsonb_typeof(a) = 'object' AND jsonb_typeof(b) = 'object' THEN"
  , "    result := a;"
  , "    FOR key IN SELECT jsonb_object_keys(b) LOOP"
  , "      IF result ?? key THEN"
  , "        result := jsonb_set(result, ARRAY[key], jsonb_merge_deep(result->key, b->key));"
  , "      ELSE"
  , "        result := jsonb_set(result, ARRAY[key], b->key);"
  , "      END IF;"
  , "    END LOOP;"
  , "    IF result ?? '_length' THEN"
  , "      len := (result->>'_length')::int;"
  , "      FOR key IN SELECT jsonb_object_keys(result) LOOP"
  , "        IF key ~ '^[0-9]+$' AND key::int >= len THEN"
  , "          result := result - key;"
  , "        END IF;"
  , "      END LOOP;"
  , "    END IF;"
  , "    RETURN result;"
  , "  END IF;"
  , "  RETURN b;"
  , "END;"
  , "$fn$ LANGUAGE plpgsql IMMUTABLE;"
  ]

jsonbObjToArraySQL :: Text
jsonbObjToArraySQL = T.unlines
  [ "CREATE OR REPLACE FUNCTION jsonb_obj_to_array(obj jsonb) RETURNS jsonb AS $fn$"
  , "SELECT COALESCE((SELECT jsonb_agg(val ORDER BY idx::int) FROM jsonb_each(obj) AS e(idx, val) WHERE idx != '_length'), '[]'::jsonb);"
  , "$fn$ LANGUAGE sql IMMUTABLE;"
  ]
