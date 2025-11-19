{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Deposits where

import Frontend.Components.Card
import Frontend.Components.SVG.Wallet
import Frontend.Pages.App.Deposits.ExchangeCart
import Frontend.Pages.App.Overview.AssetsList
import Frontend.Pages.App.Overview.AssetSummary
import Frontend.Types.State hiding (Transaction(..))
import Reflex.Dom

appDeposits :: MonadWidget t m => Dynamic t AppState -> m ()
appDeposits _ = elClass "main" "flex-1 p-6 overflow-y-auto" $ do
  elClass "div" "mb-8 flex flex-col lg:flex-row gap-6 items-start" $ do
    elClass "div" "w-full lg:w-[40%] lg:min-w-[400px] lg:max-w-[600px] lg:sticky lg:top-0" $ do
      elClass "div" "mb-6" $
        assetSummary . constDyn $ def
          & as_title .~ "Net Balance"
          & as_value .~ "$0.00" -- TODO
          & as_icon .~ wallet (def & svg_class .~ "text-white" & svg_size .~ 18)
          & as_color .~ "bg-blue-500"
      exchangeCart CdpTab
    elClass "div" "flex-1 min-w-0 max-w-full" $
      assetsList . constDyn $ def -- TODO
        & alp_loading            .~ False
        & alp_tokens             .~ []
        & alp_isDashboard        .~ False
        & alp_inactiveTokens     .~ []
        & alp_shouldPreventFlash .~ True
  card (constDyn "shadow-sm") $ do
    cardHeader (constDyn "") $
      cardTitle (constDyn "") $
        text "Available Assets"
    cardContent (constDyn "") $
      assetsGrid [] -- TODO
  where assetsGrid = const blank