
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

server :: ConnectionPool -> Server API
server pool = getTransactionResult pool

---------------------------


getTransactionResult :: ConnectionPool -> SHA -> Handler [TransactionResult]

getTransactionResult pool txHash = liftIO $ runSQLM pool $ do
  rs <- sqlQuery $ E.select $
    E.from $ \(txr) -> do
    let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
    E.where_ matchHash
    return txr
  return $ map E.entityVal rs

