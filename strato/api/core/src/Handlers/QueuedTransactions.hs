{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Handlers.QueuedTransactions
  ( API,
    server,
    getQueuedRawTransactions,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Model.JsonBlock
import Control.Monad.Change.Modify
import Control.Monad.Composable.SQL
import Database.Persist.Postgresql
import Servant
import Settings

type API = "transaction" :> "last" :> "queued" :> Get '[JSON] [RawTransaction']

server :: (Functor m, Accessible [RawTransaction] m) => ServerT API m
server = getQueuedTransactions

---------------------

instance {-# OVERLAPPABLE #-} HasSQL m => Accessible [RawTransaction] m where
  access _ = getQueuedRawTransactions

getQueuedRawTransactions :: HasSQL m => m [RawTransaction]
getQueuedRawTransactions =
    fmap (map entityVal) . sqlQuery $
      selectList
        [RawTransactionBlockNumber ==. (-1)]
        [ LimitTo (fromIntegral $ appFetchLimit :: Int),
          Desc RawTransactionNonce
        ]

getQueuedTransactions :: (Functor m, Accessible [RawTransaction] m) => m [RawTransaction']
getQueuedTransactions = map rtToRtPrime' <$> access (Proxy @[RawTransaction])
