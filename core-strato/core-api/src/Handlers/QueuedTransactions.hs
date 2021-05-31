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

import           Control.Monad.FT
import           Database.Persist.Postgresql hiding (get)
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB
import           Options

import           SQLM

type API = "transaction" :> "last" :> "queued" :> Get '[JSON] [RawTransaction']

server :: ServerT API SQLM
server = getQueuedTransactions

---------------------

instance Gettable [RawTransaction] SQLM where
  get = fmap (map entityVal) . sqlQuery $
    selectList [ RawTransactionBlockNumber ==. (-1) ]
               [ LimitTo (fromIntegral $ flags_appFetchLimit :: Int)
               , Desc RawTransactionNonce
               ]

getQueuedTransactions :: Gettable [RawTransaction] m => m [RawTransaction']
getQueuedTransactions = map rtToRtPrime' <$> get

