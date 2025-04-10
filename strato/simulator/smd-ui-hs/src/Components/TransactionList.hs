{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Components.TransactionList where

import Reflex.Dom.Core
import qualified Data.Text as T
import qualified Types.State as TS

-- Configuration for the transaction list
data TransactionListConfig = TransactionListConfig
  { tlcTransactions :: [TS.Transaction]
  , tlcLimit :: Int
  }

-- Transaction list widget
transactionList :: MonadWidget t m => TransactionListConfig -> m ()
transactionList config = do
  elClass "div" "transaction-list" $ do
    -- Header
    elClass "div" "transaction-list-header" $ do
      el "h3" $ text "Recent Transactions"
      elClass "div" "transaction-count" $ do
        text "Showing "
        text $ T.pack $ show $ min (tlcLimit config) (length $ tlcTransactions config)
        text " of "
        text $ T.pack $ show $ length $ tlcTransactions config
        text " transactions"

    -- Transactions
    elClass "div" "transactions" $ do
      mapM_ renderTransaction $ take (tlcLimit config) (tlcTransactions config)

-- Render a single transaction
renderTransaction :: MonadWidget t m => TS.Transaction -> m ()
renderTransaction tx = do
  elClass "div" "transaction" $ do
    -- Transaction hash
    elClass "div" "transaction-hash" $ text (TS.txHash tx)
    
    -- Transaction details
    elClass "div" "transaction-details" $ do
      -- From address
      elClass "div" "transaction-from" $ do
        elClass "span" "label" $ text "From: "
        elClass "span" "address" $ text (TS.txFrom tx)
      
      -- To address
      elClass "div" "transaction-to" $ do
        elClass "span" "label" $ text "To: "
        elClass "span" "address" $ text (TS.txTo tx)
      
      -- Amount
      elClass "div" "transaction-amount" $ do
        elClass "span" "label" $ text "Amount: "
        elClass "span" "amount" $ text $ T.pack $ show (TS.txValue tx)
      
      -- Status
      elClass "div" "transaction-status" $ do
        elClass "span" "label" $ text "Status: "
        elClass "span" ("status " <> statusClass (TS.txStatus tx)) $
          text $ statusText (TS.txStatus tx)

-- Helper function to get status class
statusClass :: TS.TransactionStatus -> T.Text
statusClass status = case status of
  TS.TxPending -> "pending"
  TS.TxSuccess -> "confirmed"
  TS.TxFailed -> "failed"

-- Helper function to get status text
statusText :: TS.TransactionStatus -> T.Text
statusText status = case status of
  TS.TxPending -> "Pending"
  TS.TxSuccess -> "Confirmed"
  TS.TxFailed -> "Failed" 