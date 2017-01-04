{-# LANGUAGE DataKinds, DeriveAnyClass, DeriveGeneric, TypeOperators #-}

module Blockchain.Servant
  ( API
  , getTxsTo
  , getTxsFrom
  , getTxsAddress
  , getTxsValue
  , getTxsMaxValue
  , getTxsMinValue
  , getTxsGasPrice
  , getTxsMaxGasPrice
  , getTxsMinGasPrice
  , getTxsGasLimit
  , getTxsMaxGasLimit
  , getTxsMinGasLimit
  , getTxsBlockNumber
  , getTxsLast
  , baseUrl
  ) where

import Blockchain.Data.Json
import Control.Monad.Trans.Either
import Data.Proxy
import Servant.API
import Servant.Client

type API =
  "eth" :> "v1.2" :> "transaction" :> QueryParam "from" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "to" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "address" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "value" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "maxvalue" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "minvalue" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "gasprice" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "maxgasprice" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "mingasprice" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "gaslimit" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "maxgaslimit" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "mingaslimit" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> QueryParam "blocknumber" Int :> Get '[JSON] [RawTransaction']
  :<|> "eth" :> "v1.2" :> "transaction" :> "last" :> Capture "last" Int :> Get '[JSON] [RawTransaction']

getTxsFrom :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsTo :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsAddress :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsValue :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsMaxValue :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsMinValue :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsGasPrice :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsMaxGasPrice :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsMinGasPrice :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsGasLimit :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsMaxGasLimit :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsMinGasLimit :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsBlockNumber :: Maybe Int -> EitherT ServantError IO [RawTransaction']
getTxsLast :: Int -> EitherT ServantError IO [RawTransaction']
getTxsFrom
  :<|> getTxsTo
  :<|> getTxsAddress
  :<|> getTxsValue
  :<|> getTxsMaxValue
  :<|> getTxsMinValue
  :<|> getTxsGasPrice
  :<|> getTxsMaxGasPrice
  :<|> getTxsMinGasPrice
  :<|> getTxsGasLimit
  :<|> getTxsMaxGasLimit
  :<|> getTxsMinGasLimit
  :<|> getTxsBlockNumber
  :<|> getTxsLast
  = client (Proxy :: Proxy API) baseUrl

baseUrl :: BaseUrl
baseUrl = BaseUrl Http "strato-dev4.blockapps.net" 80
