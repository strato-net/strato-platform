{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Components.Marketplace.MyWallet where

import Reflex.Dom
import Backend.Types
import Components.StatCard
import Control.Monad (when)
import qualified Data.Text as T
-- import Frontend.BridgeClient (fetchMarketplaceTransactions)
import Types.State hiding (Transaction(..))

myWalletWidget :: MonadWidget t m => Dynamic t AppState -> m ()
myWalletWidget _ = elClass "div" "wallet-page" $ do
  -- Header & Stats
  elClass "div" "wallet-header" $ do
    el "h2" $ text "My Wallet"
    elClass "div" "wallet-stats" $ do
      statCard "3,117.7067" "Total Rewards"
      statCard "20.5105" "Est. Daily Reward"

    elClass "div" "wallet-actions" $ do
      el "button" $ text "Connect to Payment Provider"
      el "button" $ text "Create Item"

  -- Filter/Search Bar
  -- elClass "div" "wallet-filters" $ do
  --   -- (dropdown :: Int) "All"
  --   (inputElement :: Int) def
  --   _ <- inputElement False def
  --   el "label" $ text "Published"
  --   _ <- checkbox False def
  --   el "label" $ text "Stakeable"
  --   return ()

  -- Table Header
  elClass "table" "wallet-table" $ do
    el "thead" $ el "tr" $ mapM_ (el "th" . text)
      [ "Item", "Category", "Price", "Owned", "Listed", "Actions", "Status" ]

    el "tbody" $ do
      -- Stubbed sample items
      let items = [ WalletItem "/img/usdst.png" "USDST" "Tokens" "N/A" 270 0 "Unpublished" False Nothing
                  , WalletItem "/img/ethst.png" "ETHST" "BridgeableTokens" "N/A" 3 0 "Staked" True (Just 0.0)
                  , WalletItem "/img/cata.png" "CATA" "Tokens" "N/A" 5.1612 0 "Unpublished" False Nothing
                  ]
      mapM_ renderWalletItem items

renderWalletItem :: MonadWidget t m => WalletItem -> m ()
renderWalletItem WalletItem{..} = el "tr" $ do
  el "td" $ do
    elAttr "img" ("src" =: wiIcon <> "class" =: "token-icon") blank
    text (" " <> wiSymbol)
    maybe blank (\amt -> elClass "div" "borrowed" $ text $ "Borrowed: " <> T.pack (show amt)) wiBorrowed

  el "td" $ text wiCategory
  el "td" $ text wiPrice
  el "td" $ text (T.pack $ show wiOwned)
  el "td" $ text (T.pack $ show wiListed)

  elClass "td" "wallet-actions" $ do
    el "button" $ text "Sell"
    el "button" $ text "Transfer"
    when wiStaked $ do
      el "button" $ text "Unstake"
      el "button" $ text "Borrow"
      el "button" $ text "Repay"

    el "button" $ text "Redeem"
    el "button" $ text "More"

  elClass "td" "wallet-status" $ do
    let statusClass = if wiStatus == "Staked" then "badge-success" else "badge-muted"
    elClass "span" ("badge " <> statusClass) $ text wiStatus