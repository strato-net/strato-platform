{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Components.BitcoinBridge.Bridge where

import Reflex.Dom
import Backend.Types  -- for BlockSummary, UtxoSummary
import Components.Utils
import Control.Exception
import Control.Monad.IO.Class
import qualified Data.Text as T
import Data.Text (Text)
import Frontend.BridgeClient
import Text.Read (readMaybe)
import Types.State

sendBridgeOut :: Text -> Double -> IO Text
sendBridgeOut addr amt = pure $ "bridge-out-" <> addr <> "-" <> T.pack (show amt)

bridgeTabWidget :: MonadWidget t m => Dynamic t AppState -> m ()
bridgeTabWidget _ = do
  el "h2" $ text "Bridge Overview"

  -- Fetch post-build
  postBuild <- getPostBuild

  -- Frontend calls to backend client bindings
  btcBalanceEv <- backendGET fetchWalletBalance postBuild
  multisigEv   <- backendGET (fetchMultisigUtxos "todo: create real multisig address") btcBalanceEv

  btcBalanceDyn <- holdDyn 0.0 btcBalanceEv
  multisigDyn   <- holdDyn [] multisigEv

  -- UI
  elClass "div" "bridge-cards" $ do
    -- Wallet balance
    dyn_ $ ffor btcBalanceDyn $ \case
      bal -> balanceCard "Bitcoin Wallet" "fa-bitcoin" bal

    -- Multisig pool
    dyn_ $ ffor multisigDyn $ \case
      utxos -> balanceCard "Bridge Pool (BTC)" "fa-lock" (sum $ map amount utxos)

    -- Wrapped balance on Mercata (stub)
    loadingCard "Mercata Wrapped BTC" "fa-coins"

  elClass "div" "bridge-form" $ do
    el "h3" $ text "Bridge In Bitcoin"
  
    -- Input: amount
    el "label" $ text "Amount to Bridge:"
    amountInput <- inputElement def
  
    -- Input: address (optional override, could be from wallet in future)
    el "label" $ text "Destination (Multisig) Address:"
    addressInput <- inputElement def
  
    -- Submit button
    submitEv <- button "Send BTC"
  
    -- Perform the RPC
    let payloadEv = tagPromptlyDyn ((,) <$> value addressInput <*> value amountInput) submitEv
  
    resultEv <- performEventAsync $ ffor payloadEv $ \(addrTxt, amtTxt) cb -> liftIO $ do
      let parsedAmt = readMaybe (T.unpack amtTxt) :: Maybe Double
      case parsedAmt of
        Just amt -> do
          res <- try @SomeException $ sendToMultisig addrTxt amt
          cb $ either (Left . show) Right res
        Nothing -> cb $ Left "Invalid amount"
  
    -- Display result
    dyn_ =<< holdDyn (text "") (ffor resultEv $ \case
      Left err -> elClass "div" "tx-error" $ text $ "Error: " <> T.pack err
      Right txid -> elClass "div" "tx-success" $ text $ "Sent! TXID: " <> txid)

  elClass "div" "bridge-form" $ do
    el "h3" $ text "Bridge Out to Bitcoin"
  
    -- Input: amount
    el "label" $ text "Amount to Bridge Out:"
    amountInput <- inputElement def
  
    -- Input: destination BTC address
    el "label" $ text "Your Bitcoin Address:"
    addressInput <- inputElement def
  
    -- Submit
    submitEv <- button "Redeem Wrapped BTC"
  
    let inputEv = tagPromptlyDyn ((,) <$> value addressInput <*> value amountInput) submitEv
  
    resultEv <- performEventAsync $ ffor inputEv $ \(addrTxt, amtTxt) cb -> liftIO $ do
      let parsedAmt = readMaybe (T.unpack amtTxt) :: Maybe Double
      case parsedAmt of
        Just amt -> do
          res <- try @SomeException $ sendBridgeOut addrTxt amt
          cb $ either (Left . show) Right res
        Nothing -> cb $ Left "Invalid amount"
  
    dyn_ =<< holdDyn (text "") (ffor resultEv $ \case
      Left err -> elClass "div" "tx-error" $ text $ "Error: " <> T.pack err
      Right txid -> elClass "div" "tx-success" $ text $ "Bridge Out Request Submitted! ID: " <> txid)

balanceCard :: MonadWidget t m => Text -> Text -> Double -> m ()
balanceCard title icon amt = elClass "div" "bridge-card" $ do
  elClass "div" "card-header" $ do
    elClass "i" ("fa " <> icon) blank
    el "h4" $ text title
  elClass "div" "card-body" $ do
    el "h3" $ text $ T.pack (show amt) <> " BTC"

loadingCard :: MonadWidget t m => Text -> Text -> m ()
loadingCard title icon = elClass "div" "bridge-card loading" $ do
  elClass "div" "card-header" $ do
    elClass "i" ("fa " <> icon) blank
    el "h4" $ text title
  elClass "div" "card-body" $ text "Loading..."