{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.TransactionResult
  ( API,
    getTransactionResultClient,
    getTransactionResult,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Keccak256 hiding (hash)
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import Data.Maybe
import qualified Database.Esqueleto.Legacy as E
import Servant
import Servant.Client

type API =
  "transactionResult" :> Capture "txHash" Keccak256
    :> Get '[JSON] [TransactionResult]

getTransactionResultClient :: Keccak256 -> ClientM [TransactionResult]
getTransactionResultClient = client (Proxy @API)

server :: HasSQL m => ServerT API m
server = getTransactionResult

---------------------------

instance HasSQL m => Selectable Keccak256 [TransactionResult] m where
  select _ txHash = fmap (Just . map E.entityVal) . sqlQuery $
    E.select $
      E.from $ \(txr) -> do
        let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
        E.where_ matchHash
        return txr

getTransactionResult :: Selectable Keccak256 [TransactionResult] m => Keccak256 -> m [TransactionResult]
getTransactionResult txHash = fromMaybe [] <$> select (Proxy @[TransactionResult]) txHash
