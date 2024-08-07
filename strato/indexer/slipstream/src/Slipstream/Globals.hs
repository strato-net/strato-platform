{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Slipstream.Globals
  ( setTableCreated,
    getTableColumns,
    getCollectionTables,
    isTableCreated,
    setContractState,
    flushPendingWrites,
    getContractState,
    getCCFromGlobals,
    putCCIntoGlobals,
    forceGlobalEval,
    newGlobals,
    getDelegates,
    addDelegate,
    module Slipstream.Data.Globals,
  )
where

import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Control.Monad
import Control.Monad.IO.Class
import qualified Data.Cache.LRU as LRU
import Data.Either.Extra
import qualified Data.Map.Strict as M
import Data.Maybe (isJust, mapMaybe)
import Data.Set as S (insert, member)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import Database.PostgreSQL.Typed (PGConnection, pgQuery)
import Database.PostgreSQL.Typed.Types
import Slipstream.Data.Globals
import Slipstream.GlobalsColdStorage
import Slipstream.Metrics
import Slipstream.QueryFormatHelper
import SolidVM.Model.CodeCollection
import UnliftIO.IORef

{-# INLINE lru #-}
lru :: Ord k => LRU.LRU k v
lru = LRU.newLRU (Just 1024)

newGlobals :: MonadIO m => Handle -> CirrusHandle -> m (IORef Globals)
newGlobals h ch = newIORef $ Globals M.empty lru lru lru h ch

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g

setTableCreated :: MonadIO m => IORef Globals -> TableName -> TableColumns -> m ()
setTableCreated globalsIORef tableName tableColumns = do
  globals@Globals {..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals {createdTables = M.insert tableName tableColumns createdTables}

isTableCreated :: MonadIO m => IORef Globals -> TableName -> m Bool
isTableCreated globalsIORef tableName = do
  Globals {..} <- readIORef globalsIORef
  if tableName `M.member` createdTables
    then return True
    else -- if table not in map, query cirrus to check if it's made
    do
      createdTables' <- scrapeFor globalsIORef tableName
      return $ tableName `M.member` createdTables'

getCollectionTables :: MonadIO m => IORef Globals -> T.Text -> T.Text -> T.Text -> m [T.Text]
getCollectionTables globalsIORef crtr app contract = do
  createdTables <- scrapeFor globalsIORef (CollectionTableName crtr app contract "") -- empty map name to get all map tables
  let collectionTables = M.filterWithKey isCollectionTableName createdTables
        where
          isCollectionTableName :: TableName -> TableColumns -> Bool
          isCollectionTableName (CollectionTableName c a n _) _ =
            crtr == c && app == a && n == contract
          isCollectionTableName _ _ = False
  let collectionNames = map mtCollectionName (M.keys collectionTables)
  return collectionNames

getTableColumns :: MonadIO m => IORef Globals -> TableName -> m (Maybe TableColumns)
getTableColumns globalsIORef tableName = do
  Globals {..} <- readIORef globalsIORef
  let columns = M.lookup tableName createdTables
  if isJust columns
    then return columns
    else do
      createdTables' <- scrapeFor globalsIORef tableName
      return $ M.lookup tableName createdTables'

-- scrape cirrus for a table and return the (potentially updated) createdTables map
scrapeFor :: MonadIO m => IORef Globals -> TableName -> m (M.Map TableName TableColumns)
scrapeFor globalsIORef tableName = do
  Globals {..} <- readIORef globalsIORef
  case cirrusHandle of
    FakeCirrusHandle -> return createdTables
    CirrusHandle {..} -> case tableName of
      CollectionTableName c a contract _ | (c, a, contract) `S.member` queriedMaps -> return createdTables
      CollectionTableName c a contract "" -> do
        let theMapTablesQuery = queryForMatchingTables $ CollectionTableName c a contract ""
        results :: [PGValues] <- liftIO $ pgQuery cirrusConn theMapTablesQuery
        forM_
          results
          ( \case
              [PGTextValue tn] -> do
                cols <- scrapeForCols (wrapSingleQuotes $ decodeUtf8 tn) cirrusConn
                let mapName = last $ T.splitOn "." (decodeUtf8 tn)
                setTableCreated globalsIORef (CollectionTableName c a contract mapName) cols
              _ -> return ()
          )
        g@Globals {createdTables = createdTables'} <- readIORef globalsIORef -- need to read again so have current ver of createdTables
        updateGlobals globalsIORef g {cirrusHandle = cirrusHandle {queriedMaps = (c, a, contract) `S.insert` queriedMaps}}
        return createdTables'
      _ -> do
        cols <- scrapeForCols (tableNameToSingleQuoteText tableName) cirrusConn
        if null cols
          then return createdTables
          else do
            setTableCreated globalsIORef tableName cols
            Globals {createdTables = createdTables'} <- readIORef globalsIORef
            return createdTables'
  where
    scrapeForCols :: MonadIO m => T.Text -> PGConnection -> m TableColumns
    scrapeForCols tn cirrusConn = do
      results :: [PGValues] <- liftIO $ pgQuery cirrusConn $ queryForCols tn
      return $
        mapMaybe
          ( \case
              [PGTextValue colName, PGTextValue colDataType] -> Just $ wrapDoubleQuotes (escapeQuotes $ decodeUtf8 colName) <> " " <> decodeUtf8 colDataType
              _ -> Nothing
          )
          results
    queryForCols t = encodeUtf8 $ "SELECT column_name, data_type FROM information_schema.columns WHERE table_name=" <> t <> ";"
    queryForMatchingTables t =
      let t' = wrapSingleQuotes . wrap1 "%" . escapeUnderscores . escapeQuotes $ tableNameToTextPostgres t
       in encodeUtf8 $ "SELECT table_name from information_schema.tables WHERE table_name like " <> t' <> ";"

getContractState :: MonadIO m => IORef Globals -> Account -> m (Maybe [(T.Text, Value)])
getContractState globalsIORef account = do
  g@Globals {..} <- readIORef globalsIORef
  case LRU.lookup account contractStates of
    (newCache, jv@Just {}) -> do
      recordCacheHit
      writeIORef globalsIORef g {contractStates = newCache}
      return jv
    (newCache, Nothing) -> do
      recordCacheMiss
      mvs <- eitherToMaybe <$> liftIO (readStorage coldStorageHandle account)
      forM_ mvs $ \vs ->
        let newCache' = LRU.insert account vs newCache
         in writeIORef globalsIORef g {contractStates = newCache'}
      return mvs

setContractState :: MonadIO m => IORef Globals -> Account -> [(T.Text, Value)] -> m ()
setContractState gref account values = do
  globals@Globals {..} <- readIORef gref
  updateGlobals gref globals {contractStates = LRU.insert account values contractStates}
  asyncWriteToStorage coldStorageHandle account values

getCCFromGlobals :: MonadIO m => IORef Globals -> Keccak256 -> m (Maybe CodeCollection)
getCCFromGlobals globalsIORef codeHash = do
  g@Globals {..} <- readIORef globalsIORef
  case LRU.lookup codeHash ccMap of
    (newCache, jv@Just {}) -> do
      recordCacheHit
      writeIORef globalsIORef g {ccMap = newCache}
      return jv
    (newCache, Nothing) -> do
      recordCacheMiss
      writeIORef globalsIORef g {ccMap = newCache}
      return Nothing

putCCIntoGlobals :: MonadIO m => IORef Globals -> Keccak256 -> CodeCollection -> m ()
putCCIntoGlobals gref codeHash cc = do
  globals@Globals {..} <- readIORef gref
  updateGlobals gref globals {ccMap = LRU.insert codeHash cc ccMap}

getDelegates :: MonadIO m => IORef Globals -> Account -> m [Account]
getDelegates globalsIORef acct = do
  g@Globals {..} <- readIORef globalsIORef
  case LRU.lookup acct delegateMap of
    (newCache, Just jv) -> do
      recordCacheHit
      writeIORef globalsIORef g {delegateMap = newCache}
      return $ reverse jv
    (newCache, Nothing) -> do
      recordCacheMiss
      writeIORef globalsIORef g {delegateMap = newCache}
      return []

addDelegate :: MonadIO m => IORef Globals -> Account -> Account -> m ()
addDelegate gref acct delegate = do
  g@Globals {..} <- readIORef gref
  case LRU.lookup acct delegateMap of
    (newCache, Just jv) -> do
      recordCacheHit
      writeIORef gref g {delegateMap = LRU.insert acct (delegate : jv) newCache}
    (newCache, Nothing) -> do
      recordCacheMiss
      writeIORef gref g {delegateMap = LRU.insert acct [delegate] newCache}

forceGlobalEval :: (MonadIO m) => IORef Globals -> m ()
forceGlobalEval gref = liftIO $ modifyIORef' gref force

flushPendingWrites :: MonadIO m => IORef Globals -> m ()
flushPendingWrites gref = do
  Globals {..} <- readIORef gref
  syncStorage coldStorageHandle
