{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
module TestImport
    ( module TestImport
    , module XX
    ) where

import           Application           (makeFoundation, makeLogware)
import           ClassyPrelude         as XX hiding (delete, deleteBy)
import           Database.Persist      as XX hiding (get)
import           Database.Persist.Sql  (SqlBackend, SqlPersistM, connEscapeName, rawExecute,
                                        rawSql, runSqlPersistMPool, unSingle, runMigrationSilent)
import           Foundation            as XX hiding (Handler)
import           Test.Hspec            as XX
import           Yesod.Default.Config2 (ignoreEnv, loadYamlSettings)
import           Yesod.Test            as XX

import qualified Blockchain.Data.Blockchain as DataBlock
import qualified Blockchain.Data.DataDefs as DataDefs
import qualified Blockchain.DB.SQLDB as SQL
import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer

instance SQL.HasSQLDB (YesodExample App) where
  getSQLDB = appConnPool <$> getTestYesod

runDB :: SqlPersistM a -> YesodExample App a
runDB query = do
    app <- getTestYesod
    liftIO $ runDBWithApp app query

runDBWithApp :: App -> SqlPersistM a -> IO a
runDBWithApp app query = runSqlPersistMPool query (appConnPool app)

getSiteAction :: IO App
getSiteAction = do
  settings <- loadYamlSettings
     ["config/test-settings.yml", "config/settings.yml"]
     []
     ignoreEnv
  makeFoundation settings

withApp :: SpecWith (TestApp App) -> Spec
withApp = before $ do
  foundation <- liftIO getSiteAction
  wipeDB foundation
  logWare <- liftIO $ makeLogware foundation
  return . testApp foundation $ logWare

-- This function will truncate all of the tables in your database.
-- 'withApp' calls it before each test, creating a clean environment for each
-- spec to run in.
wipeDB :: App -> IO ()
wipeDB app = do
    runDBWithApp app $ do
        tables <- getTables
        sqlBackend <- ask
        let escapedTables = map (connEscapeName sqlBackend . DBName) tables
            query = "TRUNCATE TABLE " ++ (intercalate ", " escapedTables)
        rawExecute query []

        _ <- runMigrationSilent DataBlock.migrateAll
        _ <- runMigrationSilent DataDefs.migrateAll
        _ <- runMigrationSilent DataPeer.migrateAll
        return ()

getTables :: MonadIO m => ReaderT SqlBackend m [Text]
getTables = do
    tables <- rawSql "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';" []
    return $ map unSingle tables
