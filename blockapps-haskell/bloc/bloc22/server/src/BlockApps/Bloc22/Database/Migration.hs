{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc22.Database.Migration
  ( runBlocMigrations
  ) where

import           Control.Exception                            (catch)
import           Control.Monad
import           Data.Maybe
import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

import           BlockApps.Bloc22.Database.Create
import           BlockApps.Bloc22.Database.Queries
import           BlockApps.Bloc22.Database.Queries.Deprecated
import           BlockApps.Bloc22.Monad

data Migration = MigrationAction (Bloc ())
               | MigrationQuery (MigrationErrorBehavior, Query)

data MigrationErrorBehavior = Throw | Catch

runBlocMigrations :: Bloc ()
runBlocMigrations = do
  dbsvs <- blocModify $ \conn -> catch
    (query_ conn getSchemaVersion :: IO [Only Int])
    ((return . const []) :: (SqlError -> IO [Only Int]))
  let dbSchemaVersion = maybe 0 fromOnly $ listToMaybe dbsvs
  forM_ (drop dbSchemaVersion migrations) $ \case
    MigrationAction action -> action
    MigrationQuery (meb,q) -> void . blocModify $ \conn -> do
      case meb of
        Catch -> catch
          (execute_ conn q)
          (\e@SqlError{..} -> putStrLn "Error suppressed: " >> print e >> return 0)
        Throw -> execute_ conn q
  updateMigrationNumber

updateMigrationNumber :: Bloc ()
updateMigrationNumber = void . blocModify $ \conn -> execute conn updateSchemaVersion (Only $ length migrations)

migrations :: [Migration]
migrations = [ MigrationQuery (Throw, createTables)
             , MigrationQuery (Throw, insertSchemaVersion)
             , MigrationQuery (Throw, dropHashNameTable)
             , MigrationQuery (Throw, hashNameTable)
             , MigrationQuery (Throw, addConstantColumn)
             , MigrationQuery (Throw, addValueColumn)
             , MigrationQuery (Throw, addMutabilityColumn)
             , MigrationQuery (Throw, addChainIdColumn)
             , MigrationQuery (Throw, contractsSourceTable)
             , MigrationQuery (Throw, addSrcHashColumn)
             , MigrationQuery (Throw, alterValueColumn)
             , MigrationQuery (Throw, addXabiColumn)
             , MigrationAction migrateXabi
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
addConstantColumn = [sql| ALTER TABLE xabi_variables ADD COLUMN IF NOT EXISTS is_constant boolean default FALSE; |]

addValueColumn :: Query
addValueColumn = [sql| ALTER TABLE xabi_variables ADD COLUMN IF NOT EXISTS value varchar(512); |]

addMutabilityColumn :: Query
addMutabilityColumn = [sql| ALTER TABLE xabi_functions ADD COLUMN IF NOT EXISTS mutability varchar(20); |]

addChainIdColumn :: Query
addChainIdColumn = [sql| ALTER TABLE contracts_instance ADD COLUMN IF NOT EXISTS chainid bytea; |]

addSrcHashColumn :: Query
addSrcHashColumn = [sql| ALTER TABLE contracts_metadata ADD COLUMN IF NOT EXISTS src_hash bytea; |]

alterValueColumn :: Query
alterValueColumn = [sql| ALTER TABLE xabi_variables ALTER COLUMN value TYPE text; |]

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
    xabi <- serializeXabi <$> getContractXabiFromMetaDataIdDeprecated i
    void . blocModify $ \conn -> execute conn xabiQuery (i,xabi)
