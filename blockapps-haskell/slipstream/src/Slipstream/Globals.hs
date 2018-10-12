{-# LANGUAGE RecordWildCards #-}

module Slipstream.Globals where


import           BlockApps.Solidity.Contract
import           Control.Monad.IO.Class
import           Data.Default
import           Data.IORef
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import           BlockApps.Ethereum

data Globals =
  Globals {
    createdContracts :: Set Keccak256, -- list of contracts that have had their tables made
    historyList :: Set Text,
    noIndexList :: Set Text
    }

instance Default Globals where
  def =
    Globals {
      createdContracts = Set.empty,
      historyList = Set.empty,
      noIndexList = Set.empty
      }

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
