{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.BlkLast (
  API,
  server
  ) where

import           Control.Monad.IO.Class
import           Data.Int
import qualified Data.Map as Map
import qualified Database.Esqueleto as E
import           Database.Persist.Postgresql
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.Data.Transaction
import           Blockchain.DB.SQLDB

import           Settings
import           SQLM


type API = 
  "block" :> "last"
          :> Capture "num" Integer
          :> Get '[JSON] [Block']


server :: ConnectionString -> Server API
server connectionString = getBlkLast connectionString

---------------------

getBlkLast :: ConnectionString -> Integer -> Handler [Block']
getBlkLast connectionString n =  liftIO $ runSQLM connectionString $ do
  blks <- sqlQuery $ E.select $
          E.from $ \a -> do
            E.limit $ max 1 $ min (fromIntegral n :: Int64) appFetchLimit
            E.orderBy [E.desc (a E.^. BlockDataRefNumber)]
            return a


  let blockIds = map E.entityKey blks

  txs <- sqlQuery $ E.select $
         E.from $ \(btx `E.InnerJoin` rawTX) -> do
           E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
           E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList blockIds
           E.orderBy [E.asc (btx E.^. BlockTransactionId)]
           return (btx, rawTX)

  let getTXLists = flip (Map.findWithDefault []) $
                   Map.fromListWith (flip (++)) $ map (fmap (:[])) $ map (\(x, y) -> (blockTransactionBlockDataRefId $ E.entityVal x, rawTX2TX $ E.entityVal y)) txs::(Key BlockDataRef->[Transaction])

  return $ map (uncurry bToBPrime') $ map (\b -> (E.entityVal b, getTXLists $ E.entityKey b)) blks

