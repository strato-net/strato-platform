{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE QuasiQuotes         #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module BlockApps.Bloc22.Database.Migration
  ( runBlocMigrations
  ) where

import           Control.Exception                            (catch)
import           Control.Monad
import           Data.Foldable                                (for_)
import           Data.Maybe
import           Data.RLP
import qualified Data.Text                                    as T
import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

import           BlockApps.Bloc22.Database.Create
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Queries.Deprecated
import           BlockApps.Bloc22.Monad
import           BlockApps.Ethereum
import           BlockApps.Logging

data Migration = MigrationAction (Bloc ())
               | MigrationQuery (MigrationErrorBehavior, Query)

data MigrationErrorBehavior = Throw | Catch

runBlocMigrations :: Bloc ()
runBlocMigrations = do
  dbsvs <- blocModify $ \conn -> catch
    (query_ conn getSchemaVersion :: IO [Only Int])
    ((return . const []) :: (SqlError -> IO [Only Int]))
  let dbSchemaVersion = maybe 0 fromOnly $ listToMaybe dbsvs
  $logInfoS "runBlocMigrations" . T.pack $ "dbSchemaVersion: " ++ show dbSchemaVersion
  forM_ (drop dbSchemaVersion migrations) $ \(name, migration) -> case migration of
    MigrationAction action -> do
      $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationAction: " ++ name
      action
    MigrationQuery (meb,q) -> do
      $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: " ++ name
      void . blocModify $ \conn -> do
        case meb of
          Catch -> catch
            (execute_ conn q)
            (\e@SqlError{..} -> putStrLn "Error suppressed: " >> print e >> return 0)
          Throw -> execute_ conn q
  updateMigrationNumber

updateMigrationNumber :: Bloc ()
updateMigrationNumber = void . blocModify $ \conn -> execute conn updateSchemaVersion (Only $ length migrations)

migrations :: [(String, Migration)]
migrations = [ ("Create tables"               , MigrationQuery (Throw, createTables))
             , ("Insert schema version"       , MigrationQuery (Throw, insertSchemaVersion))
             , ("Drop hash name table"        , MigrationQuery (Throw, dropHashNameTable))
             , ("Hash name table"             , MigrationQuery (Throw, hashNameTable))
             , ("Add constant column"         , MigrationQuery (Throw, addConstantColumn))
             , ("Add value column"            , MigrationQuery (Throw, addValueColumn))
             , ("Add mutability column"       , MigrationQuery (Throw, addMutabilityColumn))
             , ("Add Chain ID column"         , MigrationQuery (Throw, addChainIdColumn))
             , ("Contracts source table"      , MigrationQuery (Throw, contractsSourceTable))
             , ("Add source hash column"      , MigrationQuery (Throw, addSrcHashColumn))
             , ("Alter value column"          , MigrationQuery (Throw, alterValueColumn))
             , ("Add Xabi column"             , MigrationQuery (Throw, addXabiColumn))
             , ("Migrate Xabi"                , MigrationAction migrateXabi)
             , ("Drop Xabi Tables"            , MigrationQuery (Throw, dropXabiTables))
             , ("Migrate code hash to CodePtr", MigrationAction migrateCodeHashToCodePtr)
             , ("Alter hash name data column" , MigrationQuery (Throw, alterDataColumn))
             ]

getSchemaVersion :: Query
getSchemaVersion = [sql| SELECT schema_version FROM bloc_schema_version WHERE id=1; |]

insertSchemaVersion :: Query
insertSchemaVersion = [sql| INSERT INTO bloc_schema_version VALUES (1,1); |]

updateSchemaVersion :: Query
updateSchemaVersion = [sql| UPDATE bloc_schema_version SET schema_version=? WHERE id=1; |]

dropHashNameTable :: Query
dropHashNameTable = [sql| DROP TABLE IF EXISTS hash_name; |]

addConstantColumn :: Query
addConstantColumn = [sql| ALTER TABLE IF EXISTS xabi_variables ADD COLUMN IF NOT EXISTS is_constant boolean default FALSE; |]

addValueColumn :: Query
addValueColumn = [sql| ALTER TABLE IF EXISTS xabi_variables ADD COLUMN IF NOT EXISTS value varchar(512); |]

addMutabilityColumn :: Query
addMutabilityColumn = [sql| ALTER TABLE IF EXISTS xabi_functions ADD COLUMN IF NOT EXISTS mutability varchar(20); |]

addChainIdColumn :: Query
addChainIdColumn = [sql| ALTER TABLE contracts_instance ADD COLUMN IF NOT EXISTS chainid bytea; |]

addSrcHashColumn :: Query
addSrcHashColumn = [sql| ALTER TABLE contracts_metadata ADD COLUMN IF NOT EXISTS src_hash bytea; |]

alterValueColumn :: Query
alterValueColumn = [sql| ALTER TABLE IF EXISTS xabi_variables ALTER COLUMN value TYPE text; |]

addXabiColumn :: Query
addXabiColumn = [sql| ALTER TABLE contracts_metadata ADD COLUMN IF NOT EXISTS xabi bytea; |]

migrateXabi :: Bloc ()
migrateXabi = do
  let idQuery = [sql| SELECT id FROM contracts_metadata ORDER BY id DESC LIMIT 1; |]
      xabiQuery = [sql| UPDATE contracts_metadata
                           SET xabi = tup.x
                          FROM (VALUES (?,?::bytea)) as tup(i,x)
                         WHERE id = tup.i;
                      |]
  maxId <- fromMaybe 0 . listToMaybe . map fromOnly <$> blocModify (flip query_ idQuery)
  forM_ [0..maxId] $ \i -> do
    xabi <- Binary . serializeXabi <$> getContractXabiFromMetaDataIdDeprecated i
    void . blocModify $ \conn -> execute conn xabiQuery (i,xabi)

dropXabiTables :: Query
dropXabiTables = [sql| DROP TABLE IF EXISTS contracts_lookup;
                       DROP TABLE IF EXISTS xabi_function_arguments;
                       DROP TABLE IF EXISTS xabi_function_returns;
                       DROP TABLE IF EXISTS xabi_variables;
                       DROP TABLE IF EXISTS xabi_enum_names;
                       DROP TABLE IF EXISTS xabi_struct_fields;
                       DROP TABLE IF EXISTS xabi_functions;
                       DROP TABLE IF EXISTS xabi_types;
                       DROP TABLE IF EXISTS xabi_type_defs;
                     |]

migrateCodeHashToCodePtr :: Bloc ()
migrateCodeHashToCodePtr = do
  let idQuery = [sql| SELECT id,code_hash FROM contracts_metadata; |]
      xabiQuery = [sql| UPDATE contracts_metadata
                           SET code_hash = tup.x
                          FROM (VALUES (?,?::bytea)) as tup(i,x)
                         WHERE id = tup.i;
                      |]
  idsAndCodeHashes <- blocModify $ flip query_ idQuery
  $logInfoS "migrateCodeHashToCodePtr" "Migrating code hashes to CodePtrs"
  forM_ idsAndCodeHashes $ \(i :: Integer, bs) ->
    for_ (byteStringKeccak256 bs) $ \kecc -> do
      let codePtrBS = Binary . rlpSerialize . EVMCode $ keccak256SHA kecc
      $logInfoS "migrateCodeHashToCodePtr" . T.pack $ concat
        [ "Processing ID "
        , show i
        , ": "
        , show codePtrBS
        ]
      void . blocModify $ \conn -> execute conn xabiQuery (i, codePtrBS)

alterDataColumn :: Query
alterDataColumn = [sql| ALTER TABLE IF EXISTS hash_name ALTER COLUMN data_string TYPE text; |]
