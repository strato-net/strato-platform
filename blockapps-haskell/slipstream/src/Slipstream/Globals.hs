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
    historyList :: Set Keccak256,
    noIndexList :: Set Keccak256,
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
              IORef Globals -> Keccak256 -> m Bool
isHistoric globalsIORef name = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return $ name `Set.member` historyList

getHistoryList :: MonadIO m =>
                  IORef Globals -> m (Set Keccak256)
getHistoryList = fmap historyList . liftIO . readIORef

addToHistoryList :: MonadIO m =>
                  IORef Globals -> Keccak256 -> m ()
addToHistoryList g k = do
  globals@Globals{..} <- liftIO $ readIORef g
  liftIO $ writeIORef g
    globals{historyList=Set.insert k historyList}

removeFromHistoryList :: MonadIO m =>
                  IORef Globals -> Keccak256 -> m ()
removeFromHistoryList g k = do
  globals@Globals{..} <- liftIO $ readIORef g
  liftIO $ writeIORef g
    globals{historyList=Set.delete k historyList}

shouldIndex :: MonadIO m =>
              IORef Globals -> Keccak256 -> m Bool
shouldIndex globalsIORef name = do
  Globals{..} <- liftIO $ readIORef globalsIORef
  return . not $ name `Set.member` noIndexList

getNoIndexList :: MonadIO m =>
                  IORef Globals -> m (Set Keccak256)
getNoIndexList = fmap noIndexList . liftIO . readIORef

addToNoIndexList :: MonadIO m =>
                  IORef Globals -> Keccak256 -> m ()
addToNoIndexList g k = do
  globals@Globals{..} <- liftIO $ readIORef g
  liftIO $ writeIORef g
    globals{noIndexList=Set.insert k noIndexList}

removeFromNoIndexList :: MonadIO m =>
                  IORef Globals -> Keccak256 -> m ()
removeFromNoIndexList g k = do
  globals@Globals{..} <- liftIO $ readIORef g
  liftIO $ writeIORef g
    globals{noIndexList=Set.delete k noIndexList}

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
