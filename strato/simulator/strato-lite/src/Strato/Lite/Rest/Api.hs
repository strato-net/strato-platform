-- DEBUGGING
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
-- DEBUGGING
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
-- DEBUGGING
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
-- DEBUGGING
{-# LANGUAGE TypeOperators #-}

module Strato.Lite.Rest.Api
  ( ThreadResultMap,
    AddNodeParams (..),
    PostTxParams (..),
    StratoLiteRestAPI,
    stratoLiteRestAPI,
  )
where

import Blockchain.Data.AlternateTransaction
import Blockchain.Strato.Model.ChainMember
import Data.Aeson
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import GHC.Generics
import Servant

type ThreadResultMap = M.Map T.Text (Maybe (Either String ()))

type StratoLiteRestAPI =
  GetNodes
    :<|> GetConnections
    :<|> GetChainInfo
    :<|> GetPeers
    :<|> PostAddNode
    :<|> PostRemoveNode
    :<|> PostAddConnection
    :<|> PostRemoveConnection
    :<|> PostTimeout
    :<|> PostTx

type GetNodes = "nodes" :> Get '[JSON] ThreadResultMap

type GetPeers = "nodes" :> Capture "nodeLabel" T.Text :> "peers" :> Get '[JSON] [T.Text]

type GetConnections = "connections" :> Get '[JSON] ThreadResultMap

type GetChainInfo =
  "chainInfo" :> Capture "nodeLabel" T.Text
    :> Get '[JSON] ThreadResultMap

type PostAddNode =
  "node" :> Capture "nodeLabel" T.Text
    :> "add"
    :> ReqBody '[JSON] AddNodeParams
    :> Post '[JSON] Bool

type PostRemoveNode =
  "node" :> Capture "nodeLabel" T.Text
    :> "remove"
    :> Post '[JSON] Bool

type PostAddConnection =
  "connection" :> Capture "server" T.Text
    :> Capture "client" T.Text
    :> "add"
    :> Post '[JSON] Bool

type PostRemoveConnection =
  "connection" :> Capture "server" T.Text
    :> Capture "client" T.Text
    :> "remove"
    :> Post '[JSON] Bool

type PostTimeout = "timeout" :> ReqBody '[JSON] Int :> Post '[JSON] ()

data AddNodeParams = AddNodeParams
  { _ip :: T.Text,
    _identity :: ChainMemberParsedSet,
    _bootNodes :: [T.Text]
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON)

data PostTxParams = PostTxParams
  { _tx :: UnsignedTransaction,
    _metadata :: M.Map T.Text T.Text
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON)

type PostTx = "node" :> Capture "nodeLabel" T.Text :> "tx" :> ReqBody '[JSON] PostTxParams :> Post '[JSON] ()


stratoLiteRestAPI :: Proxy StratoLiteRestAPI
stratoLiteRestAPI = Proxy
