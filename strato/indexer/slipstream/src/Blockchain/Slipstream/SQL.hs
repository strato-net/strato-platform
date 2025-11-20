{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Slipstream.SQL where

import           BlockApps.Logging
import           Blockchain.Slipstream.Data.CirrusTables
import           Blockchain.Slipstream.Options
import           Blockchain.Slipstream.PostgresqlTypedShim
import           Blockchain.Stream.Action                  (Delegatecall(..))
import           Conduit
import           Control.Monad
import           Data.ByteString                           (ByteString)
import qualified Data.ByteString.Char8                     as BC
import           Data.Text                                 (Text)
import           Data.Text.Encoding                        (encodeUtf8)
import qualified Database.Esqueleto                        as E
import           Database.Persist                          (insert_)
import           Prelude                                   hiding (lookup)
import           UnliftIO

cirrusConnStr :: ByteString
cirrusConnStr =
    BC.pack $
        "host="     ++ flags_pghost     ++ " " ++
        "port="     ++ show flags_pgport ++ " " ++
        "user="     ++ flags_pguser     ++ " " ++
        "password=" ++ flags_password ++ " " ++
        "dbname="   ++ flags_database

insertDelegatecallPostgres :: (MonadUnliftIO m, MonadLogger m) => PGConnection -> Delegatecall -> m ()
insertDelegatecallPostgres conn (Delegatecall storageAddr codeAddress Nothing contractName) =
  performSQLQueries conn
    [
      E.insertSelect $ do
        src <- E.from $ \c -> do
          E.where_ (c E.^. ContractAddress E.==. E.val (StorageKey codeAddress))
          return c
          -- Build an Insertion MyTable by listing *non-id* fields in schema order:
        pure $ Contract
          E.<#  (E.val $ StorageKey storageAddr)
          E.<&> (src E.^. ContractCreator)
          E.<&> (E.val contractName)
    ]
insertDelegatecallPostgres conn (Delegatecall s _ (Just c) n) =
  performSQLQueries conn [insert_ $ Contract (StorageKey s) c n]

performSQLQueries :: (MonadLogger m, MonadUnliftIO m) =>
                     PGConnection -> [E.SqlPersistT m ()] -> m ()
performSQLQueries conn slipstreamQueries = do
  handle handlePostgresError $ E.runSqlPool (sequence_ slipstreamQueries) conn

dbQueryCatchError :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQueryCatchError conn insrt = handle handlePostgresError $ dbQuery conn insrt

dbQuery :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQuery conn insrt = do
  $logDebugS "outputData" insrt
  liftIO . void . pgQuery conn $! encodeUtf8 insrt

handlePostgresError :: MonadLogger m => SomeException -> m ()
handlePostgresError e =
  if crashOnSQLError
    then error . show $ e
    else $logErrorLS "handlePGError" e

crashOnSQLError :: Bool
crashOnSQLError = False
