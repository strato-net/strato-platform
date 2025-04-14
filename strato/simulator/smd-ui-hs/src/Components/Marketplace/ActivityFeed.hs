{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

module Components.Marketplace.ActivityFeed where

import Reflex.Dom
import Backend.Types
import Components.Badge
import Control.Monad (forM)
import Data.Foldable (traverse_)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Set (Set)
import qualified Data.Set as Set

allActivities :: [Activity]
allActivities =
  [ Activity "Stake" "GOLDST" 0.033 Nothing "blockapps_metals" "appdeveloper1" "Apr 14, 2025 1:55 AM"
  , Activity "Stake" "Silver - Fractional 100 oz Bars" 6 Nothing "blockapps_metals" "appdeveloper1" "Apr 13, 2025 10:57 PM"
  , Activity "Stake" "GOLDST" 0.05 Nothing "blockapps_metals" "jameela" "Apr 13, 2025 4:02 PM"
  , Activity "Unstake" "GOLDST" 0.05 Nothing "blockapps_metals" "jameela" "Apr 13, 2025 4:01 PM"
  , Activity "Order" "GOLDST" 0.05 (Just 3278.03) "jameela" "blockapps_metals" "Apr 13, 2025 4:01 PM"
  , Activity "Order" "USDST" 163.91 (Just 1.0) "jameela" "mercata_usdst" "Apr 13, 2025 4:00 PM"
  , Activity "Stake" "USDST" 3 Nothing "BlockApps" "Tyson Rose" "Apr 13, 2025 7:43 AM"
  , Activity "Stake" "GOLDST" 0.011 Nothing "blockapps_metals" "censoredwallet@gmail.com" "Apr 12, 2025 2:15 AM"
  , Activity "Stake" "GOLDST" 0.533 Nothing "blockapps_metals" "Michael Tan" "Apr 11, 2025 7:10 PM"
  , Activity "Stake" "GOLDST" 0.033 Nothing "blockapps_metals" "tpmtreasury" "Apr 11, 2025 3:36 PM"
  , Activity "Stake" "GOLDST" 0.011 Nothing "blockapps_metals" "steppenwolf" "Apr 11, 2025 3:00 PM"
  , Activity "Stake" "GOLDST" 0.033 Nothing "blockapps_metals" "haidun" "Apr 11, 2025 2:10 PM"
  ]

activityFeedWidget :: MonadWidget t m => m ()
activityFeedWidget = elClass "div" "activity-feed" $ mdo
  el "h2" $ text "Activity Feed"

  -- Individual toggle buttons
  toggleEvents <- elClass "div" "filter-buttons" $ do
    fmap leftmost . forM filterTypes $ \t ->
      filterToggleButton t selectedFilters

  -- Clear All button
  clearAllEvent <- el "div" $ do
    (e, _) <- elAttr' "button" ("class" =: "clear-btn") $ text "Clear All"
    return $ ClearAll <$ domEvent Click e

  -- Merge both toggle and clear into a single event
  let filterEvents = leftmost [clearAllEvent, uncurry Toggle <$> toggleEvents]

  selectedFilters <- foldDyn applyFilterEvent Set.empty filterEvents
  --   filterEvents <- elClass "div" "activity-filters" $ do
  --     el "h3" $ text "Filter"
  --     elClass "div" "filter-buttons" $ do
  --       fmap leftmost . forM filterTypes $ \t ->
  --         filterToggleButton t <$> current selectedFilters

  --   selectedFilters <- foldDyn updateFilters Set.empty filterEvents

  let filteredActivities = zipDynWith filterActivities selectedFilters (constDyn allActivities)

  -- Table with filtered rows
  elClass "table" "activity-table" $ do
    el "thead" $ el "tr" $ mapM_ (el "th" . text)
      ["Type", "Asset", "Quantity", "Price", "Buyer/Sender", "Seller/Recipient", "Date"]

    el "tbody" $
      dyn_ $ ffor filteredActivities $ traverse_ renderActivityRow

  return ()

data FilterEvent
  = Toggle Text Bool
  | ClearAll

applyFilterEvent :: FilterEvent -> Set Text -> Set Text
applyFilterEvent (Toggle t True)  = Set.insert t
applyFilterEvent (Toggle t False) = Set.delete t
applyFilterEvent ClearAll            = const Set.empty

-- Available filter types
filterTypes :: [Text]
filterTypes = ["Order", "Transfer", "Redemption", "Stake", "Unstake"]

filterToggleButton :: MonadWidget t m => Text -> Dynamic t (Set Text) -> m (Event t (Text, Bool))
filterToggleButton label activeSetDyn = do
  let isSelected = (label `Set.member`) <$> activeSetDyn
      classStr = (\b -> "filter-btn" <> if b then " selected" else "") <$> isSelected
  (e, _) <- elDynAttr' "button" (("class" =:) <$> classStr) $ text label
  return $ tag ((label,) . not <$> current isSelected) $ domEvent Click e

updateFilters :: (Text, Bool) -> Set Text -> Set Text
updateFilters (label, True)  = Set.insert label
updateFilters (label, False) = Set.delete label

filterActivities :: Set Text -> [Activity] -> [Activity]
filterActivities selected acts
  | Set.null selected = acts
  | otherwise = filter (\a -> actType a `Set.member` selected) acts

filterButton :: MonadWidget t m => Text -> m ()
filterButton label = elClass "button" "filter-btn" $ text label

renderFilterTag :: MonadWidget t m => Text -> m ()
renderFilterTag tag' = elClass "span" "filter-tag" $ do
  text tag'
  el "span" $ text " ✕"

renderActivityRow :: MonadWidget t m => Activity -> m ()
renderActivityRow Activity{..} = el "tr" $ do
  -- Type badge
  elClass "td" "type-cell" $
    elClass "span" ("badge " <> badgeClass actType) $ text actType

  -- Asset with icon
  el "td" $ do
    -- elAttr "img" ("src" =: actIconSrc <> "class" =: "asset-icon") blank
    text $ " " <> actAsset

  el "td" $ text $ T.pack $ show actQuantity
  el "td" $ maybe (text "--") text $ T.pack . show <$> actPrice
  el "td" $ text actBuyer
  el "td" $ text actSeller
  el "td" $ text actTimestamp