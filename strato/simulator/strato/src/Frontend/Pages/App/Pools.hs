{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Pools where

import Frontend.Components.Card
import Frontend.Components.Tabs
import Frontend.Types.State hiding (Transaction(..))
import Reflex.Dom

data PoolsTab = LendingTab | SwapTab | SafetyTab | LiquidationsTab
  deriving (Eq, Ord)

appPools :: MonadWidget t m => Dynamic t AppState -> m ()
appPools _ = elClass "main" "p-6" $ do
  card (constDyn "mb-6") $ do
    cardHeader (constDyn "") $ do
      cardTitle (constDyn "") $
        text "Liquidity Pools"
      cardDescription (constDyn "") $
        text "Provide liquidity to earn rewards and enable decentralized trading"
    cardContent (constDyn "") $ do
      tabs (constDyn "w-full") $ mdo
        let focusOn p = (==p) <$> tabDyn
        e <- tabsList (constDyn "grid w-full grid-cols-4 mb-4") $ do
          (e1, _) <- tabsTrigger' (constDyn "text-xs sm:text-sm") (focusOn LendingTab) $ do
            elClass "span" "hidden sm:inline" $
              text "Lending Pools"
            elClass "span" "sm:hidden" $
              text "Lending"
          (e2, _) <- tabsTrigger' (constDyn "text-xs sm:text-sm") (focusOn SwapTab) $ do
            elClass "span" "hidden sm:inline" $
              text "Swap Pools"
            elClass "span" "sm:hidden" $
              text "Swap"
          (e3, _) <- tabsTrigger' (constDyn "text-xs sm:text-sm") (focusOn SafetyTab) $ do
            elClass "span" "hidden sm:inline" $
              text "Safety Module"
            elClass "span" "sm:hidden" $
              text "Safety"
          (e4, _) <- tabsTrigger' (constDyn "text-xs sm:text-sm") (focusOn LiquidationsTab) $ do
            elClass "span" "hidden sm:inline" $
              text "Liquidations"
            elClass "span" "sm:hidden" $
              text "Liquidations"
          pure $ leftmost
            [ LendingTab      <$ domEvent Click e1
            , SwapTab         <$ domEvent Click e2
            , SafetyTab       <$ domEvent Click e3
            , LiquidationsTab <$ domEvent Click e4
            ]
        tabDyn <- holdDyn LendingTab e
        dyn_ . ffor tabDyn $ \case
          LendingTab      -> tabsContent (constDyn "") $
            text "LendingPoolSection"  -- TODO: LendingPoolSection
          SwapTab         -> tabsContent (constDyn "") $
            text "SwapPoolSection"     -- TODO: SwapPoolSection
          SafetyTab       -> tabsContent (constDyn "") $
            text "SafetyModuleSection" -- TODO: SafetyModuleSection
          LiquidationsTab -> tabsContent (constDyn "") $
            text "LiquidationsSection" -- TODO: LiquidationsSection