{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.QueuedTransactions (
  API,
  server
  ) where

import           Control.Monad.FT
import           Database.Persist.Postgresql hiding (get)
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB

import           Control.Monad.Composable.SQL

import           Settings

type API = "transaction" :> "last" :> "queued" :> Get '[JSON] [RawTransaction']

server :: HasSQL m => ServerT API m
server = getQueuedTransactions

---------------------

instance HasSQL m => Gettable [RawTransaction] m where
  get = fmap (map entityVal) . sqlQuery $
    selectList [ RawTransactionBlockNumber ==. (-1) ]
               [ LimitTo (fromIntegral $ appFetchLimit :: Int)
               , Desc RawTransactionNonce
               ]

getQueuedTransactions :: Gettable [RawTransaction] m => m [RawTransaction']
getQueuedTransactions = map rtToRtPrime' <$> get

