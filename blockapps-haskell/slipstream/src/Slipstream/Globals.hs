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

data Globals =
  Globals {
    createdSources :: Set Text, -- list of source codes that have been compiled and have had their xabis put in the bloc tables
    contractCache :: Map Text ContractAndXabi, -- maps codehash to metadata
    sourcePtrCache :: Map Text SS.SourcePtr, -- maps codehash to (source hash, contract name)
    createdContracts :: Set Text -- list of contracts that have had their tables made
    }

instance Default Globals where
  def =
    Globals {
      createdSources = Set.empty,
      contractCache = Map.empty,
      sourcePtrCache = Map.empty,
      createdContracts = Set.empty
      }

storeCachedContract :: MonadIO m =>
                       IORef Globals -> Text -> ContractAndXabi -> m ()
storeCachedContract globalsIORef sourceCodeHash c = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{contractCache=Map.insert sourceCodeHash c contractCache}


setSourceCreated :: MonadIO m =>
                    IORef Globals -> Text -> m ()
setSourceCreated globalsIORef sourceCodeHash = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{createdSources=Set.insert sourceCodeHash createdSources}

isSourceCreated :: MonadIO m =>
                   IORef Globals -> Text -> m Bool
isSourceCreated globalsIORef sourceCodeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ sourceCodeHash `Set.member` createdSources

getCachedContract :: MonadIO m =>
                     IORef Globals -> Text -> m (Maybe ContractAndXabi)
getCachedContract globalsIORef sourceCodeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ Map.lookup sourceCodeHash contractCache

storeCachedSourcePtr :: MonadIO m =>
                        IORef Globals -> Text -> SS.SourcePtr -> m ()
storeCachedSourcePtr globalsIORef codeHash c = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{sourcePtrCache=Map.insert codeHash c sourcePtrCache}

getCachedSourcePtr :: MonadIO m =>
                      IORef Globals -> Text -> m (Maybe SS.SourcePtr)
getCachedSourcePtr globalsIORef codeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ Map.lookup codeHash sourcePtrCache

setContractCreated :: MonadIO m =>
                      IORef Globals -> Text -> m ()
setContractCreated globalsIORef codeHash = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{createdContracts=Set.insert codeHash createdContracts}

isContractCreated :: MonadIO m =>
                     IORef Globals -> Text -> m Bool
isContractCreated globalsIORef codeHash = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ codeHash `Set.member` createdContracts

data ContractAndXabi =
  ContractAndXabi {
    contract :: Either String Contract,
    xabi :: Text
  } deriving (Show)
