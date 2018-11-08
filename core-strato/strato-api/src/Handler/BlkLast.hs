module Handler.BlkLast where

import           Handler.Common
import           Import

import qualified Data.Map as Map
import qualified Database.Esqueleto as E
import qualified Prelude            as P

import Blockchain.Data.Transaction

getBlkLastR :: Integer -> Handler Value
getBlkLastR n = do
  addHeader "Access-Control-Allow-Origin" "*"
  fetchLimit <- myFetchLimit
  blks <- runDB $ E.select $
          E.from $ \a -> do
            E.limit $ P.max 1 $ P.min (fromIntegral n :: Int64) fetchLimit
            E.orderBy [E.desc (a E.^. BlockDataRefNumber)]
            return a


  let blockIds = P.map entityKey blks

  txs <- runDB $ E.select $
         E.from $ \(btx `E.InnerJoin` rawTX) -> do
           E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
           E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList blockIds
           E.orderBy [E.asc (btx E.^. BlockTransactionId)]
           return (btx, rawTX)

  let getTXLists = flip (Map.findWithDefault []) $
                   Map.fromListWith (flip (++)) $ map (fmap (:[])) $ P.map (\(x, y) -> (blockTransactionBlockDataRefId $ entityVal x, rawTX2TX $ entityVal y)) txs::(Key BlockDataRef->[Transaction])

  returnJson $ P.map (uncurry bToBPrime') $ map (\b -> (entityVal b, getTXLists $ entityKey b)) blks

