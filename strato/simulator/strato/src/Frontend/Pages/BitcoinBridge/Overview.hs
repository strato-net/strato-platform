{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.BitcoinBridge.Overview where

import Common.BridgeClient
import Common.Types  -- for BitcoinBlockSummary, UtxoSummary
import Control.Monad.IO.Class (liftIO)
import Data.Foldable (traverse_)
import qualified Data.Text as T
import Frontend.Components.Card
import Frontend.Components.Table
import Frontend.Types.State
import Frontend.Utils
import Reflex.Dom

overviewTabWidget :: MonadWidget t m => Dynamic t AppState -> m ()
overviewTabWidget _ = do
  postBuild <- getPostBuild
  blockEv  <- backendGET fetchBlockSummaries postBuild
  -- utxoEv   <- backendGET fetchGlobalUtxos    blockEv
  walletEv <- backendGET fetchWalletUtxos    blockEv -- utxoEv
  blockDyn  <- holdDyn [] blockEv
  -- utxoDyn   <- holdDyn [] utxoEv
  walletDyn <- holdDyn [] walletEv

  elClass "div" "container mx-auto py-8 px-4 max-w-7xl" $
    elClass "div" "space-y-8" $ do
      elClass "div" "flex justify-between items-center" $ do
        elClass "h2" "text-3xl font-bold" $ text "Bitcoin Blockchain Explorer"
        elClass "div" "flex items-center space-x-2" $ do
          elAttr "input" ( ("class" =: "container mx-auto py-8 px-4 max-w-7xl")
                           <> ("type" =: "text")
                           <> ("placeholder" =: "Search by block hash, transaction ID, or address")
                         ) blank
          elClass "button" "bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors" $
            text "Search"
      card (constDyn "shadow-md") $ do
        cardHeader (constDyn "bg-slate-100") $
          cardTitle (constDyn "text-xl") $
            text "Latest Blocks"
        cardContent (constDyn "") $ do
          table (constDyn "") $ do
            tableHeader (constDyn "") $
              tableRow (constDyn "") $
                traverse_ (tableHead (constDyn "") . text)
                  ["Height", "Hash", "Transactions", "Timestamp"]
            tableBody (constDyn "") $ dyn_ $ ffor blockDyn . traverse $ \b -> do
              tableRow (constDyn "hover:bg-slate-50") $ do
                formattedTime <- liftIO $ formatUnixTime (blockTime b)
                tableCell (constDyn "font-medium") $
                  text (T.pack $ show $ blockHeight b)
                tableCell (constDyn "font-mono text-sm text-blue-700 hover:underline cursor-pointer") $
                  text (blockHash b)
                tableCell (constDyn "") $
                  text (T.pack $ show $ txCount b)
                tableCell (constDyn "") $
                  text formattedTime
      card (constDyn "shadow-md") $ do
        cardHeader (constDyn "bg-slate-100") $
          cardTitle (constDyn "text-xl") $
            text "Wallet UTXOs"
        cardContent (constDyn "") $ do
          table (constDyn "") $ do
            tableHeader (constDyn "") $
              tableRow (constDyn "") $
                traverse_ (tableHead (constDyn "") . text)
                  ["Address", "Amount (BTC)", "Confirmations"]
            tableBody (constDyn "") $ dyn_ $ ffor walletDyn . traverse $ \u -> do
              tableRow (constDyn "hover:bg-slate-50") $ do
                tableCell (constDyn "font-mono text-sm text-blue-700 hover:underline cursor-pointer") $
                  text (T.take 20 (usAddress u) <> "…")
                tableCell (constDyn "") $
                  text (T.pack $ show (usAmount u))
                tableCell (constDyn "") $
                  text (T.pack $ show (usConfirmations u))