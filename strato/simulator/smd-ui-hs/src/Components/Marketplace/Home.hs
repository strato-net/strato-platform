{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Components.Marketplace.Home where

import Reflex.Dom
import Components.StatCard
import Control.Monad (when)
import Data.Text (Text)
import Types.State

data StakeableItem = StakeableItem
  { itemName :: Text
  , itemIcon :: Text
  , itemPrice :: Text
  , itemPriceUsd :: Text
  , itemTvl :: Text
  , itemBridgeable :: Bool
  }

placeholderItems :: [StakeableItem]
placeholderItems =
  [ StakeableItem "GOLDST" "/img/goldst.png" "$278.03" "$278.03 USDST" "$64,380.29" False
  , StakeableItem "ETHST" "/img/ethst.png" "$161.91" "$161.91 USDST" "$105,913.79" True
  ]

marketplaceHome :: MonadWidget t m => Dynamic t AppState -> m ()
marketplaceHome _ = elClass "div" "marketplace" $ do
  -- Banner
  elClass "div" "banner" $ do
    el "h1" $ text "RWA + DeFi = Unbanked, On-Chain Living"
    el "p" $ text "Stake Silver, Gold, ETH, Wrapped Bitcoin, and more to earn CATA."
    el "button" $ text "Stake now"
    elClass "div" "tvl-rewards" $ do
      statCard "$340,644" "Total Value Locked (TVL)"
      statCard "66,813" "Rewards Issued (CATA)"

  -- Stakeable Items
  el "h2" $ text "Stakeable Items"
  elClass "div" "stakeable-grid" $ do
    -- Placeholder items
    mapM_ renderItem placeholderItems

renderItem :: MonadWidget t m => StakeableItem -> m ()
renderItem item = elClass "div" "asset-card" $ do
  elAttr "img" ("src" =: itemIcon item) blank
  el "h3" $ text (itemName item)
  el "p" $ text $ itemPrice item <> " (" <> itemPriceUsd item <> ")"
  el "p" $ text $ "TVL: " <> itemTvl item
  el "label" $ text "Quantity:"
  _ <- inputElement def
  elClass "div" "buttons" $ do
    el "button" $ text "Buy Now"
    when (itemBridgeable item) $ el "button" $ text "Bridge"