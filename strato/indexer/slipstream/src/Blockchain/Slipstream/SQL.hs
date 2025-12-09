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
insertDelegatecallPostgres conn (Delegatecall storageAddr codeAddress Nothing contractName) = do
  -- 1) Preserve existing behavior: stamp the proxy with the name of the currently
  --    executing frame (e.g., Ownable if onlyOwner runs first)
  performSQLQueries conn
    [ E.insertSelect $ do
        src <- E.from $ \c -> do
          E.where_ (c E.^. ContractAddress E.==. E.val (StorageKey codeAddress))
          return c
        pure $ Contract
          E.<#  (E.val $ StorageKey storageAddr)
          E.<&> (src E.^. ContractCreator)
          E.<&> (E.val contractName)
    ]
  -- 2) Additionally stamp the proxy with the "declaring"/implementation contract
  --    name of the codeAddress (e.g., BlockApps-Rewards), so typed Cirrus views
  --    that join on the implementation name can resolve correctly.
  --    Use NOT EXISTS semantics to avoid unique violations on repeated events.
  performSQLQueries conn
    [ E.insertSelect $ do
        src <- E.from $ \c -> do
          E.where_ (c E.^. ContractAddress E.==. E.val (StorageKey codeAddress))
          -- ensure we don't duplicate an existing (address, creator, contract_name)
          E.where_ $ E.notExists $ do
            E.from $ \d -> do
              E.where_
                (   d E.^. ContractAddress       E.==. E.val (StorageKey storageAddr)
                E.&&. d E.^. ContractCreator       E.==. c E.^. ContractCreator
                E.&&. d E.^. ContractContract_name E.==. c E.^. ContractContract_name
                )
              return ()
          return c
        pure $ Contract
          E.<#  (E.val $ StorageKey storageAddr)
          E.<&> (src E.^. ContractCreator)
          E.<&> (src E.^. ContractContract_name)
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
  $logDebugS "dbQuery" insrt
  liftIO . void . pgQuery conn $! encodeUtf8 insrt

handlePostgresError :: MonadLogger m => SomeException -> m ()
handlePostgresError e =
  if crashOnSQLError
    then error . show $ e
    else $logErrorLS "handlePGError" e

crashOnSQLError :: Bool
crashOnSQLError = False
