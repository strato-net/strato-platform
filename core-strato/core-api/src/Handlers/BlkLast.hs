{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.BlkLast
  ( API
  , getBlkLastClient
  , server
  ) where

import           Control.Arrow                ((&&&), (***))
import           Data.Int
import qualified Data.Map as Map
import qualified Database.Esqueleto as E
import           Servant
import           Servant.Client

import           Blockchain.Data.Block
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

getBlkLastClient :: Integer -> ClientM [Block']
getBlkLastClient = client (Proxy @API)

server :: ServerT API SQLM
server = getBlkLast

---------------------

class Monad m => GetLastBlocks m where
  getLastBlocks :: Integer -> m [Block]

instance GetLastBlocks SQLM where
  getLastBlocks n = do
    blks <- fmap (map (E.entityKey &&& E.entityVal)) . sqlQuery $ E.select $
        E.from $ \a -> do
          E.limit $ max 1 $ min (fromIntegral n :: Int64) appFetchLimit
          E.orderBy [E.desc (a E.^. BlockDataRefNumber)]
          return a

    let blockIds = map fst blks

    txs <- fmap (map (E.entityVal *** E.entityVal)) . sqlQuery $ E.select $
          E.from $ \(btx `E.InnerJoin` rawTX) -> do
            E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
            E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList blockIds
            E.orderBy [E.asc (btx E.^. BlockTransactionId)]
            return (btx, rawTX)

    let getTXLists = flip (Map.findWithDefault []) $
          Map.fromListWith (flip (++)) $ map (blockTransactionBlockDataRefId *** ((:[]) . rawTX2TX)) txs

    return $ map (uncurry blockDataRefToBlock) $ map (\(k,v) -> (v, getTXLists k)) blks

getBlkLast :: GetLastBlocks m => Integer -> m [Block']
getBlkLast n = do
  blks <- getLastBlocks n
  pure $ flip Block' "" <$> blks

