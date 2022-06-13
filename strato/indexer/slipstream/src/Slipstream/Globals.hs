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
    isHistoric,
    setHistoryTable,
    historyStatusCreated,
    setSolidVMInfo,
    getSolidVMInfo,
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
import qualified Data.HashMap.Strict         as HM
import qualified Data.Map.Strict              as M
--import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import           Data.Text.Encoding          (decodeUtf8)
import           UnliftIO.IORef

import           BlockApps.Logging
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (Xabi(..))
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

newGlobals :: MonadIO m => Handle -> m (IORef Globals)
newGlobals = newIORef . Globals M.empty M.empty Set.empty HM.empty (LRU.newLRU (Just 1024))

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g


xabiToText :: Xabi -> Text
xabiToText = T.replace "\'" "\'\'"
           . decodeUtf8 . BL.toStrict
           . JSON.encode

setSolidVMInfo :: MonadIO m => IORef Globals -> CodePtr -> M.Map Text CodePtr -> m ()
setSolidVMInfo gref (SolidVMCode _ !codeHash) infoMap = do 
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{solidVMInfo=HM.insert codeHash infoMap solidVMInfo}
setSolidVMInfo _ (EVMCode _) _ = error "Cannot use the SolidVMInfo cache for EVM contracts"
setSolidVMInfo _ (CodeAtAccount _ _) _ = error "Cannot use the SolidVMInfo cache for CodeAtAccount contracts"

getSolidVMInfo :: MonadIO m => IORef Globals -> CodePtr -> m (Maybe (M.Map Text CodePtr))
getSolidVMInfo gref (SolidVMCode _ !codeHash) = do
  info <- solidVMInfo <$> readIORef gref
  return $ HM.lookup codeHash info
getSolidVMInfo _ (EVMCode _) = error "Cannot use the SolidVMInfo cache for EVM contracts"
getSolidVMInfo _ (CodeAtAccount _ _) = error "Cannot use the SolidVMInfo cache for CodeAtAccount contracts"

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

isHistoric :: (MonadLogger m, MonadIO m) => IORef Globals -> TableName -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  let h = M.findWithDefault False name historyList
  $logInfoS "isHistoric" $ T.pack $ show name ++ ": " ++ show h
  return h

setHistoryTable :: (MonadIO m, MonadLogger m) => IORef Globals -> TableName -> Bool -> m ()
setHistoryTable g tableName b = do
  globals@Globals{..} <- readIORef g
  if tableName `M.notMember` historyList then do
    $logInfoS "enableHistoryTable" . T.pack $ "Adding and setting history table: " ++ show tableName ++ "to: " ++ show b
    updateGlobals g globals{historyList=M.insert tableName b historyList}
    else do
      $logInfoS "enableHistoryTable" . T.pack $ "Cannot set history for contract after it has been set. " ++ show tableName
      return ()

historyStatusCreated :: (MonadIO m, MonadLogger m)=> IORef Globals -> TableName -> m Bool
historyStatusCreated g tableName = do
  Globals{..} <- readIORef g
  let h = tableName `M.member` historyList
  $logDebugS "historyStatusCreated" $ T.pack $ show h
  return h

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
