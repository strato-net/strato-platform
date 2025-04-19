{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Components.BitcoinBridge.Bridge where

import Reflex.Dom
import Components.Utils
import Control.Exception
import Control.Monad.IO.Class
import qualified Data.Text as T
import Data.Text (Text)
import Frontend.BridgeClient
import Text.Read (readMaybe)
import Types.State

bridgeTabWidget :: MonadWidget t m => Dynamic t AppState -> m ()
bridgeTabWidget _ = mdo
  el "h2" $ text "Bridge Overview"

  -- Fetch post-build
  postBuild <- getPostBuild

  -- Frontend calls to backend client bindings
  btcBalanceEv <- backendGET fetchWalletBalance $ leftmost [postBuild, () <$ bridgeInEv, () <$ bridgeOutEv]
  multisigEv   <- backendGET fetchBridgeState btcBalanceEv

  btcBalanceDyn <- holdDyn 0.0 btcBalanceEv
  multisigDyn   <- holdDyn 0.0 multisigEv
  -- let btcBalanceDyn = (*0.00000001) . fromInteger . round . (*100000000.0) <$> ((-) <$> btcBalanceDyn' <*> multisigDyn)

  -- UI
  elClass "div" "bridge-cards" $ do
    -- Wallet balance
    dyn_ $ ffor btcBalanceDyn $ \case
      bal -> balanceCard "Bitcoin Wallet Balance" "fa-bitcoin" "BTC" bal

    -- Multisig pool
    dyn_ $ ffor multisigDyn $ \case
      bal -> balanceCard "Total BTC Bridged to Mercata" "fa-lock" "BTC" bal

    -- Multisig pool
    dyn_ $ ffor multisigDyn $ \case
      bal -> balanceCard "BTCST Balance" "fa-lock" "BTCST" bal

  bridgeInEv <- elClass "div" "bridge-form" $ do
    el "h3" $ text "Bridge In Bitcoin"
  
    -- Input: amount
    el "label" $ text "Amount to Bridge:"
    amountInput <- inputElement def
  
    -- Submit button
    submitEv <- button "Send BTC"
  
    -- Perform the RPC
    let payloadEv = tagPromptlyDyn ((,) <$> pure "bridgeIn" <*> value amountInput) submitEv
  
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
    
    pure resultEv

  bridgeOutEv <- elClass "div" "bridge-form" $ do
    el "h3" $ text "Bridge Out to Bitcoin"
  
    -- Input: amount
    el "label" $ text "Amount to Bridge Out:"
    amountInput <- inputElement def
  
    -- Submit
    submitEv <- button "Redeem BTCST"
  
    let inputEv = tagPromptlyDyn ((,) <$> pure "bridgeOut" <*> value amountInput) submitEv
  
    resultEv <- performEventAsync $ ffor inputEv $ \(addrTxt, amtTxt) cb -> liftIO $ do
      let parsedAmt = readMaybe (T.unpack amtTxt) :: Maybe Double
      case parsedAmt of
        Just amt -> do
          res <- try @SomeException $ sendToMultisig addrTxt amt
          cb $ either (Left . show) Right res
        Nothing -> cb $ Left "Invalid amount"
  
    dyn_ =<< holdDyn (text "") (ffor resultEv $ \case
      Left err -> elClass "div" "tx-error" $ text $ "Error: " <> T.pack err
      Right txid -> elClass "div" "tx-success" $ text $ "Bridge Out Request Submitted! ID: " <> txid)
    
    pure resultEv
  
  pure ()

balanceCard :: MonadWidget t m => Text -> Text -> Text -> Double -> m ()
balanceCard title icon cur amt = elClass "div" "bridge-card" $ do
  elClass "div" "card-header" $ do
    elClass "i" ("fa " <> icon) blank
    el "h4" $ text title
  elClass "div" "card-body" $ do
    el "h3" $ text $ T.pack (show amt) <> " " <> cur

loadingCard :: MonadWidget t m => Text -> Text -> m ()
loadingCard title icon = elClass "div" "bridge-card loading" $ do
  elClass "div" "card-header" $ do
    elClass "i" ("fa " <> icon) blank
    el "h4" $ text title
  elClass "div" "card-body" $ text "Loading..."