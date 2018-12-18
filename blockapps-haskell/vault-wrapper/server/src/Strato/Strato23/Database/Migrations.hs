{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}

module Strato.Strato23.Database.Migrations where

import           Control.Exception                 (catch)
import           Control.Monad                     (forM_)
import           Data.Int                          (Int64)
import           Data.Maybe                        (maybe, listToMaybe)
import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

import           Strato.Strato23.Database.Create  (createTables)

data MigrationErrorBehavior = Throw | Catch

runMigrations :: Connection -> IO Int64
runMigrations conn = do
  dbsvs <- (query_ conn getSchemaVersion :: IO [Only Int]) `catch` (\e@SqlError{..} -> putStrLn "Error getting schema version" >> print e >> return [Only 0])
  let dbSchemaVersion = maybe 0 fromOnly $ listToMaybe dbsvs
  forM_ (drop dbSchemaVersion migrations) $ \(meb,q) -> do
    case meb of
      Catch -> (execute_ conn q) `catch` (\e@SqlError{..} -> putStrLn "Error suppressed: " >> print e >> return 0)
      Throw -> execute_ conn q
  updateMigrationNumber conn

updateMigrationNumber :: Connection -> IO Int64
updateMigrationNumber conn = execute conn updateSchemaVersion (Only $ length migrations)

migrations :: [(MigrationErrorBehavior, Query)]
migrations = [ (Throw, createTables)
             , (Throw, insertSchemaVersion)
             , (Throw, insertAddress)
             ]

getSchemaVersion :: Query
getSchemaVersion = [sql| SELECT schema_version FROM vault_wrapper_schema_version WHERE id=1; |]

insertSchemaVersion :: Query
insertSchemaVersion = [sql| INSERT INTO vault_wrapper_schema_version VALUES (1,1); |]

updateSchemaVersion :: Query
updateSchemaVersion = [sql| UPDATE vault_wrapper_schema_version SET schema_version=? WHERE id=1; |]

insertAddress :: Query
insertAddress = [sql| ALTER TABLE users ADD COLUMN IF NOT EXISTS address bytea; |]
