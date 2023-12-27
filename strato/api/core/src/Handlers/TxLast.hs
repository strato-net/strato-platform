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
    getTxLastClient,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ExtendedWord
import Control.Monad.Composable.SQL
import Data.Int
import qualified Database.Esqueleto.Legacy as E
import Servant
import Servant.Client
import Settings

type API =
  "transaction" :> "last"
    :> Capture "num" Integer
    :> QueryParam "chainId" ChainId
    :> Get '[JSON] [RawTransaction']

getTxLastClient :: Integer -> Maybe ChainId -> ClientM [RawTransaction']
getTxLastClient = client (Proxy @API)

server :: HasSQL m => ServerT API m
server = getTxLast

---------------------

class Monad m => GetLastTransactions m where
  getLastTransactions :: Maybe ChainId -> Integer -> m [RawTransaction]

instance (Monad m, HasSQL m) => GetLastTransactions m where
  getLastTransactions mChainId num = do
    fmap (map E.entityVal) . sqlQuery $
      E.select $
        E.from $ \(rawTX `E.InnerJoin` btx `E.InnerJoin` b) -> do
          E.on (b E.^. BlockDataRefId E.==. btx E.^. BlockTransactionBlockDataRefId)
          E.on (btx E.^. BlockTransactionTransaction E.==. rawTX E.^. RawTransactionId)
          E.where_ (rawTX E.^. RawTransactionChainId E.==. E.val (maybe 0 chainIdToWord256 mChainId))
          E.limit $ max 1 $ min (fromIntegral num :: Int64) appFetchLimit
          E.orderBy [E.desc $ b E.^. BlockDataRefId]
          return rawTX
    where
      chainIdToWord256 :: ChainId -> Word256
      chainIdToWord256 (ChainId x) = x

getTxLast :: GetLastTransactions m => Integer -> Maybe ChainId -> m [RawTransaction']
getTxLast num mChainId = map rtToRtPrime' <$> getLastTransactions mChainId num
