{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RankNTypes          #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Handler.QueuedTransactions where

import           Handler.Common
import           Import
import qualified Prelude        as P


getQueuedTransactionsR :: HandlerFor App Value
getQueuedTransactionsR  = do
   addHeader "Access-Control-Allow-Origin" "*"
   fetchLimit <- myFetchLimit
   addr <- runDB $ selectList [ RawTransactionBlockNumber ==. (-1) ]
           [ LimitTo (fromIntegral $ fetchLimit :: Int), Desc RawTransactionNonce  ]
          :: HandlerFor App [Entity RawTransaction]
   returnJson $ P.map rtToRtPrime' (P.map entityVal (addr :: [Entity RawTransaction]))

