
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.TransactionResult
  ( API
  , getTransactionResultClient
  , server
  ) where

import qualified Database.Esqueleto          as E
import           Servant
import           Servant.Client

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Keccak256 hiding (hash)


import           SQLM

type API = 
  "transactionResult" :> Capture "txHash" Keccak256
                      :> Get '[JSON] [TransactionResult]

getTransactionResultClient :: Keccak256 -> ClientM [TransactionResult]
getTransactionResultClient = client (Proxy @API)

server :: ServerT API SQLM
server = getTransactionResult

---------------------------


getTransactionResult :: Keccak256 -> SQLM [TransactionResult]

getTransactionResult txHash = do
  fmap (map E.entityVal) . sqlQuery $ E.select $
    E.from $ \(txr) -> do
    let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
    E.where_ matchHash
    return txr

