{-# LANGUAGE OverloadedStrings #-}


module Handler.TransactionResult where

import           Blockchain.SHA
import           Blockchain.Data.MiningStatus
import           Handler.Common
import           Handler.Filters (fromHexText)
import           Import
import qualified Prelude        as P

getTransactionResultR :: SHA -> Handler Value
getTransactionResultR txHash      = do
  chainId <- fmap (fmap fromHexText) $ lookupGetParam "chainid"
  addHeader "Access-Control-Allow-Origin" "*"
  acc <- runDB $ selectList [ TransactionResultTransactionHash ==. txHash , TransactionResultMiningStatus ==. Mined , TransactionResultChainId ==. chainId ] [] :: Handler [Entity TransactionResult]
  returnJson $ P.map entityVal acc



