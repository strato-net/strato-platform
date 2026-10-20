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
import qualified Data.Text                                 as T
import qualified Database.Esqueleto                        as E
import           Database.Persist                          (insertUnique_)
import           Database.Persist.Sql                      (rawExecute)
import           Database.PostgreSQL.Simple                (SqlError(..))
import           Prelude                                   hiding (lookup)
import           UnliftIO

performSlipstreamQueries :: (MonadLogger m, MonadUnliftIO m) => PGConnection -> [SlipstreamQuery] -> m ()
performSlipstreamQueries _ [] = pure ()
performSlipstreamQueries conn queries =
  catch
    (E.runSqlPool (executeQueries queries) conn)
    (\e -> handleBatchError (e :: SqlError))
  where
    handleBatchError e
      | crashOnSQLError || not (isRecoverableSqlState $ sqlState e) = throwIO e
      | otherwise = do
          $logErrorLS "performSlipstreamQueries" e
          mapM_ executeIndividually queries

    executeQueries :: MonadUnliftIO n => [SlipstreamQuery] -> E.SqlPersistT n ()
    executeQueries [] = pure ()
    executeQueries (InsertDelegatecall (Delegatecall s c n) : rest) = do
      void . insertUnique_ $ Contract s c n
      executeQueries rest
    executeQueries remaining = do
      let (sqlQueries, rest) = break isDelegatecall remaining
      executeStatements sqlQueries
      executeQueries rest

    executeStatements :: MonadUnliftIO n => [SlipstreamQuery] -> E.SqlPersistT n ()
    executeStatements batch =
      let statements =
            filter (not . T.null . T.strip) $ slipstreamQueryPostgres <$> batchStateQueries batch
       in unless (null statements) $
            withStatementCacheCleanup $
              rawExecute (T.concat $ (<> ";\n") <$> statements) []

    isDelegatecall InsertDelegatecall {} = True
    isDelegatecall _ = False

    executeIndividually query =
      catch
        (E.runSqlPool (executeQueries [query]) conn)
        (\e -> handleIndividualError query (e :: SqlError))

    handleIndividualError query e
      | crashOnSQLError || maybe False (const True) (stateKind query) || not (isRecoverableSqlState $ sqlState e) = throwIO e
      | otherwise = $logErrorLS "performSlipstreamQueries/individual" e

isRecoverableSqlState :: B.ByteString -> Bool
isRecoverableSqlState state =
  any (`B.isPrefixOf` state) ["22", "23", "42", "P0"]

crashOnSQLError :: Bool
crashOnSQLError = False
