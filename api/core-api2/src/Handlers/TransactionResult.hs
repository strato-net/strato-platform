
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.TransactionResult
  ( API
  , getTransactionResultClient
  , server
  ) where

import           Control.Monad.Change.Alter
import           Data.Maybe
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

instance Selectable Keccak256 [TransactionResult] SQLM where
  select _ txHash = fmap (Just . map E.entityVal) . sqlQuery $ E.select $
    E.from $ \(txr) -> do
    let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
    E.where_ matchHash
    return txr

getTransactionResult :: Selectable Keccak256 [TransactionResult] m => Keccak256 -> m [TransactionResult]
getTransactionResult txHash = fromMaybe [] <$> select (Proxy @[TransactionResult]) txHash

