{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.BatchTransactionResult
  ( API
  , batchTransactionResultClient
  , server
  ) where


import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.Map.Strict     as M
import qualified Database.Esqueleto  as E
import           Database.Persist.Postgresql
import           Servant
import           Servant.Client


import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.Keccak256

import           SQLM



type API = 
  "transactionResult" :> "batch" :> ReqBody '[JSON,PlainText] [Keccak256]
                                 :> Post '[JSON] (M.Map Keccak256 [TransactionResult])

batchTransactionResultClient :: [Keccak256] -> ClientM (M.Map Keccak256 [TransactionResult])
batchTransactionResultClient = client (Proxy @API)

server :: ConnectionPool -> Server API
server connStr = postBatchTransactionResult connStr

postBatchTransactionResult :: ConnectionPool -> [Keccak256] -> Handler (M.Map Keccak256 [TransactionResult])
postBatchTransactionResult pool hashes = do

  when (null hashes) $ throwError err400{ errBody="missing parameter: hashes" }
  
--  hashesR <- parseJsonBody :: HandlerFor App (Result [StrungSHA])
  txrs <- liftIO $ runSQLM pool $ sqlQuery . E.select . E.from $ \txr -> do
    let matchHashes = (txr E.^. TransactionResultTransactionHash) `E.in_` E.valList hashes
    E.where_ matchHashes
    return txr
  let mmUpsert k v m = case M.lookup k m of
                Nothing -> M.insert k [v] m
                Just vs -> M.insert k (v:vs) m
      theFold m v = mmUpsert (transactionResultTransactionHash v) v m
      baseMap = foldl (\m k -> M.insert k [] m) M.empty hashes
      grouped = foldl theFold baseMap (E.entityVal <$> txrs)
  return grouped




