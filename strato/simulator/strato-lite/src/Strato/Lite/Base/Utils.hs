{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}

module Strato.Lite.Base.Utils where

import BlockApps.Solidity.Value as V
import Blockchain.Model.SyncState
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.QueryFormatHelper
import Blockchain.SyncDB
import Conduit
import qualified Control.Monad.Change.Modify as Mod
import Data.Maybe (fromMaybe) -- (catMaybes, fromMaybe)
import qualified Data.Text as T

sqlTypeSQLite :: SqlType -> T.Text
sqlTypeSQLite SqlBool      = "bool"
sqlTypeSQLite SqlDecimal   = "decimal"
sqlTypeSQLite SqlText      = "text"
sqlTypeSQLite SqlJsonb     = "jsonb"
sqlTypeSQLite SqlTimestamp = "text"
sqlTypeSQLite SqlSerial    = ""

slipstreamQuerySQLite :: SlipstreamQuery -> Maybe T.Text
slipstreamQuerySQLite (CreateTable tableName cols pk mTC _) = Just $ T.concat
  [ "CREATE TABLE IF NOT EXISTS "
  , tableNameToDoubleQuoteText tableName
  , " ("
  , csv $ (\(c,t) -> wrapEscapeDouble c <> " " <> sqlTypeSQLite t) <$> cols
  , case pk of
      [] -> ""
      _ -> ",\n  PRIMARY KEY " <> wrapAndEscapeDouble pk
  , case mTC of
      Just (Unique n uc) -> T.concat
        [ ", CONSTRAINT "
        , wrapEscapeDouble n
        , " UNIQUE "
        , uc
        ]
      _ -> ""
  , ");"
  ]
slipstreamQuerySQLite InsertTable{..} = Just $ T.concat
  [ "INSERT "
  , case onConflict of
      Just DoNothing -> "OR IGNORE "
      Just OnConflict{} -> "OR REPLACE "
      _ -> ""
  , "INTO "
  , tableNameToDoubleQuoteText tableName
  , " "
  , wrapAndEscapeDouble $ fst <$> tableColumns
  , "\n  VALUES "
  , csv $ wrapParens . csv . map
      (\((_,t),v) -> fromMaybe "NULL" $ valueToSQLiteText t =<< v)
      . zip tableColumns
      <$> values
  ]
slipstreamQuerySQLite _ = Nothing

valueToSQLiteText :: SqlType -> Value -> Maybe T.Text
valueToSQLiteText t v = case t of
  SqlJsonb -> (\w -> "jsonb(" <> wrapEscapeSingle w <> ")") <$> w'
  _ -> wrapEscapeSingle <$> valueToSQLText' True v
  where v' = valueToSQLText' True v
        w' = (\w -> case v of
            SimpleValue ValueString{} -> wrapEscapeDouble w
            SimpleValue ValueBytes{} -> wrapEscapeDouble w
            SimpleValue ValueAddress{} -> wrapEscapeDouble w
            ValueContract{} -> wrapEscapeDouble w
            ValueArraySentinel _ -> "\"\""
            _ -> w
          ) <$> v'

updateSyncStatus' ::
  ( MonadIO m
  , Mod.Modifiable BestBlock m
  , Mod.Modifiable WorldBestBlock m
  , Mod.Modifiable SyncStatus m
  ) => m ()
updateSyncStatus' = do
  nodeNumber <- bestBlockNumber <$> Mod.get (Mod.Proxy @BestBlock)
  worldNumber <- bestBlockNumber . unWorldBestBlock <$> Mod.get (Mod.Proxy @WorldBestBlock)
  Mod.put (Mod.Proxy @SyncStatus) $ SyncStatus (nodeNumber >= worldNumber)
