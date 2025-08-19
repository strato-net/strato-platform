{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.Marketplace.Stake where

import Reflex.Dom
import Control.Monad (void)
import Data.Foldable (traverse_)
import Data.Text (Text)
import Frontend.Components.StatCard

stakeTabWidget :: MonadWidget t m => m ()
stakeTabWidget = elClass "div" "stake-page" $ do
  -- Header
  elClass "h2" "section-title" $ text "Stake"

  -- Rewards Summary
  elClass "div" "stake-reward-summary" $ do
    statCard "🟣 3,117.7067" "Total Rewards"
    statCard "🔴 20.5105" "Est. Daily Reward"

  -- Step Guide
  elClass "div" "staking-guide" $ do
    el "h3" $ text "How to stake RWAs in 4 simple steps"
    elClass "div" "steps" $ do
      mapM_ stepItem [ ("1", "Create an account", "Sign up for a Mercata account.")
                     , ("2", "Buy", "Purchase securely vaulted gold and silver assets.")
                     , ("3", "Stake and Earn", "Stake and earn CATA.")
                     , ("4", "Borrow", "Borrow USDST against your staked assets.")
                     ]

  -- Buy Stakeable Items
  el "h3" $ text "Buy Stakeable Items"
  elClass "div" "stakeable-items" $ do
    void $ simpleList (constDyn stakeableStubData) renderStakeableCard

  -- My Stakeable Items
  el "h3" $ text "My Stakeable Items"
  elClass "table" "stake-table" $ do
    el "thead" $ el "tr" $ mapM_ (el "th" . text)
      ["Item", "Owned", "Quantity Stakeable", "Quantity Staked", "CATA Rewards Earned", "Actions", "Status"]

    el "tbody" $
      dyn_ $ ffor (constDyn myStakeableStubData) $ traverse_ renderMyStakeableRow

stepItem :: MonadWidget t m => (Text, Text, Text) -> m ()
stepItem (stepNum, title, desc) = elClass "div" "step" $ do
  elClass "div" "step-number" $ text stepNum
  elClass "div" "step-title" $ text title
  elClass "div" "step-desc" $ text desc

stakeableStubData :: [Text]
stakeableStubData =
  [ "GOLDST", "Silver - Fractional 100 oz", "ETHST", "WBTST", "USDTST", "USDCST", "PAXGST", "Gold - 1 Gram", "Gold - 1 oz Coin"
  ]

renderStakeableCard :: MonadWidget t m => Dynamic t Text -> m ()
renderStakeableCard dName = do
  elClass "div" "stakeable-card" $ do
    dynText dName
    el "p" $ text "TVL: $63,385.50"

myStakeableStubData :: [Text]
myStakeableStubData = ["ETHST", "Gold - 1 Gram", "Silver - Fractional 100 oz Bars"]

renderMyStakeableRow :: MonadWidget t m => Text -> m ()
renderMyStakeableRow item = do
  el "td" $ text item
  el "td" $ text "3.03"
  el "td" $ text "0"
  el "td" $ text "3.03"
  el "td" $ text "2,278.176736"
  el "td" $ text "⛔ Stake  ✅ Unstake  🔐 Borrow  🔁 Repay"
  el "td" $ text "🟢 Staked"