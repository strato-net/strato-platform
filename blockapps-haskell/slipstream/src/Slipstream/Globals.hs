
module Slipstream.Globals where


import Control.Monad.IO.Class
import Data.Default
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Set (Set)
import qualified Data.Set as Set

import BlockApps.Solidity.Contract
import qualified Slipstream.Data.Action as SS




data Globals =
  Globals {
    createdSources :: Set String, -- list of source codes that have been compiled and have had their xabis put in the bloc tables
    contractCache :: Map String ContractAndXabi, -- maps codehash to metadata
    sourcePtrCache :: Map String SS.SourcePtr, -- maps codehash to (source hash, contract name)
    createdContracts :: Set String -- list of contracts that have had their tables made
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
                       IORef Globals -> String -> ContractAndXabi -> m ()
storeCachedContract globalsIORef sourceCodeHash c = do
  globals <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{contractCache=Map.insert sourceCodeHash c $ contractCache globals}


setSourceCreated :: MonadIO m =>
                    IORef Globals -> String -> m ()
setSourceCreated globalsIORef sourceCodeHash = do
  globals <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{createdSources=Set.insert sourceCodeHash $ createdSources globals}

isSourceCreated :: MonadIO m =>
                   IORef Globals -> String -> m Bool
isSourceCreated globalsIORef sourceCodeHash = do
  globals <- liftIO $ readIORef globalsIORef
  return $ sourceCodeHash `Set.member` createdSources globals

getCachedContract :: MonadIO m =>
                     IORef Globals -> String -> m (Maybe ContractAndXabi)
getCachedContract globalsIORef sourceCodeHash = do
  globals <- liftIO $ readIORef globalsIORef
  return $ Map.lookup sourceCodeHash $ contractCache globals

storeCachedSourcePtr :: MonadIO m =>
                        IORef Globals -> String -> SS.SourcePtr -> m ()
storeCachedSourcePtr globalsIORef codeHash c = do
  globals <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{sourcePtrCache=Map.insert codeHash c $ sourcePtrCache globals}

getCachedSourcePtr :: MonadIO m =>
                      IORef Globals -> String -> m (Maybe SS.SourcePtr)
getCachedSourcePtr globalsIORef codeHash = do
  globals <- liftIO $ readIORef globalsIORef
  return $ Map.lookup codeHash $ sourcePtrCache globals

setContractCreated :: MonadIO m =>
                      IORef Globals -> String -> m ()
setContractCreated globalsIORef codeHash = do
  globals <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{createdContracts=Set.insert codeHash $ createdContracts globals}

isContractCreated :: MonadIO m =>
                     IORef Globals -> String -> m Bool
isContractCreated globalsIORef codeHash = do
  globals <- liftIO $ readIORef globalsIORef
  return $ codeHash `Set.member` createdContracts globals

data ContractAndXabi =
  ContractAndXabi {
    contract :: Either String Contract,
    xabi :: String
  } deriving(Show)
