{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}

module Strato.Strato23.Database.Migrations where

import Control.Exception (catch)
import Control.Monad (forM_)
import Data.Int (Int64)
import Data.Maybe (listToMaybe)
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Simple.SqlQQ
import Strato.Strato23.Database.Create (createTables, messageTable)

data MigrationErrorBehavior = Throw | Catch

runMigrations :: Connection -> IO Int64
runMigrations conn = do
  dbsvs <- (query_ conn getSchemaVersion :: IO [Only Int]) `catch` (\e@SqlError {} -> putStrLn "Error getting schema version" >> print e >> return [Only 0])
  let dbSchemaVersion = maybe 0 fromOnly $ listToMaybe dbsvs
  forM_ (drop dbSchemaVersion migrations) $ \(meb, q) -> do
    case meb of
      Catch -> (execute_ conn q) `catch` (\e@SqlError {} -> putStrLn "Error suppressed: " >> print e >> return 0)
      Throw -> execute_ conn q
  updateMigrationNumber conn

updateMigrationNumber :: Connection -> IO Int64
updateMigrationNumber conn = execute conn updateSchemaVersion (Only $ length migrations)

migrations :: [(MigrationErrorBehavior, Query)]
migrations =
  [ (Throw, createTables),
    (Throw, insertSchemaVersion),
    (Throw, insertAddress),
    (Throw, messageTable),
    (Throw, insertSecPrvKey),
    (Throw, insertPublicKey),
    (Throw, removePublicKey),
    (Throw, insertOauthProvider),
    (Throw, modifytOauthProvider),
    (Throw, removeEncKey)
  ]

getSchemaVersion :: Query
getSchemaVersion = [sql| SELECT schema_version FROM vault_wrapper_schema_version WHERE id=1; |]

insertSchemaVersion :: Query
insertSchemaVersion = [sql| INSERT INTO vault_wrapper_schema_version VALUES (1,1); |]

updateSchemaVersion :: Query
updateSchemaVersion = [sql| UPDATE vault_wrapper_schema_version SET schema_version=? WHERE id=1; |]

insertAddress :: Query
insertAddress = [sql| ALTER TABLE users ADD COLUMN IF NOT EXISTS address bytea; |]

insertSecPrvKey :: Query
insertSecPrvKey = [sql| ALTER TABLE users ADD COLUMN IF NOT EXISTS enc_sec_prv_key bytea NOT NULL; |]

insertPublicKey :: Query
insertPublicKey = [sql| ALTER TABLE users ADD COLUMN IF NOT EXISTS pub_key bytea; |]

removePublicKey :: Query
removePublicKey = [sql| ALTER TABLE users DROP COLUMN IF EXISTS pub_key; |]

insertOauthProvider :: Query
insertOauthProvider = [sql| ALTER TABLE users ADD COLUMN IF NOT EXISTS x_identity_provider_id varchar(512) NOT NULL DEFAULT 'keycloak.blockapps.net'; |]

modifytOauthProvider :: Query
modifytOauthProvider = [sql| ALTER TABLE users ALTER COLUMN x_identity_provider_id DROP DEFAULT; |]

removeEncKey :: Query
removeEncKey = [sql| ALTER TABLE users DROP COLUMN IF EXISTS enc_sec_key; |]
