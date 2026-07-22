{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Slipstream.SQL where

import           BlockApps.Logging
import           Blockchain.Slipstream.Data.CirrusTables
import           Blockchain.Slipstream.PostgresqlTypedShim
import           Blockchain.Stream.Action                  (Delegatecall(..))
import           Conduit
import           Control.Monad
import           Data.Text                                 (Text)
import           Data.Text.Encoding                        (encodeUtf8)
import qualified Database.Esqueleto                        as E
import           Database.Persist                          (insert_)
import           Prelude                                   hiding (lookup)
import           UnliftIO

insertDelegatecallPostgres :: (MonadUnliftIO m, MonadLogger m) => PGConnection -> Delegatecall -> m ()
insertDelegatecallPostgres conn (Delegatecall s c n) =
  performSQLQueries conn [insert_ $ Contract s c n]

performSQLQueries :: (MonadLogger m, MonadUnliftIO m) =>
                     PGConnection -> [E.SqlPersistT m ()] -> m ()
performSQLQueries conn slipstreamQueries = do
  handle handlePostgresError $ E.runSqlPool (sequence_ slipstreamQueries) conn

dbQueryCatchError :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQueryCatchError conn insrt = handle handlePostgresError $ dbQuery conn insrt

dbQuery :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> Text -> m ()
dbQuery conn insrt = do
  $logDebugS "dbQuery" insrt
  liftIO . void . pgQuery conn $! encodeUtf8 insrt

handlePostgresError :: MonadLogger m => SomeException -> m ()
handlePostgresError e =
  if crashOnSQLError
    then error . show $ e
    else $logErrorLS "handlePGError" e

crashOnSQLError :: Bool
crashOnSQLError = False
