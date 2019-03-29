{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE RecordWildCards #-}

module Slipstream.Globals
  ( module Slipstream.Globals
  , module Slipstream.Data.Globals
  ) where


import           BlockApps.Solidity.Value
import           Control.DeepSeq

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.Cache.LRU              as LRU
import           Data.Either.Extra
import qualified Data.HashMap.Strict         as HM
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import           BlockApps.Ethereum
import           UnliftIO.IORef

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

newGlobals :: MonadIO m => Handle -> m (IORef Globals)
newGlobals = newIORef . Globals Set.empty Set.empty Set.empty Set.empty HM.empty (LRU.newLRU (Just 1024))

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g

setSolidVMDetails :: MonadIO m => IORef Globals -> SHA -> Text -> m ()
setSolidVMDetails gref !codeHash !abi = do
  globals@Globals{..} <- readIORef gref
  updateGlobals gref globals{solidVMDetails=HM.insert codeHash abi solidVMDetails}

getSolidVMDetails :: MonadIO m => IORef Globals -> SHA -> m (Maybe Text)
getSolidVMDetails gref codeHash = HM.lookup codeHash . solidVMDetails <$> readIORef gref

setContractCreated :: MonadIO m => IORef Globals -> SHA -> m ()
setContractCreated globalsIORef codeHash = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdContracts=Set.insert codeHash createdContracts}

isContractCreated :: MonadIO m => IORef Globals -> SHA -> m Bool
isContractCreated globalsIORef codeHash = do
  Globals{..} <- readIORef globalsIORef
  return $ codeHash `Set.member` createdContracts

isHistoric :: MonadIO m => IORef Globals -> SHA -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  return $ name `Set.member` historyList

isFunctionHistoric :: MonadIO m => IORef Globals -> SHA -> m Bool
isFunctionHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  return $ name `Set.member` functionHistoryList

getHistoryList :: MonadIO m => IORef Globals -> m (Set SHA)
getHistoryList = fmap historyList . readIORef

getFunctionHistoryList :: MonadIO m => IORef Globals -> m (Set SHA)
getFunctionHistoryList = fmap functionHistoryList . readIORef

addToHistoryList :: MonadIO m => IORef Globals -> SHA -> m ()
addToHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.insert k historyList}

removeFromHistoryList :: MonadIO m => IORef Globals -> SHA -> m ()
removeFromHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{historyList=Set.delete k historyList}

shouldIndex :: MonadIO m => IORef Globals -> SHA -> m Bool
shouldIndex globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
  return . not $ name `Set.member` noIndexList

getNoIndexList :: MonadIO m => IORef Globals -> m (Set SHA)
getNoIndexList = fmap noIndexList . readIORef

addToNoIndexList :: MonadIO m => IORef Globals -> SHA -> m ()
addToNoIndexList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{noIndexList=Set.insert k noIndexList}

removeFromNoIndexList :: MonadIO m => IORef Globals -> SHA -> m ()
removeFromNoIndexList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{noIndexList=Set.delete k noIndexList}

addToFunctionHistoryList :: MonadIO m => IORef Globals -> SHA -> m ()
addToFunctionHistoryList g k = do
  globals@Globals{..} <- readIORef g
  updateGlobals g globals{functionHistoryList=Set.insert k functionHistoryList}

removeFromFunctionHistoryList :: MonadIO m => IORef Globals -> SHA -> m ()
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
