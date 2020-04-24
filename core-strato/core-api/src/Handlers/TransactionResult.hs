
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.TransactionResult (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import qualified Database.Esqueleto          as E
import           Database.Persist.Postgresql
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA hiding (hash)


import           SQLM

type API = 
  "account" :> Capture "txHash" SHA
            :> Get '[JSON] [TransactionResult]

server :: ConnectionString -> Server API
server connStr = getTransactionResult connStr

---------------------------


getTransactionResult :: ConnectionString -> SHA -> Handler [TransactionResult]

getTransactionResult connectionString txHash = liftIO $ runSQLM connectionString $ do
  rs <- sqlQuery $ E.select $
    E.from $ \(txr) -> do
    let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
    E.where_ matchHash
    return txr
  return $ map E.entityVal rs

