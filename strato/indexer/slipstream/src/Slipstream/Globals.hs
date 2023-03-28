{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Slipstream.Globals
  (
    setTableCreated,
    getTableColumns,
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
import qualified Data.ByteString.Lazy as BL
import qualified Data.Cache.LRU              as LRU
import           Data.Either.Extra
import qualified Data.Map.Strict              as M
--import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import           Data.Text.Encoding          (decodeUtf8)
import           UnliftIO.IORef

import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (Xabi(..))
import           Blockchain.Strato.Model.Account

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

newGlobals :: MonadIO m => M.Map TableName TableColumns  -> Handle -> m (IORef Globals)
newGlobals createdTabl = newIORef . Globals createdTabl Set.empty (LRU.newLRU (Just 1024))

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g


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
  return $ tableName `M.member` createdTables

getTableColumns :: MonadIO m => IORef Globals -> TableName -> m (Maybe TableColumns)
getTableColumns globalsIORef tableName = do
  Globals{..} <- readIORef globalsIORef
  return $ M.lookup tableName createdTables

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
      mvs <- eitherToMaybe <$> liftIO (readStorage csHandle account)
      forM_ mvs $ \vs ->
        let newCache' = LRU.insert account vs newCache
        in writeIORef globalsIORef g{contractStates = newCache' }
      return mvs

setContractState :: MonadIO m => IORef Globals -> Account -> [(Text,Value)] -> m ()
setContractState gref account values = do
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{contractStates = LRU.insert account values contractStates}
  asyncWriteToStorage csHandle account values

forceGlobalEval :: (MonadIO m) => IORef Globals -> m ()
forceGlobalEval gref = liftIO $ modifyIORef' gref force

flushPendingWrites :: MonadIO m => IORef Globals -> m ()
flushPendingWrites gref = do
  Globals{..} <- readIORef gref
  syncStorage csHandle
