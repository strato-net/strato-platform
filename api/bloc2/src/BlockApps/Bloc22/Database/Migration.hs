{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE QuasiQuotes         #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module BlockApps.Bloc22.Database.Migration
  ( runBlocMigrations
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
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
import           BlockApps.Logging
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Control.Monad.Composable.BlocSQL

runBlocMigrations :: (MonadIO m, MonadLogger m, HasBlocSQL m) => m ()
runBlocMigrations = do
--  dbsvs <- blocModify $ \conn -> catch
--    (query_ conn getSchemaVersion :: IO [Only Int])
--    ((return . const []) :: (SqlError -> IO [Only Int]))
--  let dbSchemaVersion = maybe 0 fromOnly $ listToMaybe dbsvs
--  $logInfoS "runBlocMigrations" . T.pack $ "dbSchemaVersion: " ++ show dbSchemaVersion

  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Create tables"
  void . blocModify $ \conn -> execute_ conn createTables

             
{-
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Insert schema version"
  void . blocModify $ \conn -> execute_ conn insertSchemaVersion
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Drop hash name table"
  void . blocModify $ \conn -> execute_ conn dropHashNameTable
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Hash name table"
  void . blocModify $ \conn -> execute_ conn hashNameTable
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Add constant column"
  void . blocModify $ \conn -> execute_ conn addConstantColumn
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Add value column"
  void . blocModify $ \conn -> execute_ conn addValueColumn
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Add mutability column"
  void . blocModify $ \conn -> execute_ conn addMutabilityColumn
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Add Chain ID column"
  void . blocModify $ \conn -> execute_ conn addChainIdColumn
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Contracts source table"
  void . blocModify $ \conn -> execute_ conn contractsSourceTable
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Add source hash column"
  void . blocModify $ \conn -> execute_ conn addSrcHashColumn
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Alter value column"
  void . blocModify $ \conn -> execute_ conn alterValueColumn
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Add Xabi column"
  void . blocModify $ \conn -> execute_ conn addXabiColumn
      
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationAction: Migrate Xabi"
  migrateXabi
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Drop Xabi Tables"
  void . blocModify $ \conn -> execute_ conn dropXabiTables

  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationAction: Migrate code hash to CodePtr"
  migrateCodeHashToCodePtr
  
  $logInfoS "runBlocMigrations" . T.pack $ "Running MigrationQuery: Alter hash name data column"
  void . blocModify $ \conn -> execute_ conn alterDataColumn

  
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

{-
updateMigrationNumber :: MonadIO m => m ()
updateMigrationNumber = void . blocModify $ \conn -> execute conn updateSchemaVersion (Only $ length migrations)
-}
--migrations :: [(String, Migration)]
--migrations = [ ]

insertSchemaVersion :: Query
insertSchemaVersion = [sql| INSERT INTO bloc_schema_version VALUES (1,1); |]

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

migrateXabi :: (MonadIO m, MonadLogger m, HasBlocSQL m) => m ()
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

migrateCodeHashToCodePtr :: (MonadIO m, MonadLogger m, HasBlocSQL m) => m ()
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
    for_ (Just $ unsafeCreateKeccak256FromByteString bs) $ \kecc -> do
      let codePtrBS = Binary . rlpSerialize . EVMCode $ kecc
      $logInfoS "migrateCodeHashToCodePtr" . T.pack $ concat
        [ "Processing ID "
        , show i
        , ": "
        , show codePtrBS
        ]
      void . blocModify $ \conn -> execute conn xabiQuery (i, codePtrBS)

alterDataColumn :: Query
alterDataColumn = [sql| ALTER TABLE IF EXISTS hash_name ALTER COLUMN data_string TYPE text; |]
-}