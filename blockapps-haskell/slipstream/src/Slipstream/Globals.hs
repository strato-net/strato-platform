{-# LANGUAGE RecordWildCards #-}

module Slipstream.Globals where


import           BlockApps.Solidity.Contract
import           Control.Monad.IO.Class
import           Data.Default
import           Data.IORef
import           Data.Map                    (Map)
import qualified Data.Map                    as Map
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import qualified Slipstream.Data.Action      as SS
import           BlockApps.Ethereum

data Globals =
  Globals {
    createdSources :: Set Keccak256, -- list of source codes that have been compiled and have had their xabis put in the bloc tables
    contractCache :: Map Keccak256 ContractAndXabi, -- maps codehash to metadata
    sourcePtrCache :: Map Keccak256 SS.SourcePtr, -- maps codehash to (source hash, contract name)
    createdContracts :: Set Keccak256, -- list of contracts that have had their tables made
    historyList :: Set Text,
    noIndexList :: Set Text
    }

instance Default Globals where
  def =
    Globals {
      createdSources = Set.empty,
      contractCache = Map.empty,
      sourcePtrCache = Map.empty,
      createdContracts = Set.empty,
      historyList = Set.empty,
      noIndexList = Set.empty
      }

getAllContracts :: MonadIO m =>
                   IORef Globals -> m (Map Keccak256 ContractAndXabi)
getAllContracts = fmap contractCache . liftIO . readIORef

storeCachedContract :: MonadIO m =>
                       IORef Globals -> Keccak256 -> ContractAndXabi -> m ()
storeCachedContract globalsIORef sourceCodeHash c = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{contractCache=Map.insert sourceCodeHash c contractCache}

setSourceCreated :: MonadIO m =>
                    IORef Globals -> Keccak256 -> m ()
setSourceCreated globalsIORef sourceCodeHash = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{createdSources=Set.insert sourceCodeHash createdSources}

isSourceCreated :: MonadIO m =>
                   IORef Globals -> Keccak256 -> m Bool
isSourceCreated globalsIORef sourceCodeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ sourceCodeHash `Set.member` createdSources

getCachedContract :: MonadIO m =>
                     IORef Globals -> Keccak256 -> m (Maybe ContractAndXabi)
getCachedContract globalsIORef sourceCodeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ Map.lookup sourceCodeHash contractCache

storeCachedSourcePtr :: MonadIO m =>
                        IORef Globals -> Keccak256 -> SS.SourcePtr -> m ()
storeCachedSourcePtr globalsIORef codeHash c = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{sourcePtrCache=Map.insert codeHash c sourcePtrCache}

getCachedSourcePtr :: MonadIO m =>
                      IORef Globals -> Keccak256 -> m (Maybe SS.SourcePtr)
getCachedSourcePtr globalsIORef codeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ Map.lookup codeHash sourcePtrCache

setContractCreated :: MonadIO m =>
                      IORef Globals -> Keccak256 -> m ()
setContractCreated globalsIORef codeHash = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{createdContracts=Set.insert codeHash createdContracts}

isContractCreated :: MonadIO m =>
                     IORef Globals -> Keccak256 -> m Bool
isContractCreated globalsIORef codeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ codeHash `Set.member` createdContracts

isHistoric :: MonadIO m =>
              IORef Globals -> Text -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ name `Set.member` historyList

getHistoryList :: MonadIO m =>
                  IORef Globals -> m (Set Text)
getHistoryList = fmap historyList . liftIO . readIORef

shouldIndex :: MonadIO m =>
              IORef Globals -> Text -> m Bool
shouldIndex globalsIORef name = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return . not $ name `Set.member` noIndexList

getNoIndexList :: MonadIO m =>
                  IORef Globals -> m (Set Text)
getNoIndexList = fmap noIndexList . liftIO . readIORef

data ContractAndXabi =
  ContractAndXabi {
    contract :: Either String Contract,
    xabi :: Text,
    name :: Text,
    contractStored :: Bool,
    contractSchema :: Maybe Text
  } deriving (Show)
