{-# LANGUAGE OverloadedStrings #-}


module Handler.TransactionResult where

import           Blockchain.SHA
import           Handler.Common
import           Import
import qualified Prelude        as P

getTransactionResultR :: SHA -> Handler Value
getTransactionResultR txHash      = do
  addHeader "Access-Control-Allow-Origin" "*"
  acc <- runDB $ selectList [ TransactionResultTransactionHash ==. txHash ] [] :: Handler [Entity TransactionResult]
  returnJson $ P.map entityVal acc



