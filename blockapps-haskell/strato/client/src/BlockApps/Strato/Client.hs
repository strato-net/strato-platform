{-# LANGUAGE RecordWildCards  #-}
{-# LANGUAGE TypeApplications #-}

module BlockApps.Strato.Client
  ( TxsFilterParams (..)
  , txsFilterParams
  , BlocksFilterParams (..)
  , blocksFilterParams
  , AccountsFilterParams (..)
  , accountsFilterParams
  , StorageFilterParams (..)
  , storageFilterParams
  , getTxsFilter
  , getTxsLast
  , postTx
  , postTxList
  , getTxResult
  , postTxResultBatch
  , getBlocksFilter
  , getBlocksLast
  , getAccountsFilter
  , getDifficulty
  , getTotalTx
  , getStorage
  , postFaucet
  , postChain
  , getChain
  ) where

import           Data.Proxy
import           GHC.Generics
import           Numeric.Natural
import           Servant.API
import           Servant.Client

import           BlockApps.Strato.API
import           BlockApps.Strato.Types

data TxsFilterParams = TxsFilterParams
  { qtFrom        :: Maybe Address
  , qtTo          :: Maybe Address
  , qtAddress     :: Maybe Address
  , qtValue       :: Maybe Natural
  , qtMaxValue    :: Maybe Natural
  , qtMinValue    :: Maybe Natural
  , qtGasPrice    :: Maybe Natural
  , qtMaxGasPrice :: Maybe Natural
  , qtMinGasPrice :: Maybe Natural
  , qtGasLimit    :: Maybe Natural
  , qtMaxGasLimit :: Maybe Natural
  , qtMinGasLimit :: Maybe Natural
  , qtBlockNumber :: Maybe Natural
  , qtHash        :: Maybe Keccak256
  , qtChainId     :: Maybe ChainId
  } deriving (Eq, Show, Generic)

txsFilterParams :: TxsFilterParams
txsFilterParams = TxsFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing

data BlocksFilterParams = BlocksFilterParams
  { qbNumber     :: Maybe Natural
  , qbMinNumber  :: Maybe Natural
  , qbMaxNumber  :: Maybe Natural
  , qbGasLim     :: Maybe Natural
  , qbMinGasLim  :: Maybe Natural
  , qbMaxGasLim  :: Maybe Natural
  , qbGasUsed    :: Maybe Natural
  , qbMinGasUsed :: Maybe Natural
  , qbMaxGasUsed :: Maybe Natural
  , qbDiff       :: Maybe Natural
  , qbMinDiff    :: Maybe Natural
  , qbMaxDiff    :: Maybe Natural
  , qbTxAddress  :: Maybe Address
  , qbAddress    :: Maybe Address
  , qbCoinbase   :: Maybe Address
  , qbHash       :: Maybe Keccak256
  , qbChainId    :: Maybe ChainId
  } deriving (Eq, Show, Generic)

blocksFilterParams :: BlocksFilterParams
blocksFilterParams = BlocksFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing

data AccountsFilterParams = AccountsFilterParams
  { qaAddress    :: Maybe Address
  , qaBalance    :: Maybe Natural
  , qaMinBalance :: Maybe Natural
  , qaMaxBalance :: Maybe Natural
  , qaNonce      :: Maybe Natural
  , qaMinNonce   :: Maybe Natural
  , qaMaxNonce   :: Maybe Natural
  , qaChainId    :: Maybe ChainId
  } deriving (Eq, Show, Generic)

accountsFilterParams :: AccountsFilterParams
accountsFilterParams = AccountsFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing

data StorageFilterParams = StorageFilterParams
  { qsAddress  :: Maybe Address
  , qsKey      :: Maybe Natural
  , qsMinKey   :: Maybe Natural
  , qsMaxKey   :: Maybe Natural
  , qsValue    :: Maybe Natural
  , qsMinValue :: Maybe Natural
  , qsMaxValue :: Maybe Natural
  , qsChainId  :: Maybe ChainId
  }

storageFilterParams :: StorageFilterParams
storageFilterParams = StorageFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing

getTxsFilter :: TxsFilterParams -> ClientM [WithNext Transaction]
getTxsLast :: Natural -> Maybe ChainId -> ClientM [WithNext Transaction]
postTx :: PostTransaction -> ClientM Keccak256
postTxList :: [PostTransaction] -> ClientM [Keccak256]
getTxResult :: Keccak256 -> Maybe ChainId -> ClientM [TransactionResult]
postTxResultBatch :: Maybe ChainId -> [Keccak256] -> ClientM BatchTransactionResult
getBlocksFilter :: BlocksFilterParams -> ClientM [WithNext Block]
getBlocksLast :: Natural -> Maybe ChainId -> ClientM [WithNext Block]
getAccountsFilter :: AccountsFilterParams -> ClientM [Account]
getDifficulty :: ClientM Difficulty
getTotalTx :: ClientM TxCount
getStorage :: StorageFilterParams -> ClientM [Storage]
postFaucet :: Address -> ClientM [Keccak256]
postChain :: ChainInfo -> ClientM ChainId
getChain :: [ChainId] -> ClientM [ChainIdChainInfo]
getTxsFilter
  :<|> getTxsLast
  :<|> postTx
  :<|> postTxList
  :<|> getTxResult
  :<|> postTxResultBatch
  :<|> getBlocksFilter
  :<|> getBlocksLast
  :<|> getAccountsFilter
  :<|> getDifficulty
  :<|> getTotalTx
  :<|> getStorage
  :<|> postFaucet
  :<|> postChain
  :<|> getChain =
    uncurryTxsFilterParams getTxsFilter'
    :<|> getTxsLast'
    :<|> postTx'
    :<|> postTxList'
    :<|> getTxResult'
    :<|> postTxResultBatch'
    :<|> uncurryBlocksFilterParams getBlocksFilter'
    :<|> getBlocksLast'
    :<|> uncurryAccountsFilterParams getAccountsFilter'
    :<|> getDifficulty'
    :<|> getTotalTx'
    :<|> uncurryStorageFilterParams getStorage'
    :<|> postFaucet'
    :<|> postChain'
    :<|> getChain'
  where
    getTxsFilter'
      :<|> getTxsLast'
      :<|> postTx'
      :<|> postTxList'
      :<|> getTxResult'
      :<|> postTxResultBatch'
      :<|> getBlocksFilter'
      :<|> getBlocksLast'
      :<|> getAccountsFilter'
      :<|> getDifficulty'
      :<|> getTotalTx'
      :<|> getStorage'
      :<|> postFaucet'
      :<|> postChain'
      :<|> getChain' =
        client (Proxy @ API)
    uncurryTxsFilterParams f TxsFilterParams{..} = f
      qtFrom qtTo qtAddress qtValue qtMaxValue qtMinValue qtGasPrice
      qtMaxGasPrice qtMinGasPrice qtGasLimit qtMaxGasLimit qtMinGasLimit
      qtBlockNumber qtHash qtChainId
    uncurryBlocksFilterParams f BlocksFilterParams{..} = f
      qbNumber qbMinNumber qbMaxNumber qbGasLim qbMinGasLim
      qbMaxGasLim qbGasUsed qbMinGasUsed qbMaxGasUsed qbDiff qbMinDiff
      qbMaxDiff qbTxAddress qbAddress qbCoinbase qbHash qbChainId
    uncurryAccountsFilterParams f AccountsFilterParams{..} = f
      qaAddress qaBalance qaMinBalance qaMaxBalance
      qaNonce qaMinNonce qaMaxNonce qaChainId
    uncurryStorageFilterParams f StorageFilterParams{..} = f
      qsAddress qsKey qsMinKey qsMaxKey
      qsValue qsMinValue qsMaxValue qsChainId
