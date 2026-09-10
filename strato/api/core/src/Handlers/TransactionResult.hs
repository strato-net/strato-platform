{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.TransactionResult
  ( getTransactionResultsFromWriter,
    GetTransactionResult,
    PostBatchTransactionResult,
    API,
    getTransactionResultClient,
    batchTransactionResultClient,
    getTransactionResult,
    postBatchTransactionResult,
    server
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Keccak256 hiding (hash)
import Control.Monad.Change.Alter
import Control.Monad.Composable.SQL
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Database.Esqueleto.Legacy as E
import Database.Persist.Postgresql (SqlPersistT)
import SQLM (ApiError(MissingParameterError))
import Servant
import Servant.Client
import UnliftIO

type GetTransactionResult = "transactionResult" :> Capture "txHash" Keccak256 :> Get '[JSON] [TransactionResult]

type PostBatchTransactionResult = "transactionResult" :> "batch" :> ReqBody '[JSON, PlainText] [Keccak256]
                                          :> Post '[JSON] (M.Map Keccak256 [TransactionResult])

type API = GetTransactionResult :<|> PostBatchTransactionResult

getTransactionResultClient :: Keccak256 -> ClientM [TransactionResult]
batchTransactionResultClient :: [Keccak256] -> ClientM (M.Map Keccak256 [TransactionResult])
getTransactionResultClient :<|> batchTransactionResultClient = client (Proxy @API)

server :: Selectable Keccak256 [TransactionResult] m => ServerT API m
server = getTransactionResult :<|> postBatchTransactionResult

---------------------------

instance {-# OVERLAPPING #-} MonadUnliftIO m => Selectable Keccak256 [TransactionResult] (SQLM m) where
  select _ txHash = fmap (Just . map E.entityVal) . sqlQuery $
    E.select $
      E.from $ \(txr) -> do
        let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
        E.where_ matchHash
        return txr
  selectMany _ [] = throwIO $ MissingParameterError "missing parameter: hashes"
  selectMany _ hashes = groupByHash hashes . map E.entityVal <$> sqlQuery (resultsByHashes hashes)

resultsByHashes :: MonadIO m => [Keccak256] -> SqlPersistT m [E.Entity TransactionResult]
resultsByHashes hashes = E.select . E.from $ \txr -> do
  let matchHashes = (txr E.^. TransactionResultTransactionHash) `E.in_` E.valList hashes
  E.where_ matchHashes
  return txr

groupByHash :: [Keccak256] -> [TransactionResult] -> M.Map Keccak256 [TransactionResult]
groupByHash hashes txrs =
  let mmUpsert k v m = case M.lookup k m of
        Nothing -> M.insert k [v] m
        Just vs -> M.insert k (v : vs) m
      theFold m v = mmUpsert (transactionResultTransactionHash v) v m
      baseMap = foldl (\m k -> M.insert k [] m) M.empty hashes
   in foldl theFold baseMap txrs

-- | The same lookup against the writer, for callers that poll for a result
-- that was committed moments ago: on an API instance reading a replica the
-- reader endpoint can lag by a few hundred milliseconds, which bloc's
-- resolve poll would otherwise spend part of its 10-second budget on.
getTransactionResultsFromWriter :: HasSQLDB m => [Keccak256] -> m (M.Map Keccak256 [TransactionResult])
getTransactionResultsFromWriter [] = pure M.empty
getTransactionResultsFromWriter hashes = groupByHash hashes . map E.entityVal <$> sqlQueryWriter (resultsByHashes hashes)

getTransactionResult :: Selectable Keccak256 [TransactionResult] m => Keccak256 -> m [TransactionResult]
getTransactionResult txHash = fromMaybe [] <$> select (Proxy @[TransactionResult]) txHash

postBatchTransactionResult ::
  Selectable Keccak256 [TransactionResult] m =>
  [Keccak256] ->
  m (M.Map Keccak256 [TransactionResult])
postBatchTransactionResult = selectMany (Proxy @[TransactionResult])