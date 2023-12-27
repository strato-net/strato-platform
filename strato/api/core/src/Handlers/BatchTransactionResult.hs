{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.BatchTransactionResult
  ( API,
    postBatchTransactionResult,
    batchTransactionResultClient,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Keccak256
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import qualified Data.Map.Strict as M
import qualified Database.Esqueleto.Legacy as E
import SQLM
import Servant
import Servant.Client
import UnliftIO

type API =
  "transactionResult" :> "batch" :> ReqBody '[JSON, PlainText] [Keccak256]
    :> Post '[JSON] (M.Map Keccak256 [TransactionResult])

batchTransactionResultClient :: [Keccak256] -> ClientM (M.Map Keccak256 [TransactionResult])
batchTransactionResultClient = client (Proxy @API)

server :: HasSQL m => ServerT API m
server = postBatchTransactionResult

instance HasSQL m => Selectable Keccak256 [TransactionResult] m where
  selectMany _ [] = throwIO $ MissingParameterError "missing parameter: hashes"
  selectMany _ hashes = do
    txrs <- sqlQuery . E.select . E.from $ \txr -> do
      let matchHashes = (txr E.^. TransactionResultTransactionHash) `E.in_` E.valList hashes
      E.where_ matchHashes
      return txr
    let mmUpsert k v m = case M.lookup k m of
          Nothing -> M.insert k [v] m
          Just vs -> M.insert k (v : vs) m
        theFold m v = mmUpsert (transactionResultTransactionHash v) v m
        baseMap = foldl (\m k -> M.insert k [] m) M.empty hashes
        grouped = foldl theFold baseMap (E.entityVal <$> txrs)
    return grouped

postBatchTransactionResult ::
  Selectable Keccak256 [TransactionResult] m =>
  [Keccak256] ->
  m (M.Map Keccak256 [TransactionResult])
postBatchTransactionResult = selectMany (Proxy @[TransactionResult])
