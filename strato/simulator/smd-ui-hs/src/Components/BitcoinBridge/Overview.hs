{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Components.BitcoinBridge.Overview where

import Reflex.Dom
import Backend.Types  -- for BlockSummary, UtxoSummary
import Components.Utils
import Control.Monad.IO.Class (liftIO)
import qualified Data.Text as T
import Frontend.BridgeClient
import Types.State

overviewTabWidget :: MonadWidget t m => Dynamic t AppState -> m ()
overviewTabWidget _ = do
  el "h2" $ text "Bitcoin Overview"

  postBuild <- getPostBuild

  blockEv  <- backendGET fetchBlockSummaries postBuild
  utxoEv   <- backendGET fetchGlobalUtxos    blockEv
  walletEv <- backendGET fetchWalletUtxos    utxoEv

  blockDyn  <- holdDyn [] blockEv
  utxoDyn   <- holdDyn [] utxoEv
  walletDyn <- holdDyn [] walletEv

  -- === Section: Latest Blocks
  elClass "div" "overview-section" $ do
    el "h3" $ text "Latest Blocks"
    dyn_ $ latestBlocksTable <$> blockDyn

  -- === Section: Global UTXOs
  elClass "div" "overview-section" $ do
    el "h3" $ text "Global UTXO Pool"
    dyn_ $ utxoTable <$> utxoDyn

  -- === Section: My Wallet UTXOs
  elClass "div" "overview-section" $ do
    el "h3" $ text "My Wallet's UTXOs"
    dyn_ $ utxoTable <$> walletDyn

latestBlocksTable :: MonadWidget t m => [BlockSummary] -> m ()
latestBlocksTable blocks = elClass "table" "table-blocks" $ do
  el "thead" $ el "tr" $ do
    el "th" $ text "Height"
    el "th" $ text "Hash"
    el "th" $ text "Tx Count"
    el "th" $ text "Time"
  el "tbody" $ mapM_ blockRow blocks

blockRow :: MonadWidget t m => BlockSummary -> m ()
blockRow b = el "tr" $ do
  formattedTime <- liftIO $ formatUnixTime (blockTime b)
  el "td" $ text (T.pack $ show $ blockHeight b)
  el "td" $ text (blockHash b)
  el "td" $ text (T.pack $ show $ txCount b)
  el "td" $ text formattedTime

utxoTable :: MonadWidget t m => [UtxoSummary] -> m ()
utxoTable utxos = elClass "table" "table-utxos" $ do
  el "thead" $ el "tr" $ do
    el "th" $ text "Address"
    el "th" $ text "Amount"
    el "th" $ text "Confirmations"
  el "tbody" $ mapM_ utxoRow utxos

utxoRow :: MonadWidget t m => UtxoSummary -> m ()
utxoRow u = el "tr" $ do
  el "td" $ text (T.take 20 (address u) <> "…")
  el "td" $ text (T.pack $ show (amount u))
  el "td" $ text (T.pack $ show (confirmations u))