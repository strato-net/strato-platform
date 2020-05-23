{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.QueuedTransactions (
  API,
  server
  ) where

import           Database.Persist.Postgresql
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB

import           Settings
import           SQLM

type API = "transaction" :> "last" :> "queued" :> Get '[JSON] [RawTransaction']

server :: ServerT API SQLM
server = getQueuedTransactions

---------------------

getQueuedTransactions :: SQLM [RawTransaction']
getQueuedTransactions = do
   addr <- fmap (map entityVal) . sqlQuery $ selectList [ RawTransactionBlockNumber ==. (-1) ]
           [ LimitTo (fromIntegral $ appFetchLimit :: Int), Desc RawTransactionNonce  ]
   return $ map rtToRtPrime' addr

