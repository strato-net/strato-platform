{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.TxLast
  ( API
  , getTxLastClient
  , server
  ) where

import           Data.Int
import           Data.Maybe
import qualified Database.Esqueleto as E
import           Servant
import           Servant.Client

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.ChainId
import           Options

import           SQLM

type API = 
  "transaction" :> "last"
                :> Capture "num" Integer
                :> QueryParam "chainId" ChainId
                :> Get '[JSON] [RawTransaction']

getTxLastClient :: Integer -> Maybe ChainId -> ClientM [RawTransaction']
getTxLastClient = client (Proxy @API)

server :: ServerT API SQLM
server = getTxLast

---------------------

class Monad m => GetLastTransactions m where
  getLastTransactions :: Maybe ChainId -> Integer -> m [RawTransaction]

instance GetLastTransactions SQLM where
  getLastTransactions mChainId num = do
    fmap (map E.entityVal) . sqlQuery $ E.select $
      E.from $ \(rawTX `E.InnerJoin` btx `E.InnerJoin` b) -> do
        E.on (b E.^. BlockDataRefId E.==. btx E.^. BlockTransactionBlockDataRefId)
        E.on (btx E.^. BlockTransactionTransaction E.==. rawTX E.^. RawTransactionId)
        E.where_ (rawTX E.^. RawTransactionChainId E.==. E.val (fromMaybe 0 $ fmap chainIdToWord256 mChainId))
        E.limit $ max 1 $ min (fromIntegral num :: Int64) $ fromIntegral flags_appFetchLimit
        E.orderBy [E.desc $ b E.^. BlockDataRefId]
        return rawTX
    where chainIdToWord256 :: ChainId -> Word256
          chainIdToWord256 (ChainId x) = x

getTxLast :: GetLastTransactions m => Integer -> Maybe ChainId -> m [RawTransaction']
getTxLast num mChainId = map rtToRtPrime' <$> getLastTransactions mChainId num
