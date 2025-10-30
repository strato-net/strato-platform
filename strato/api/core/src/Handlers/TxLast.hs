{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS_GHC -fno-warn-redundant-constraints #-}

module Handlers.TxLast
  ( API,
    GetLastTransactions(..),
    getTxLastClient,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Model.JsonBlock
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Class
import Data.Int
import qualified Database.Esqueleto.Legacy as E
import Servant
import Servant.Client
import Settings
import UnliftIO

type API =
  "transaction" :> "last"
    :> Capture "num" Integer
    :> Get '[JSON] [RawTransaction']

getTxLastClient :: Integer -> ClientM [RawTransaction']
getTxLastClient = client (Proxy @API)

server :: GetLastTransactions m => ServerT API m
server = getTxLast

---------------------

class Monad m => GetLastTransactions m where
  getLastTransactions :: Integer -> m [RawTransaction]

instance (Monad m, GetLastTransactions m, MonadTrans t) => GetLastTransactions (t m) where
  getLastTransactions = lift . getLastTransactions

instance {-# OVERLAPPING #-} MonadUnliftIO m => GetLastTransactions (SQLM m) where
  getLastTransactions num = do
    fmap (map E.entityVal) . sqlQuery $
      E.select $
        E.from $ \(rawTX `E.InnerJoin` btx `E.InnerJoin` b) -> do
          E.on (b E.^. BlockDataRefId E.==. btx E.^. BlockTransactionBlockDataRefId)
          E.on (btx E.^. BlockTransactionTransaction E.==. rawTX E.^. RawTransactionId)
          E.limit $ max 1 $ min (fromIntegral num :: Int64) appFetchLimit
          E.orderBy [E.desc $ b E.^. BlockDataRefId]
          return rawTX

getTxLast :: GetLastTransactions m => Integer -> m [RawTransaction']
getTxLast num = map rtToRtPrime' <$> getLastTransactions num
