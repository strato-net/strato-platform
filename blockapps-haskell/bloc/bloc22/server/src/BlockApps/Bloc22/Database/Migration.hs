{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}

module BlockApps.Bloc22.Database.Migration where

import           Control.Monad                     (forM_)
import           Data.Int                          (Int64)
import           Data.Maybe                        (maybe, listToMaybe)
import           Database.PostgreSQL.Simple
import           Database.PostgreSQL.Simple.SqlQQ

import           BlockApps.Bloc22.Database.Create  (schemaVersionTable, hashNameTable)

runBlocMigrations :: Connection -> IO Int64
runBlocMigrations conn = do
  Only dbSchemaVersion <- maybe (Only 0) id . listToMaybe <$>
    (query_ conn getSchemaVersion :: IO [Only Int])
  forM_ (drop dbSchemaVersion migrations) (execute_ conn)
  execute conn updateSchemaVersion (Only $ length migrations)

migrations :: [Query]
migrations = [ schemaVersionTable
             , dropHashNameTable
             , hashNameTable
             ]

getSchemaVersion :: Query
getSchemaVersion = [sql| SELECT schema_version FROM bloc_schema_version WHERE id=1; |]

updateSchemaVersion :: Query
updateSchemaVersion = [sql| UPDATE bloc_schema_version SET schema_version=? WHERE id=1; |]

dropHashNameTable :: Query
dropHashNameTable = [sql| DROP TABLE IF EXISTS hash_name; |]
