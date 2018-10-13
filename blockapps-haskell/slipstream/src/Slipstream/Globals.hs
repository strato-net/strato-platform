{-# LANGUAGE RecordWildCards #-}

module Slipstream.Globals where


import           BlockApps.Solidity.Contract
import           BlockApps.Solidity.Value
import           Control.Monad.IO.Class
import           Data.Default
import           Data.IORef
import           Data.Map.Strict             (Map)
import qualified Data.Map.Strict             as M
import           Data.Set                    (Set)
import qualified Data.Set                    as Set
import           Data.Text                   (Text)
import           BlockApps.Ethereum

data Globals =
  Globals {
    createdContracts :: Set Keccak256, -- list of contracts that have had their tables made
    historyList :: Set Text,
    noIndexList :: Set Text,
    contractStates :: Map (Address,Maybe ChainId) [(Text,Value)]
    }

instance Default Globals where
  def =
    Globals {
      createdContracts = Set.empty,
      historyList = Set.empty,
      noIndexList = Set.empty,
      contractStates = M.empty
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

getContractState :: MonadIO m =>
                     IORef Globals -> Address -> Maybe ChainId -> m (Maybe [(Text,Value)])
getContractState globalsIORef address chainId = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ M.lookup (address,chainId) contractStates

setContractState :: MonadIO m =>
                      IORef Globals -> Address -> Maybe ChainId -> [(Text,Value)] -> m ()
setContractState globalsIORef address chainId values = do
  globals@Globals{..} <- liftIO $ readIORef globalsIORef
  liftIO $ writeIORef globalsIORef
    globals{contractStates = M.insert (address,chainId) values contractStates}

data ContractAndXabi =
  ContractAndXabi {
    contract :: Either String Contract,
    xabi :: Text,
    name :: Text,
    contractStored :: Bool,
    contractSchema :: Maybe Text
  } deriving (Show)
