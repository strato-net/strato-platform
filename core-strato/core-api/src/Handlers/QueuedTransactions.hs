{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.QueuedTransactions (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import           Data.Aeson
import           Database.Persist.Postgresql
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB

import           Settings
import           SQLM

type API = "transaction" :> "last" :> "queued" :> Get '[JSON] Value

server :: ConnectionString -> Server API
server connectionString = getQueuedTransactions connectionString

---------------------

getQueuedTransactions :: ConnectionString -> Handler Value
getQueuedTransactions connectionString =  liftIO $ runSQLM connectionString $ do
   addr <- sqlQuery $ selectList [ RawTransactionBlockNumber ==. (-1) ]
           [ LimitTo (fromIntegral $ appFetchLimit :: Int), Desc RawTransactionNonce  ]
   return . toJSON $ map rtToRtPrime' (map entityVal (addr :: [Entity RawTransaction]))

