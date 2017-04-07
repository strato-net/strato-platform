{-# LANGUAGE
    DeriveGeneric
  , RecordWildCards
  , TypeApplications
#-}

module BlockApps.Strato.Client
  ( TxsFilterParams (..)
  , txsFilterParams
  , BlocksFilterParams (..)
  , blocksFilterParams
  , AccountsFilterParams (..)
  , accountsFilterParams
  , getTxsFilter
  , getTxsLast
  , postTx
  , postTxList
  , getTxResult
  , getBlocksFilter
  , getBlocksLast
  , getAccountsFilter
  , getDifficulty
  , getTotalTx
  , getStorage
  , postFaucet
  , postFaucets
  , postSolc
  , postExtabi
  , stratoDev
  ) where

import Data.Proxy
import Data.Text (Text)
import GHC.Generics
import Numeric.Natural
import Servant.API
import Servant.Client

import BlockApps.Strato.API
import BlockApps.Strato.Types

data TxsFilterParams = TxsFilterParams
  { qtFrom :: Maybe Address
  , qtTo :: Maybe Address
  , qtAddress :: Maybe Address
  , qtValue :: Maybe Natural
  , qtMaxValue :: Maybe Natural
  , qtMinValue :: Maybe Natural
  , qtGasPrice :: Maybe Natural
  , qtMaxGasPrice :: Maybe Natural
  , qtMinGasPrice :: Maybe Natural
  , qtGasLimit :: Maybe Natural
  , qtMaxGasLimit :: Maybe Natural
  , qtMinGasLimit :: Maybe Natural
  , qtBlockNumber :: Maybe Natural
  } deriving (Eq, Show, Generic)

txsFilterParams :: TxsFilterParams
txsFilterParams = TxsFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing Nothing Nothing Nothing

data BlocksFilterParams = BlocksFilterParams
  { qbNumber :: Maybe Natural
  , qbMinNumber :: Maybe Natural
  , qbMaxNumber :: Maybe Natural
  , qbGasLim :: Maybe Natural
  , qbMinGasLim :: Maybe Natural
  , qbMaxGasLim :: Maybe Natural
  , qbGasUsed :: Maybe Natural
  , qbMinGasUsed :: Maybe Natural
  , qbMaxGasUsed :: Maybe Natural
  , qbDiff :: Maybe Natural
  , qbMinDiff :: Maybe Natural
  , qbMaxDiff :: Maybe Natural
  , qbTxAddress :: Maybe Address
  , qbAddress :: Maybe Address
  , qbCoinbase :: Maybe Address
  , qbHash :: Maybe Keccak256
  } deriving (Eq, Show, Generic)

blocksFilterParams :: BlocksFilterParams
blocksFilterParams = BlocksFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing

data AccountsFilterParams = AccountsFilterParams
  { qaAddress :: Maybe Address
  , qaBalance :: Maybe Natural
  , qaMinBalance :: Maybe Natural
  , qaMaxBalance :: Maybe Natural
  , qaNonce :: Maybe Natural
  , qaMinNonce :: Maybe Natural
  , qaMaxNonce :: Maybe Natural
  } deriving (Eq, Show, Generic)

accountsFilterParams :: AccountsFilterParams
accountsFilterParams = AccountsFilterParams
  Nothing Nothing Nothing Nothing Nothing Nothing Nothing

getTxsFilter :: TxsFilterParams -> ClientM [WithNext Transaction]
getTxsLast :: Natural -> ClientM [WithNext Transaction]
postTx :: PostTransaction -> ClientM Text
postTxList :: [PostTransaction] -> ClientM [Text]
getTxResult :: Text -> ClientM [TransactionResult]
getBlocksFilter :: BlocksFilterParams -> ClientM [WithNext Block]
getBlocksLast :: Natural -> ClientM [WithNext Block]
getAccountsFilter :: AccountsFilterParams -> ClientM [Account]
getDifficulty :: ClientM Difficulty
getTotalTx :: ClientM TxCount
getStorage :: Maybe Address -> ClientM [Storage]
postFaucet :: Address -> ClientM Text
postFaucets :: Addresses -> ClientM Text
postSolc :: Src -> ClientM SolcResponse
postExtabi :: Src -> ClientM ExtabiResponse
getTxsFilter
  :<|> getTxsLast
  :<|> postTx
  :<|> postTxList
  :<|> getTxResult
  :<|> getBlocksFilter
  :<|> getBlocksLast
  :<|> getAccountsFilter
  :<|> getDifficulty
  :<|> getTotalTx
  :<|> getStorage
  :<|> postFaucet
  :<|> postFaucets
  :<|> postSolc
  :<|> postExtabi =
    uncurryTxsFilterParams getTxsFilter'
    :<|> getTxsLast'
    :<|> postTx'
    :<|> postTxList'
    :<|> getTxResult'
    :<|> uncurryBlocksFilterParams getBlocksFilter'
    :<|> getBlocksLast'
    :<|> uncurryAccountsFilterParams getAccountsFilter'
    :<|> getDifficulty'
    :<|> getTotalTx'
    :<|> getStorage'
    :<|> postFaucet'
    :<|> postFaucets'
    :<|> postSolc'
    :<|> postExtabi'
  where
    getTxsFilter'
      :<|> getTxsLast'
      :<|> postTx'
      :<|> postTxList'
      :<|> getTxResult'
      :<|> getBlocksFilter'
      :<|> getBlocksLast'
      :<|> getAccountsFilter'
      :<|> getDifficulty'
      :<|> getTotalTx'
      :<|> getStorage'
      :<|> postFaucet'
      :<|> postFaucets'
      :<|> postSolc'
      :<|> postExtabi' =
        client (Proxy @ API)
    uncurryTxsFilterParams f TxsFilterParams{..} = f
      qtFrom qtTo qtAddress qtValue qtMaxValue qtMinValue qtGasPrice
      qtMaxGasPrice qtMinGasPrice qtGasLimit qtMaxGasLimit qtMinGasLimit
      qtBlockNumber
    uncurryBlocksFilterParams f BlocksFilterParams{..} = f
      qbNumber qbMinNumber qbMaxNumber qbGasLim qbMinGasLim
      qbMaxGasLim qbGasUsed qbMinGasUsed qbMaxGasUsed qbDiff qbMinDiff
      qbMaxDiff qbTxAddress qbAddress qbCoinbase qbHash
    uncurryAccountsFilterParams f AccountsFilterParams{..} = f
      qaAddress qaBalance qaMinBalance qaMaxBalance
      qaNonce qaMinNonce qaMaxNonce

stratoDev :: BaseUrl
stratoDev = BaseUrl Http "tester13.eastus.cloudapp.azure.com" 80 "/strato-api/eth/v1.2"
