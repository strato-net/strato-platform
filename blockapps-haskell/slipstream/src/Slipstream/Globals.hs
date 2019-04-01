{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TupleSections #-}

module Slipstream.Globals
  ( module Slipstream.Globals
  , module Slipstream.Data.Globals
  ) where


import           BlockApps.Solidity.Value
import           Control.DeepSeq

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy as BL
import qualified Data.Cache.LRU              as LRU
import           Data.Either.Extra
import qualified Data.HashMap.Strict         as HM
import           Data.Int
import qualified Data.Map                    as M
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import qualified Data.Text                   as T
import           Data.Text.Encoding          (decodeUtf8)
import           BlockApps.Ethereum
import           BlockApps.Solidity.Xabi     (ContractDetails(..), Xabi(..))
import           System.Log.Logger
import           Text.Format
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


xabiToText :: Xabi -> Text
xabiToText = T.replace "\'" "\'\'"
           . decodeUtf8 . BL.toStrict
           . JSON.encode

setSolidVMABIs :: MonadIO m => IORef Globals -> CodePtr -> M.Map Text (Int32, ContractDetails) -> m ()
setSolidVMABIs gref (SolidVMCode _ !codeHash) detailsMap = do
  liftIO $ infoM "setSolidVMABIs" $ format codeHash
  globals@Globals{..} <- readIORef gref
  let !abis = force $ M.map (xabiToText . contractdetailsXabi . snd) detailsMap
  updateGlobals gref globals{solidVMABIs=HM.insert codeHash abis solidVMABIs}
setSolidVMABIs _ EVMCode{} _ = error "internal error: setSolidVMDetails for EVMCode"

getSolidVMABIs :: MonadIO m => IORef Globals -> CodePtr -> m (Maybe (Text, Text))
getSolidVMABIs gref (SolidVMCode name codeHash) = do
  abis <- solidVMABIs <$> readIORef gref
  liftIO $ infoM "getSolidVMABIs/abikeys" . format $ HM.keys abis
  case HM.lookup codeHash abis of
    Nothing -> return Nothing
    Just details -> do
      liftIO $ infoM "getSolidVMABIs/named at" $ show $ M.keys details
      return $ (T.pack name,) <$> M.lookup (T.pack name) details
  -- return $ M.lookup (T.pack name) =<< HM.lookup codeHash abis
getSolidVMABIs _ EVMCode{} = error "internal error: getSolidVMDetails for EVMCode"

setContractCreated :: MonadIO m => IORef Globals -> CodePtr -> m ()
setContractCreated globalsIORef codeHash = do
  globals@Globals{..} <- readIORef globalsIORef
  updateGlobals globalsIORef globals{createdContracts=Set.insert codeHash createdContracts}

isContractCreated :: MonadIO m => IORef Globals -> CodePtr -> m Bool
isContractCreated globalsIORef codeHash = do
  Globals{..} <- readIORef globalsIORef
  return $ codeHash `Set.member` createdContracts

isHistoric :: MonadIO m => IORef Globals -> CodePtr -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- readIORef globalsIORef
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
