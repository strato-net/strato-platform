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
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Control.Monad.Change.Modify
import Control.Monad.Composable.SQL
import Database.Persist.Postgresql
import Servant
import Settings

type API = "transaction" :> "last" :> "queued" :> Get '[JSON] [RawTransaction']

server :: HasSQL m => ServerT API m
server = getQueuedTransactions

---------------------

instance HasSQL m => Accessible [RawTransaction] m where
  access _ =
    fmap (map entityVal) . sqlQuery $
      selectList
        [RawTransactionBlockNumber ==. (-1)]
        [ LimitTo (fromIntegral $ appFetchLimit :: Int),
          Desc RawTransactionNonce
        ]

getQueuedTransactions :: (Functor m, Accessible [RawTransaction] m) => m [RawTransaction']
getQueuedTransactions = map rtToRtPrime' <$> access (Proxy @[RawTransaction])
