{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Slipstream.Globals
  ( module Slipstream.Globals
  , module Slipstream.Data.Globals
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
import           Data.Int                    (Int32)
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import           Data.Text.Encoding          (decodeUtf8)
import           UnliftIO.IORef

import           BlockApps.Logging
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (ContractDetails(..), Xabi(..))
import           Blockchain.Strato.Model.Account

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

newGlobals :: MonadIO m => Handle -> m (IORef Globals)
newGlobals = newIORef . Globals M.empty Set.empty Set.empty HM.empty (LRU.newLRU (Just 1024))

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g


xabiToText :: Xabi -> Text
xabiToText = T.replace "\'" "\'\'"
           . decodeUtf8 . BL.toStrict
           . JSON.encode

setContractABIs :: MonadIO m => IORef Globals -> CodePtr -> M.Map Text (Int32, ContractDetails) -> m ()
setContractABIs gref (SolidVMCode _ _ !codeHash) detailsMap = do 
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{contractABIs=HM.insert codeHash detailsMap contractABIs}
setContractABIs _ (EVMCode _) _ = error "cannot use the contractABIs cache for EVM contracts"
setContractABIs _ (CodeAtAccount _ _) _ = error "cannot use the contractABIs cache for CodeAtAccount contracts"


getContractABIs :: MonadIO m => IORef Globals -> CodePtr -> m (Maybe (M.Map Text (Int32, ContractDetails)))
getContractABIs gref (SolidVMCode _ _ !codeHash) = do
  abis <- contractABIs <$> readIORef gref
  return $ HM.lookup codeHash abis
getContractABIs _ (EVMCode _) = error "cannot use the contractABIs cache for EVM contracts"
getContractABIs _ (CodeAtAccount _ _) = error "cannot use the contractABIs cache for CodeAtAccount contracts"

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

-- this "instance" is actually whether there is row in the blo22 contractsSourceTable for a given codeHash
-- caching the record of its existence in that table prevents an extra call to bloc to make sure it's there
setInstanceCreated :: MonadIO m => IORef Globals -> CodePtr -> m ()
setInstanceCreated globalsIORef codeHash = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdInstances=Set.insert codeHash createdInstances}

isInstanceCreated :: MonadIO m => IORef Globals -> CodePtr -> m Bool
isInstanceCreated globalsIORef codeHash = do
  Globals{..} <- readIORef globalsIORef
  return $ codeHash `Set.member` createdInstances


isHistoric :: (MonadLogger m, MonadIO m) => IORef Globals -> TableName -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  $logInfoS "isHistoric" . T.pack $ "Checking history status of " ++ show name
  $logInfoS "isHistoric" . T.pack $ "History list: " ++ show historyList
  return $ name `Set.member` historyList

getHistoryList :: MonadIO m => IORef Globals -> m (Set TableName)
getHistoryList = fmap historyList . readIORef

addToHistoryList :: MonadIO m => IORef Globals -> TableName -> m ()
addToHistoryList g tableName = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.insert tableName historyList}

removeFromHistoryList :: MonadIO m => IORef Globals -> TableName -> m ()
removeFromHistoryList g tableName = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.delete tableName historyList}


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
