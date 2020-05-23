{-# LANGUAGE DataKinds #-}
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

import           Settings
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

getTxLast :: Integer -> Maybe ChainId -> SQLM [RawTransaction']
getTxLast num mChainId =  do
  tx <- fmap (map E.entityVal) . sqlQuery $ E.select $
        E.from $ \(rawTX `E.InnerJoin` btx `E.InnerJoin` b) -> do
          E.on (b E.^. BlockDataRefId E.==. btx E.^. BlockTransactionBlockDataRefId)
          E.on (btx E.^. BlockTransactionTransaction E.==. rawTX E.^. RawTransactionId)
          E.where_ (rawTX E.^. RawTransactionChainId E.==. E.val (fromMaybe 0 $ fmap chainIdToWord256 mChainId))
          E.limit $ max 1 $ min (fromIntegral num :: Int64) appFetchLimit
          E.orderBy [E.desc $ b E.^. BlockDataRefId]
          return rawTX
  return $ map rtToRtPrime' tx

chainIdToWord256 :: ChainId -> Word256
chainIdToWord256 (ChainId x) = x

