{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.Marketplace.Home where

import Control.Monad (when)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import Frontend.Components.StatCard
import Frontend.Types.State
import Reflex.Dom

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
marketplaceHome _ = do
  pb <- getPostBuild
  stakeableProductsDyn <- holdDyn [] (placeholderItems <$ pb)
  areStakeableProductsLoading <- holdDyn False $ leftmost [True <$ pb, False <$ updated stakeableProductsDyn]

  elClass "div" "banner" $ do
    el "h1" $ text "RWA + DeFi = Unbanked, On-Chain Living"
    el "p" $ text "Stake Silver, Gold, ETH, Wrapped Bitcoin, and more to earn CATA."
    el "button" $ text "Stake now"
    elClass "div" "tvl-rewards" $ do
      statCard "$340,644" "Total Value Locked (TVL)"
      statCard "66,813" "Rewards Issued (CATA)"

  dyn_ $ ffor areStakeableProductsLoading $ \case
    False -> elClass "div" "h-96 flex justify-center items-center" $ do
      text "Loading"
    True -> do
      elClass "div" "px-3 md:px-0 py-30 mt-6 md:mt-10 mb-10" $ do
        dyn_ $ ffor stakeableProductsDyn $ mapM_ renderItem
      elClass "h3" "text-center text-gray-500 mt-8 mb-4" $ do
        text "Is there an item you would like to see on the marketplace? "
        elAttr "a" (M.fromList [ ("href", "https://forms.gle/biuEtUHrFdLpX1d36")
                               , ("rel", "noreferrer")
                               , ("target", "_blank")
                               , ("class", "text-blue")
                               ]) $ text "Let us know!"

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