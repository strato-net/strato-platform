{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Slipstream.SQL where

import           BlockApps.Logging
import           Blockchain.Slipstream.Data.CirrusTables
import           Blockchain.Slipstream.OutputData
import           Blockchain.Slipstream.PostgresqlTypedShim
import           Blockchain.Stream.Action                  (Delegatecall(..))
import           Conduit
import           Control.Monad
import qualified Data.ByteString                            as B
import           Data.Text                                 (Text)
import qualified Data.Text                                 as T
import           Data.Text.Encoding                        (encodeUtf8)
import qualified Database.Esqueleto                        as E
import           Database.Persist                          (insertUnique_)
import           Database.Persist.Sql                      (rawExecute)
import           Database.PostgreSQL.Simple                (SqlError(..))
import           Prelude                                   hiding (lookup)
import           UnliftIO

insertDelegatecallPostgres :: (MonadUnliftIO m, MonadLogger m) => PGConnection -> Delegatecall -> m ()
insertDelegatecallPostgres conn (Delegatecall s c n) =
  performSQLQueries conn [void . insertUnique_ $ Contract s c n]

performSlipstreamQueries :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> [SlipstreamQuery] -> m ()
performSlipstreamQueries _ [] = pure ()
performSlipstreamQueries conn queries =
  mapM_ executeChunkWithFallback . slipstreamQueryChunks $ prepareSlipstreamQueries queries
  where
    executeChunkWithFallback chunk =
      catch
        (E.runSqlPool (executeQueries chunk) conn)
        (\e -> handleChunkError chunk (e :: SqlError))

    handleChunkError chunk e
      | crashOnSQLError || not (isRecoverableSqlState $ sqlState e) = throwIO e
      | otherwise = do
          $logErrorLS "performSlipstreamQueries" e
          mapM_ executeIndividually chunk

    executeQueries :: MonadIO n => [SlipstreamQuery] -> E.SqlPersistT n ()
    executeQueries [] = pure ()
    executeQueries (InsertDelegatecall (Delegatecall s c n) : rest) = do
      void . insertUnique_ $ Contract s c n
      executeQueries rest
    executeQueries remaining = do
      let (sqlQueries, rest) = break isDelegatecall remaining
      executeChunk sqlQueries
      executeQueries rest

    executeChunk :: MonadIO n => [SlipstreamQuery] -> E.SqlPersistT n ()
    executeChunk chunk =
      let statements =
            filter (not . T.null . T.strip) $ slipstreamQueryPostgres <$> chunk
       in unless (null statements) $
            rawExecute (T.concat $ (<> ";\n") <$> statements) []

    isDelegatecall InsertDelegatecall {} = True
    isDelegatecall _ = False

    executeIndividually query =
      catch
        (case query of
          InsertDelegatecall (Delegatecall s c n) ->
            E.runSqlPool (void . insertUnique_ $ Contract s c n) conn
          _ -> dbQuery conn $ slipstreamQueryPostgres query)
        (\e -> handleIndividualError (e :: SqlError))

    handleIndividualError e
      | crashOnSQLError || not (isRecoverableSqlState $ sqlState e) = throwIO e
      | otherwise = $logErrorLS "performSlipstreamQueries/individual" e

slipstreamQueryChunkSize :: Int
slipstreamQueryChunkSize = 256

slipstreamQueryChunkBytes :: Int
slipstreamQueryChunkBytes = 2 * 1024 * 1024

slipstreamInsertRowLimit :: Int
slipstreamInsertRowLimit = 256

slipstreamInsertBytes :: Int
slipstreamInsertBytes = 1024 * 1024

prepareSlipstreamQueries :: [SlipstreamQuery] -> [SlipstreamQuery]
prepareSlipstreamQueries = concatMap splitLargeInsert
  where
    splitLargeInsert query@InsertTable {values = rows}
      | length rows <= 1 = [query]
      | length rows > slipstreamInsertRowLimit || querySizeBytes query > slipstreamInsertBytes =
          let splitPoint =
                if length rows > slipstreamInsertRowLimit
                  then slipstreamInsertRowLimit
                  else max 1 $ length rows `div` 2
              (firstRows, remainingRows) = splitAt splitPoint rows
           in splitLargeInsert query {values = firstRows}
                ++ splitLargeInsert query {values = remainingRows}
      | otherwise = [query]
    splitLargeInsert query = [query]

slipstreamQueryChunks :: [SlipstreamQuery] -> [[SlipstreamQuery]]
slipstreamQueryChunks = go [] 0 0
  where
    go [] _ _ [] = []
    go chunk _ _ [] = [reverse chunk]
    go chunk chunkCount chunkBytes queries@(query : rest)
      | not (null chunk)
          && (chunkCount >= slipstreamQueryChunkSize
                || chunkBytes + queryBytes > slipstreamQueryChunkBytes) =
          reverse chunk : go [] 0 0 queries
      | otherwise =
          go (query : chunk) (chunkCount + 1) (chunkBytes + queryBytes) rest
      where
        queryBytes = querySizeBytes query

querySizeBytes :: SlipstreamQuery -> Int
querySizeBytes = B.length . encodeUtf8 . slipstreamQueryPostgres

isRecoverableSqlState :: B.ByteString -> Bool
isRecoverableSqlState state =
  any (`B.isPrefixOf` state) ["22", "23", "42", "P0"]

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
