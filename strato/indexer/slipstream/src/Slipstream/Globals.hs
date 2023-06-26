{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE LambdaCase #-}

module Slipstream.Globals
  (
    setTableCreated,
    getTableColumns,
    tableNameToText,
    getMappingTables,
    isTableCreated,
    setContractState,
    xabiToText,
    flushPendingWrites,
    getContractState,
    forceGlobalEval,
    newGlobals,
    module Slipstream.Data.Globals
  ) where


import           Control.DeepSeq

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy         as BL
import qualified Data.Cache.LRU               as LRU
import           Data.Either.Extra
import qualified Data.Map.Strict              as M
import           Data.Maybe                   (mapMaybe, isJust)
import           Data.Text                    (Text)
import qualified Data.Text                    as T
import           Data.Text.Encoding           (decodeUtf8, encodeUtf8)
import           Database.PostgreSQL.Typed    (pgQuery, PGConnection)
import           Database.PostgreSQL.Typed.Types

import           UnliftIO.IORef

import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (Xabi(..))
import           Blockchain.Strato.Model.Account

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

newGlobals :: MonadIO m => Handle -> PGConnection -> m (IORef Globals)
newGlobals h pgc = newIORef $ Globals M.empty (LRU.newLRU (Just 1024)) h pgc

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g

tableSeparator :: Text
tableSeparator = "-"

tableNameToText :: TableName -> Text
tableNameToText (IndexTableName o a c) =
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> tableSeparator
                   else o <> tableSeparator <> a <> tableSeparator
  in prefix <> c
tableNameToText (MappingTableName o a c m ) =
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> tableSeparator <> c <> tableSeparator
                   else o <> tableSeparator <> a <> tableSeparator <> c <> tableSeparator
  in "mapping@" <> prefix <> m
tableNameToText (HistoryTableName o a c) =
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> tableSeparator
                   else o <> tableSeparator <> a <> tableSeparator
  in "history@" <> prefix <> c
tableNameToText (EventTableName o a c e) =
  let prefix = if T.null o
                 then ""
                 else if T.null a
                   then o <> tableSeparator
                   else o <> tableSeparator <> a <> tableSeparator
      contractAndEvent = c <> "." <> e
  in prefix <> contractAndEvent

xabiToText :: Xabi -> Text
xabiToText = T.replace "\'" "\'\'"
           . decodeUtf8 . BL.toStrict
           . JSON.encode

setTableCreated :: MonadIO m => IORef Globals -> TableName -> TableColumns -> m ()
setTableCreated globalsIORef tableName tableColumns = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdTables=M.insert tableName tableColumns createdTables}

isTableCreated :: MonadIO m => IORef Globals -> TableName -> m Bool
isTableCreated globalsIORef tableName = do
  Globals{..} <- readIORef globalsIORef
  if tableName `M.member` createdTables
    then return True
    -- if table not in map, query cirrus to check if it's made
    -- (getTableColumns does query and updates map when appropriate)
    else isJust <$> getTableColumns globalsIORef tableName


-- todo: update this so will scrape for all mapping tables as needed or find better solution
getMappingTables :: MonadIO m => IORef Globals -> Text -> Text -> Text -> m ([Text])
getMappingTables globalsIORef org app contract = do
  Globals{..} <- readIORef globalsIORef
  let mappingTables = M.filterWithKey isMappingTableName (createdTables)
                        where
                          isMappingTableName :: TableName -> TableColumns -> Bool
                          isMappingTableName (MappingTableName o a n _) _ =
                            o == org && a == app && n == contract
                          isMappingTableName _ _ = False
  let mapNames = map mtMappingName (M.keys mappingTables)
  return mapNames

getTableColumns :: MonadIO m => IORef Globals -> TableName -> m (Maybe TableColumns)
getTableColumns globalsIORef tableName = do
  Globals{..} <- readIORef globalsIORef
  let columns = M.lookup tableName createdTables
  if isJust columns
    then return columns
    else do -- not in map, so check in cirrus
      let queryFor t = encodeUtf8 $ "SELECT column_name FROM information_schema.columns WHERE table_name Like \'" <> t <> "\';"
      results :: [PGValues] <- liftIO $ pgQuery cirrusConn $ queryFor $ tableNameToText tableName
      if null results
        then return Nothing
        else do
          let tableColumns = mapMaybe (\case [PGTextValue bs] -> Just $ decodeUtf8 bs; _ -> Nothing) results
          setTableCreated globalsIORef tableName tableColumns
          return $ Just tableColumns

getContractState :: MonadIO m => IORef Globals -> Account -> m (Maybe [(Text,Value)])
getContractState globalsIORef account = do
  g@Globals{..} <- readIORef globalsIORef
  case LRU.lookup account contractStates of
    (newCache, jv@Just{}) -> do
      recordCacheHit
      writeIORef globalsIORef g{contractStates = newCache }
      return jv
    (newCache, Nothing) -> do
      recordCacheMiss
      mvs <- eitherToMaybe <$> liftIO (readStorage coldStorageHandle account)
      forM_ mvs $ \vs ->
        let newCache' = LRU.insert account vs newCache
        in writeIORef globalsIORef g{contractStates = newCache' }
      return mvs

setContractState :: MonadIO m => IORef Globals -> Account -> [(Text,Value)] -> m ()
setContractState gref account values = do
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{contractStates = LRU.insert account values contractStates}
  asyncWriteToStorage coldStorageHandle account values

forceGlobalEval :: (MonadIO m) => IORef Globals -> m ()
forceGlobalEval gref = liftIO $ modifyIORef' gref force

flushPendingWrites :: MonadIO m => IORef Globals -> m ()
flushPendingWrites gref = do
  Globals{..} <- readIORef gref
  syncStorage coldStorageHandle
