{-# LANGUAGE OverloadedStrings #-}

module Handler.TransactionResult where

import           Blockchain.SHA
import qualified Database.Esqueleto           as E
import           Handler.Common
import           Handler.Filters              (fromHexText)
import           Import
import qualified Prelude                      as P

getTransactionResultR :: SHA -> HandlerFor App Value
getTransactionResultR txHash      = do
  chainId <- fmap (fmap fromHexText) $ lookupGetParam "chainid"
  addHeader "Access-Control-Allow-Origin" "*"
  rs <- runDB $ E.select $
    E.from $ \(txr) -> do
    let matchHash = (txr E.^. TransactionResultTransactionHash) E.==. (E.val txHash)
        matchChainId = case chainId of
          Nothing -> (E.isNothing $ txr E.^. TransactionResultChainId)
          Just cid -> (txr E.^. TransactionResultChainId) E.==. (E.just $ E.val cid)
    E.where_ (matchHash E.&&. matchChainId)
    return txr
  returnJson $ P.map E.entityVal (rs :: [Entity TransactionResult])



