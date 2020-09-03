{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Globals
  ( module Slipstream.Globals
  , module Slipstream.Data.Globals
  ) where


import           Control.DeepSeq
import           Control.Lens
import           Control.Monad
import           Control.Monad.Change.Modify
import           Control.Monad.IO.Class
import           Control.Monad.Reader
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
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.CodePtr

import           Slipstream.Data.Globals
import           Slipstream.GlobalsColdStorage
import           Slipstream.Metrics

instance MonadIO m => Modifiable Globals (ReaderT (IORef Globals) m) where
  get _ = liftIO . readIORef =<< ask
  put _ g = ask >>= liftIO . flip writeIORef g

newGlobals :: Handle -> Globals
newGlobals = Globals Set.empty Set.empty Set.empty Set.empty Set.empty Set.empty HM.empty (LRU.newLRU (Just 1024))

updateGlobals :: MonadIO m => IORef Globals -> Globals -> m ()
updateGlobals gref g = do
  recordGlobals g
  writeIORef gref g


xabiToText :: Xabi -> Text
xabiToText = T.replace "\'" "\'\'"
           . decodeUtf8 . BL.toStrict
           . JSON.encode

setContractABIs :: Modifiable Globals m => CodePtr -> M.Map Text (Int32, ContractDetails) -> m ()
setContractABIs (SolidVMCode _ !codeHash) detailsMap = modifyStatefully_ (Proxy @Globals) $
  contractABIs %= HM.insert codeHash detailsMap
setContractABIs (EVMCode _) _ = error "cannot use the contractABIs cache for EVM contracts"


getContractABIs :: Modifiable Globals m => CodePtr -> m (Maybe (M.Map Text (Int32, ContractDetails)))
getContractABIs (SolidVMCode _ !codeHash) = HM.lookup codeHash . _contractABIs <$> get (Proxy @Globals)
getContractABIs (EVMCode _) = error "cannot use the contractABIs cache for EVM contracts"

setContractCreated :: Modifiable Globals m => CodePtr -> m ()
setContractCreated codeHash = modifyStatefully_ (Proxy @Globals) $
  createdContracts %= Set.insert codeHash

isContractCreated :: Modifiable Globals m => CodePtr -> m Bool
isContractCreated codeHash = Set.member codeHash . _createdContracts <$> get (Proxy @Globals)

-- Hopefully temporary, just to remove extra calls to bloc in ensureContractInstance
setInstanceCreated :: Modifiable Globals m => CodePtr -> m ()
setInstanceCreated codeHash = modifyStatefully_ (Proxy @Globals) $
  createdInstances %= Set.insert codeHash

isInstanceCreated :: Modifiable Globals m => CodePtr -> m Bool
isInstanceCreated codeHash = Set.member codeHash . _createdInstances <$> get (Proxy @Globals)

setEventCreated :: Modifiable Globals m => (Text, Text) -> m ()
setEventCreated evTup = modifyStatefully_ (Proxy @Globals) $
  createdEvents %= Set.insert evTup

isHistoric :: (MonadLogger m, Modifiable Globals m) => CodePtr -> m Bool
isHistoric name = do
  Globals{..} <- get (Proxy @Globals)
  $logInfoS "isHistoric" . T.pack $ "Checking history status of " ++ show name
  $logInfoS "isHistoric" . T.pack $ "History list: " ++ show _historyList
  return $ name `Set.member` _historyList

isFunctionHistoric :: Modifiable Globals m => CodePtr -> m Bool
isFunctionHistoric name = Set.member name . _functionHistoryList <$> get (Proxy @Globals)

getHistoryList :: Modifiable Globals m => m (Set CodePtr)
getHistoryList = _historyList <$> get (Proxy @Globals)

getFunctionHistoryList :: Modifiable Globals m => m (Set CodePtr)
getFunctionHistoryList = _functionHistoryList <$> get (Proxy @Globals)

addToHistoryList :: Modifiable Globals m => CodePtr -> m ()
addToHistoryList k = modifyStatefully_ (Proxy @Globals) $
  historyList %= Set.insert k

removeFromHistoryList :: Modifiable Globals m => CodePtr -> m ()
removeFromHistoryList k = modifyStatefully_ (Proxy @Globals) $
  historyList %= Set.delete k

shouldIndex :: Modifiable Globals m => CodePtr -> m Bool
shouldIndex name = not . Set.member name . _noIndexList <$> get (Proxy @Globals)

getNoIndexList :: Modifiable Globals m => m (Set CodePtr)
getNoIndexList = _noIndexList <$> get (Proxy @Globals)

addToNoIndexList :: Modifiable Globals m => CodePtr -> m ()
addToNoIndexList k = modifyStatefully_ (Proxy @Globals) $
  noIndexList %= Set.insert k

removeFromNoIndexList :: Modifiable Globals m => CodePtr -> m ()
removeFromNoIndexList k = modifyStatefully_ (Proxy @Globals) $
  noIndexList %= Set.delete k

addToFunctionHistoryList :: Modifiable Globals m => CodePtr -> m ()
addToFunctionHistoryList k = modifyStatefully_ (Proxy @Globals) $
  functionHistoryList %= Set.insert k

removeFromFunctionHistoryList :: Modifiable Globals m => CodePtr -> m ()
removeFromFunctionHistoryList k = modifyStatefully_ (Proxy @Globals) $
  functionHistoryList %= Set.delete k

getContractState :: (MonadIO m, Modifiable Globals m) => Address -> Maybe ChainId -> m (Maybe [(Text,Value)])
getContractState address chainId = do
  g@Globals{..} <- get (Proxy @Globals)
  case LRU.lookup (address, chainId) _contractStates of
    (newCache, jv@Just{}) -> do
      recordCacheHit
      put (Proxy @Globals) g{_contractStates = newCache }
      return jv
    (newCache, Nothing) -> do
      recordCacheMiss
      mvs <- eitherToMaybe <$> liftIO (readStorage _csHandle address chainId)
      forM_ mvs $ \vs ->
        let newCache' = LRU.insert (address, chainId) vs newCache
        in  put (Proxy @Globals) g{_contractStates = newCache' }
      return mvs

setContractState :: (MonadIO m, Modifiable Globals m) => Address -> Maybe ChainId -> [(Text,Value)] -> m ()
setContractState address chainId values = do
  Globals{..} <- modifyStatefully (Proxy @Globals) $
    contractStates %= LRU.insert (address, chainId) values
  asyncWriteToStorage _csHandle address chainId values

forceGlobalEval :: (MonadIO m) => IORef Globals -> m ()
forceGlobalEval gref = liftIO $ modifyIORef' gref force

flushPendingWrites :: (MonadIO m, Modifiable Globals m) => m ()
flushPendingWrites = do
  Globals{..} <- get (Proxy @Globals)
  syncStorage _csHandle
