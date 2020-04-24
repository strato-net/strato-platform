{-# LANGUAGE OverloadedStrings #-}

module Handler.TransactionResult where

import           Blockchain.Strato.Model.SHA
import qualified Database.Esqueleto           as E
import           Handler.Common
import           Import
import qualified Prelude                      as P

getTransactionResultR :: SHA -> HandlerFor App Value
getTransactionResultR txHash      = do
  addHeader "Access-Control-Allow-Origin" "*"
  rs <- runDB $ E.select $
    E.from $ \(txr) -> do
    let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
    E.where_ matchHash
    return txr
  returnJson $ P.map E.entityVal (rs :: [Entity TransactionResult])
