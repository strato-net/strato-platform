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

import           BlockApps.Ethereum
import           BlockApps.Logging
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Xabi     (ContractDetails(..), Xabi(..))
import           Blockchain.Strato.Model.Address

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

newGlobals :: MonadIO m => Handle -> m (IORef Globals)
newGlobals = newIORef . Globals Set.empty Set.empty Set.empty Set.empty Set.empty Set.empty HM.empty (LRU.newLRU (Just 1024))

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g


xabiToText :: Xabi -> Text
xabiToText = T.replace "\'" "\'\'"
           . decodeUtf8 . BL.toStrict
           . JSON.encode

setContractABIs :: MonadIO m => IORef Globals -> CodePtr -> M.Map Text (Int32, ContractDetails) -> m ()
setContractABIs gref (SolidVMCode _ !codeHash) detailsMap = do 
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{contractABIs=HM.insert codeHash detailsMap contractABIs}
setContractABIs _ (EVMCode _) _ = error "cannot use the contractABIs cache for EVM contracts"


getContractABIs :: MonadIO m => IORef Globals -> CodePtr -> m (Maybe (M.Map Text (Int32, ContractDetails)))
getContractABIs gref (SolidVMCode _ !codeHash) = do
  abis <- contractABIs <$> readIORef gref
  return $ HM.lookup codeHash abis
getContractABIs _ (EVMCode _) = error "cannot use the contractABIs cache for EVM contracts"

setContractCreated :: MonadIO m => IORef Globals -> CodePtr -> m ()
setContractCreated globalsIORef codeHash = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdContracts=Set.insert codeHash createdContracts}

isContractCreated :: MonadIO m => IORef Globals -> CodePtr -> m Bool
isContractCreated globalsIORef codeHash = do
  Globals{..} <- readIORef globalsIORef
  return $ codeHash `Set.member` createdContracts

-- Hopefully temporary, just to remove extra calls to bloc in ensureContractInstance
setInstanceCreated :: MonadIO m => IORef Globals -> CodePtr -> m ()
setInstanceCreated globalsIORef codeHash = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdInstances=Set.insert codeHash createdInstances}

isInstanceCreated :: MonadIO m => IORef Globals -> CodePtr -> m Bool
isInstanceCreated globalsIORef codeHash = do
  Globals{..} <- readIORef globalsIORef
  return $ codeHash `Set.member` createdInstances


setEventCreated :: MonadIO m => IORef Globals -> (Text, Text) -> m ()
setEventCreated globalsIORef evTup = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdEvents=Set.insert evTup createdEvents}

isHistoric :: (MonadLogger m, MonadIO m) => IORef Globals -> CodePtr -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  $logInfoS "isHistoric" . T.pack $ "Checking history status of " ++ show name
  $logInfoS "isHistoric" . T.pack $ "History list: " ++ show historyList
  return $ name `Set.member` historyList

isFunctionHistoric :: MonadIO m => IORef Globals -> CodePtr -> m Bool
isFunctionHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  return $ name `Set.member` functionHistoryList

getHistoryList :: MonadIO m => IORef Globals -> m (Set CodePtr)
getHistoryList = fmap historyList . readIORef

getFunctionHistoryList :: MonadIO m => IORef Globals -> m (Set CodePtr)
getFunctionHistoryList = fmap functionHistoryList . readIORef

addToHistoryList :: MonadIO m => IORef Globals -> CodePtr -> m ()
addToHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.insert k historyList}

removeFromHistoryList :: MonadIO m => IORef Globals -> CodePtr -> m ()
removeFromHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.delete k historyList}

shouldIndex :: MonadIO m => IORef Globals -> CodePtr -> m Bool
shouldIndex globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  return . not $ name `Set.member` noIndexList

getNoIndexList :: MonadIO m => IORef Globals -> m (Set CodePtr)
getNoIndexList = fmap noIndexList . readIORef

addToNoIndexList :: MonadIO m => IORef Globals -> CodePtr -> m ()
addToNoIndexList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{noIndexList=Set.insert k noIndexList}

removeFromNoIndexList :: MonadIO m => IORef Globals -> CodePtr -> m ()
removeFromNoIndexList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{noIndexList=Set.delete k noIndexList}

addToFunctionHistoryList :: MonadIO m => IORef Globals -> CodePtr -> m ()
addToFunctionHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{functionHistoryList=Set.insert k functionHistoryList}

removeFromFunctionHistoryList :: MonadIO m => IORef Globals -> CodePtr -> m ()
removeFromFunctionHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{functionHistoryList=Set.delete k functionHistoryList}

getContractState :: MonadIO m => IORef Globals -> Address -> Maybe ChainId -> m (Maybe [(Text,Value)])
getContractState globalsIORef address chainId = do
  g@Globals{..} <- readIORef globalsIORef
  case LRU.lookup (address, chainId) contractStates of
    (newCache, jv@Just{}) -> do
      recordCacheHit
      writeIORef globalsIORef g{contractStates = newCache }
      return jv
    (newCache, Nothing) -> do
      recordCacheMiss
      mvs <- eitherToMaybe <$> liftIO (readStorage csHandle address chainId)
      forM_ mvs $ \vs ->
        let newCache' = LRU.insert (address, chainId) vs newCache
        in writeIORef globalsIORef g{contractStates = newCache' }
      return mvs

setContractState :: MonadIO m => IORef Globals -> Address -> Maybe ChainId -> [(Text,Value)] -> m ()
setContractState gref address chainId values = do
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{contractStates = LRU.insert (address, chainId) values contractStates}
  asyncWriteToStorage csHandle address chainId values

forceGlobalEval :: (MonadIO m) => IORef Globals -> m ()
forceGlobalEval gref = liftIO $ modifyIORef' gref force

flushPendingWrites :: MonadIO m => IORef Globals -> m ()
flushPendingWrites gref = do
  Globals{..} <- readIORef gref
  syncStorage csHandle
