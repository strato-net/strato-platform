{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.TxLast (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import           Data.Int
import           Data.Maybe
import qualified Database.Esqueleto as E
import           Database.Persist.Postgresql
import           Servant

import           Blockchain.Data.ChainId
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.DB.SQLDB
import           Blockchain.ExtWord

import           Settings
import           SQLM

type API = 
  "transactions" :> "last"
                 :> Capture "num" Integer
                 :> QueryParam "chainId" ChainId
                 :> Get '[JSON] [RawTransaction']


server :: ConnectionPool -> Server API
server pool = getTxLast pool

---------------------

getTxLast :: ConnectionPool -> Integer -> Maybe ChainId -> Handler [RawTransaction']
getTxLast pool num mChainId =  liftIO $ runSQLM pool $ do
  tx <- sqlQuery $ E.select $
        E.from $ \(rawTX `E.InnerJoin` btx `E.InnerJoin` b) -> do
          E.on (b E.^. BlockDataRefId E.==. btx E.^. BlockTransactionBlockDataRefId)
          E.on (btx E.^. BlockTransactionTransaction E.==. rawTX E.^. RawTransactionId)
          E.where_ (rawTX E.^. RawTransactionChainId E.==. E.val (fromMaybe 0 $ fmap chainIdToWord256 mChainId))
          E.limit $ max 1 $ min (fromIntegral num :: Int64) appFetchLimit
          E.orderBy [E.desc $ b E.^. BlockDataRefId]
          return rawTX
  return $ map (rtToRtPrime' . E.entityVal) tx

chainIdToWord256 :: ChainId -> Word256
chainIdToWord256 (ChainId Nothing) = 0
chainIdToWord256 (ChainId (Just x)) = x

