{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Overview where

import Control.Lens
import Control.Monad (when)
import Data.Bool (bool)
import Data.Text (Text)
import qualified Data.Text as T
import Frontend.Components.SVG.Banknote
import Frontend.Components.SVG.Coins
import Frontend.Components.SVG.Loader2
import Frontend.Components.SVG.Shield
import Frontend.Components.SVG.Wallet
import Frontend.Pages.App.Overview.AssetsList
import Frontend.Pages.App.Overview.AssetSummary
import Frontend.Pages.App.Overview.BorrowingSection
import Frontend.Pages.App.Overview.FAQ
import Frontend.Pages.App.Overview.MyPoolParticipationSection
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

appDashboard :: MonadWidget t m => Dynamic t AppState -> m ()
appDashboard _ = do
    elClass "main" "p-6" $ do
      let rewardsEnabled = constDyn False
          isClaiming = constDyn False
          isDataInitialized = constDyn True
          totalBalance = 12345.67 :: Double
          cataPoints = 100.00 :: Double
          pendingRewards = 12.34 :: Double
          totalBorrowed = 246.80 :: Double
      elDynAttr "div" (ffor rewardsEnabled $ \enabled ->
          "class" =: (
                 "grid grid-cols-1 "
              <> (bool
                    "lg:grid-cols-3"
                    "lg:grid-cols-4"
                    enabled
                 )
              <> " gap-6 mb-8"
            )
        ) $ do
        assetSummary . constDyn $ def
          & as_title .~ "Net Balance"
          & as_value .~ (T.pack $ show totalBalance <> " CATA Points")
          & as_icon .~ (wallet $ def & svg_size .~ 18 & svg_class .~ "text-white")
          & as_color .~ "bg-blue-500"
        assetSummary . constDyn $ def
          & as_title .~ "Rewards"
          & as_value .~ (T.pack $ show cataPoints <> " CATA Points")
          & as_icon .~ (coins $ def & svg_size .~ 18 & svg_class .~ "text-white")
          & as_color .~ "bg-purple-500"
        dyn_ . ffor rewardsEnabled $ \case
          False -> blank
          True  ->
            assetSummary . ffor isClaiming $ \ic -> def
              & as_title .~ "Pending CATA"
              & as_value .~ (T.pack $ show pendingRewards <> " CATA")
              & as_icon .~ (bool
                (banknote $ def & svg_size .~ 18 & svg_class .~ "text-white")
                (loader2 $ def & svg_size .~ 18 & svg_class .~ "text-white animate-spin")
                ic)
              & as_color .~ (bool "bg-gray-500" "bg-purple-500" $ pendingRewards > 0)
              & as_onClick .~ (bool Nothing (Just $ pure ()) $ pendingRewards > 0)
              & as_tooltip .~
                  (if ic
                     then Just "Processing claim..."
                     else bool Nothing
                               (Just $ "Click to claim your rewards")
                               $ pendingRewards > 0
                  )
        assetSummary . constDyn $ def
          & as_title .~ "Total Borrowed"
          & as_value .~ (T.pack $ show totalBorrowed <> " USDST")
          & as_icon .~ (shield $ def & svg_size .~ 18 & svg_class .~ "text-white")
          & as_color .~ "bg-orange-500"
      dyn_ . ffor isDataInitialized $ \case
        False -> blank
        True -> do
          elClass "div" "mb-8" $
            assetsList def
          elClass "div" "mb-8" $
            borrowingSection $ constDyn def
          elClass "div" "mb-8" $
            myPoolParticipationSection $ constDyn def
          elClass "div" "mb-8" $
            dashboardFAQ


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