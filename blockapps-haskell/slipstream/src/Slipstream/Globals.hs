{-# LANGUAGE RecordWildCards #-}

module Slipstream.Globals
  ( module Slipstream.Globals
  , module Slipstream.Data.Globals
  ) where


import           BlockApps.Solidity.Value
import           Control.DeepSeq

import           Control.Monad.IO.Class
import           Data.Either.Extra
import qualified Data.Map.Strict             as M
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import           BlockApps.Ethereum
import           UnliftIO.IORef

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

newGlobals :: MonadIO m => Handle -> m (IORef Globals)
newGlobals = newIORef . Globals Set.empty Set.empty Set.empty M.empty

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g

setContractCreated :: MonadIO m => IORef Globals -> Keccak256 -> m ()
setContractCreated globalsIORef codeHash = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdContracts=Set.insert codeHash createdContracts}

isContractCreated :: MonadIO m => IORef Globals -> Keccak256 -> m Bool
isContractCreated globalsIORef codeHash = do
  Globals{..} <- readIORef globalsIORef
  return $ codeHash `Set.member` createdContracts

isHistoric :: MonadIO m => IORef Globals -> Keccak256 -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  return $ name `Set.member` historyList

getHistoryList :: MonadIO m => IORef Globals -> m (Set Keccak256)
getHistoryList = fmap historyList . readIORef

addToHistoryList :: MonadIO m => IORef Globals -> Keccak256 -> m ()
addToHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.insert k historyList}

removeFromHistoryList :: MonadIO m => IORef Globals -> Keccak256 -> m ()
removeFromHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.delete k historyList}

shouldIndex :: MonadIO m => IORef Globals -> Keccak256 -> m Bool
shouldIndex globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  return . not $ name `Set.member` noIndexList

getNoIndexList :: MonadIO m => IORef Globals -> m (Set Keccak256)
getNoIndexList = fmap noIndexList . readIORef

addToNoIndexList :: MonadIO m => IORef Globals -> Keccak256 -> m ()
addToNoIndexList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{noIndexList=Set.insert k noIndexList}

removeFromNoIndexList :: MonadIO m => IORef Globals -> Keccak256 -> m ()
removeFromNoIndexList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{noIndexList=Set.delete k noIndexList}

getContractState :: MonadIO m => IORef Globals -> Address -> Maybe ChainId -> m (Maybe [(Text,Value)])
getContractState globalsIORef address chainId = do
  Globals{..} <- readIORef globalsIORef
  case M.lookup (address, chainId) contractStates of
    jv@Just{} -> do
      recordCacheHit
      return jv
    Nothing -> do
      recordCacheMiss
      eitherToMaybe <$> liftIO (readStorage csHandle address chainId)

setContractState :: MonadIO m => IORef Globals -> Address -> Maybe ChainId -> [(Text,Value)] -> m ()
setContractState gref address chainId values = do
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{contractStates = M.insert (address, chainId) values contractStates}
  asyncWriteToStorage csHandle address chainId values

forceGlobalEval :: (MonadIO m) => IORef Globals -> m ()
forceGlobalEval gref = liftIO $ modifyIORef' gref force
