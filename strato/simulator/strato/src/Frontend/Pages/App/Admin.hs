{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

module Frontend.Pages.App.Admin where

import Data.Bool (bool)
import Frontend.Components.Button
import Frontend.Components.Card
import Frontend.Components.SVG.ArrowLeft
import Frontend.Components.SVG.Database
import Frontend.Components.SVG.Droplets
import Frontend.Components.SVG.Settings
import Frontend.Components.SVG.Shield
import Frontend.Components.SVG.TrendingUp
import Frontend.Components.SVG.Vote
import Frontend.Components.Tabs
import Reflex.Dom hiding (button)

data AdminTab = CreatePoolsTab
              | LendingConfigTab
              | TokenConfigTab
              | CreateTokensTab
              | SetPricesTab
              | TokenStatusTab
              | CdpConfigTab
              | VoteTab
  deriving (Eq, Ord)

appAdmin :: MonadWidget t m => m ()
appAdmin = elClass "div" "min-h-screen bg-gray-50" $ do
  elClass "div" "bg-white border-b bordery-gray-200" $
    elClass "div" "container mx-auto px-4 sm:px-6 lg:px-8" $
      elClass "div" "flex items-center justify-between h-16" $
        elClass "div" "flex items-center space-x-4" $ do
          button (constDyn $ def
            & bpVariant .~ BVGhost
            & bpSize .~ BSSmall
            & bpClassName .~ "flex items-center space-x-2"
            ) $ do
              arrowLeft $ def & svg_class .~ "h-4 w-4"
              el "span" $ text "Back to Dashboard"
          elClass "div" "flex items-center space-x-2" $ do
            shield $ def & svg_class .~ "h-6 w-6 text-strato-blue"
            elClass "h1" "text-xl font-bold" $
              text "Admin Panel"
  elClass "div" "container mx-auto px-4 sm:px-6 lg:px-8 py-8" $ do
    elClass "div" "mb-8" $ do
      elClass "h2" "text-3xl font-bold mb-2" $
        text "Platform Administration"
      elClass "p" "text-gray-600" $
        text "Manage tokens, pools, liquidity, and asset pricing"
    tabs (constDyn "space-y-6") $ do
      elClass "div" "w-full overflow-x-auto" $ mdo
        let focusOn ps = (`elem` ps) <$> tabDyn
        e <- tabsList (constDyn "grid grid-cols-5 w-full min-w-[600px] md:min-w-0") $ do
          (e1, _) <- tabsTrigger' (constDyn "flex items-center space-x-1 md:space-x-2 text-xs md:text-sm")
                       (focusOn [CreatePoolsTab]) $ do
            droplets $ def & svg_class .~ "h-3 w-3 md:h-4 md:w-4"
            elClass "span" "hidden sm:inline" $
              text "Create Pools"
            elClass "span" "sm:hidden" $
              text "Pools"
          (e2, _) <- tabsTrigger' (("inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-xs md:text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 space-x-1 md:space-x-2 "
                        <>) . bool "hover:bg-muted hover:text-accent-foreground"
                                   "bg-background text-foreground shadow-sm"
                                   <$> focusOn [LendingConfigTab, TokenConfigTab])
                       (focusOn [LendingConfigTab, TokenConfigTab]) $ do
            trendingUp $ def & svg_class .~ "h-3 w-3 md:h-4 md:w-4"
            elClass "span" "hidden sm:inline" $
              text "Lending"
            elClass "span" "sm:hidden" $
              text "Lending"
          (e3, _) <- tabsTrigger' (("inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-xs md:text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 space-x-1 md:space-x-2 "
                        <>) . bool "hover:bg-muted hover:text-accent-foreground"
                                   "bg-background text-foreground shadow-sm"
                                   <$> focusOn [CreateTokensTab, SetPricesTab, TokenStatusTab])
                       (focusOn [CreateTokensTab, SetPricesTab, TokenStatusTab]) $ do
            settings $ def & svg_class .~ "h-3 w-3 md:h-4 md:w-4"
            elClass "span" "hidden sm:inline" $
              text "Token"
            elClass "span" "sm:hidden" $
              text "Token"
          (e4, _) <- tabsTrigger' (constDyn "flex items-center space-x-1 md:space-x-2 text-xs md:text-sm")
                       (focusOn [CdpConfigTab]) $ do
            database $ def & svg_class .~ "h-3 w-3 md:h-4 md:w-4"
            elClass "span" "hidden sm:inline" $
              text "CDP Config"
            elClass "span" "sm:hidden" $
              text "CDP"
          (e5, _) <- tabsTrigger' (constDyn "flex items-center space-x-1 md:space-x-2 text-xs md:text-sm")
                       (focusOn [VoteTab]) $ do
            vote $ def & svg_class .~ "h-3 w-3 md:h-4 md:w-4"
            elClass "span" "hidden sm:inline" $
              text "Vote on Issues"
            elClass "span" "sm:hidden" $
              text "Vote"
          pure $ leftmost
            [ CreatePoolsTab   <$ domEvent Click e1
            , LendingConfigTab <$ domEvent Click e2
            , CreateTokensTab  <$ domEvent Click e3
            , CdpConfigTab     <$ domEvent Click e4
            , VoteTab          <$ domEvent Click e5
            ]
        tabDyn <- holdDyn CreatePoolsTab e
        dyn_ . ffor tabDyn $ \case
          CreatePoolsTab   -> tabsContent (constDyn "space-y-6") $
            card (constDyn "") $ do
              cardHeader (constDyn "") $ do
                cardTitle (constDyn "") $
                  text "Create New Token"
                cardDescription (constDyn "") $
                  text "Deploy a new ERC20 token on the STRATO blockchain"
              cardContent (constDyn "") $
                text "CreateTokenForm" -- TODO: CreateTokenForm
          LendingConfigTab -> tabsContent (constDyn "space-y-6") $ do
            card (constDyn "") $ do
              cardHeader (constDyn "") $ do
                cardTitle (constDyn "") $
                  text "Create Swap Pool"
                cardDescription (constDyn "") $
                  text "Select pairing tokens and set initial liquidity"
              cardContent (constDyn "") $
                text "CreatePoolForm" -- TODO: CreatePoolForm
          TokenConfigTab   -> tabsContent (constDyn "space-y-6") $ do
            text "LendingTab" -- TODO: LendingTab
          CreateTokensTab  -> tabsContent (constDyn "space-y-6") $ do
            card (constDyn "") $ do
              cardHeader (constDyn "") $ do
                cardTitle (constDyn "") $
                  text "Set Asset Prices"
                cardDescription (constDyn "") $
                  text "Configure oracle pricing for assets"
              cardContent (constDyn "") $
                text "SetAssetPriceForm" -- TODO: SetAssetPriceForm
          SetPricesTab     -> tabsContent (constDyn "space-y-6") $ do
            text "TokenConfigTable" -- TODO: TokenConfigTable
          TokenStatusTab   -> tabsContent (constDyn "space-y-6") $
            text "TokenStatusTable" -- TODO: TokenStatusTable
          CdpConfigTab     -> tabsContent (constDyn "space-y-6") $
            text "CollateralConfigManager" -- TODO: CollateralConfigManager
          VoteTab          -> tabsContent (constDyn "space-y-6") $
            text "VoteTab" -- TODO: VoteTab