{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}

module BlockApps.Bloc22.Database.Migration where

import           Control.Exception                 (catch)
import           Control.Monad                     (forM_)
import           Data.Int                          (Int64)
import           Data.Maybe                        (maybe, listToMaybe)
import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

import           BlockApps.Bloc22.Database.Create  (createTables, hashNameTable)

data MigrationErrorBehavior = Throw | Catch

runBlocMigrations :: Connection -> IO Int64
runBlocMigrations conn = do
  dbsvs <- (query_ conn getSchemaVersion :: IO [Only Int]) `catch` (\(SqlError{..}) -> return [Only 0])
  let dbSchemaVersion = maybe 0 fromOnly $ listToMaybe dbsvs
  forM_ (drop dbSchemaVersion migrations) $ \(meb,q) -> do
    case meb of
      Catch -> (execute_ conn q) `catch` (\SqlError{..} -> return 0)
      Throw -> execute_ conn q
  updateMigrationNumber conn

updateMigrationNumber :: Connection -> IO Int64
updateMigrationNumber conn = execute conn updateSchemaVersion (Only $ length migrations)

migrations :: [(MigrationErrorBehavior, Query)]
migrations = [ (Throw, createTables)
             , (Throw, insertSchemaVersion)
             , (Throw, dropHashNameTable)
             , (Throw, hashNameTable)
             , (Throw, addValueColumn)
             ]

getSchemaVersion :: Query
getSchemaVersion = [sql| SELECT schema_version FROM bloc_schema_version WHERE id=1; |]

insertSchemaVersion :: Query
insertSchemaVersion = [sql| INSERT INTO bloc_schema_version VALUES (1,1); |]

updateSchemaVersion :: Query
updateSchemaVersion = [sql| UPDATE bloc_schema_version SET schema_version=? WHERE id=1; |]

dropHashNameTable :: Query
dropHashNameTable = [sql| DROP TABLE IF EXISTS hash_name; |]

addValueColumn :: Query
addValueColumn = [sql| ALTER TABLE xabi_variables ADD COLUMN IF NOT EXISTS value varchar(512); |]
