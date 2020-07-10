{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.QueuedTransactions (
  API,
  server
  ) where

import           Control.Monad.Change.Modify
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

instance Accessible [RawTransaction] SQLM where
  access _ = fmap (map entityVal) . sqlQuery $
    selectList [ RawTransactionBlockNumber ==. (-1) ]
               [ LimitTo (fromIntegral $ appFetchLimit :: Int)
               , Desc RawTransactionNonce
               ]

getQueuedTransactions :: (Functor m, Accessible [RawTransaction] m) => m [RawTransaction']
getQueuedTransactions = map rtToRtPrime' <$> access (Proxy @[RawTransaction])

