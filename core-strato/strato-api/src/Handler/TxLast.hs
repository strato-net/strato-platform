{-# LANGUAGE OverloadedStrings #-}

module Handler.TxLast where

import qualified Database.Esqueleto as E
import           Handler.Common
import           Handler.Filters
import           Import
import qualified Prelude            as P

getTxLastR ::  Integer -> Handler Value
getTxLastR  num = do
  chainId <- fmap (fmap fromHexText) $ lookupGetParam "chainid"
  addHeader "Access-Control-Allow-Origin" "*"
  fetchLimit <- myFetchLimit
  tx <- runDB $ E.select $
        E.from $ \(rawTX `E.InnerJoin` btx `E.InnerJoin` b) -> do
          E.on (b E.^. BlockDataRefId E.==. btx E.^. BlockTransactionBlockDataRefId)
          E.on (btx E.^. BlockTransactionTransaction E.==. rawTX E.^. RawTransactionId)
          E.where_ (rawTX E.^. RawTransactionChainId E.==. E.val (fromMaybe 0 chainId))
          E.limit $ P.max 1 $ P.min (fromIntegral num :: Int64) fetchLimit
          E.orderBy [E.desc $ b E.^. BlockDataRefId]
          return rawTX
  returnJson $ P.map rtToRtPrime' (P.map entityVal (tx :: [Entity RawTransaction]))
