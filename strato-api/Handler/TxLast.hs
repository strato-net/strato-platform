{-# LANGUAGE OverloadedStrings #-}

module Handler.TxLast where

import Import
import Handler.Common
import qualified Database.Esqueleto as E
import qualified Prelude as P

getTxLastR ::  Integer -> Handler Value
getTxLastR  num = do
  addHeader "Access-Control-Allow-Origin" "*"
  tx <- runDB $ E.select $
        E.from $ \(rawTX `E.InnerJoin` btx `E.InnerJoin` b) -> do
          E.on (b E.^. BlockId E.==. btx E.^. BlockTransactionBlockId)
          E.on (btx E.^. BlockTransactionTransaction E.==. rawTX E.^. RawTransactionId)
          E.limit $ P.max 1 $ P.min (fromIntegral num :: Int64) fetchLimit
          E.orderBy [E.desc $ b E.^. BlockId]
          return rawTX
  returnJson $ P.map rtToRtPrime' (P.map entityVal (tx :: [Entity RawTransaction]))
