{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Main.App where

import Reflex.Dom
import Common.Route
import Data.Text (Text)
import Frontend.Components.Col
import Frontend.Components.Input
import Frontend.Components.Row
import Frontend.Pages.BitcoinBridge.Bridge
import Frontend.Pages.BitcoinBridge.Overview
import Frontend.Pages.BitcoinBridge.RPCPanel
import Frontend.Pages.Marketplace.Home
import Frontend.Pages.Marketplace.MyTransactions
import Frontend.Pages.Marketplace.MyWallet
import Frontend.Pages.Marketplace.ActivityFeed
import Frontend.Pages.Marketplace.Stake
import Frontend.Pages.SMD.Blocks (blocksWidget)
import Frontend.Pages.SMD.Contracts (contractsWidget)
import Frontend.Pages.SMD.Dashboard (dashboardWidget)
import Frontend.Pages.SMD.Users (usersWidget)
import Frontend.Tabs
import Frontend.Types.State

marketplaceHeader :: MonadWidget t m => m a -> m a
marketplaceHeader inner = mdo
  showSearch <- holdDyn False $ leftmost [searchClick, False <$ homeClick]
  ((homeClick, _, _, searchClick), a) <- elClass "div" "fixed z-[100] !bg-[#ffffff] !pl-2 w-full !pr-4 md:px-12 flex md:!mb-10 items-center justify-between md:justify-start" $ do
    stuff <- row (constDyn $ def { _rpClassName = "relative flex-grow-0 md:flex-1 ml-2 md:ml-5" }) $ do
      (e, _) <- col' (constDyn $ def { _cpClassName = "mt-2 mr-5 md:mt-0 cursor-pointer flex-grow-0 w-max md:w-[170px] h-[44px] logo"}) $ do
        elAttr "img" ( ("src" =: "marketplaceLogo")
                    <> ("alt" =: "IMG_META")
                    <> ("title" =: "IMG_META")
                    <> ("class" =: "h-[40px] w-[150px] md:w-[170px] md:h-[44px] object-contain logo-image")
                    <> ("preview" =: "false")
                     ) $ blank
      let homeClickEv = domEvent Click e
      (s, i, clickEv) <- col ((\ss -> def { _cpClassName = "lg:ml-4 mf:ml-20 md:ml-1 bg-[#F6F6F6] shadow-md flex-1 header-search " <> if ss then "fixed top-[13px] left-0 flex w-[100vw] z-50 mb-2" else "hidden md:flex"}) <$> showSearch) $ do
        -- (s', _) <- select' (constDyn $ def { _spClassName = "border-none header-category"}) blank
        (i', clickEv') <- input' (constDyn ("class" =: "bg-[#F6F6F6] outline-none")) $ do
          clickEvEv <- dyn $ ffor showSearch $ \case
            True -> do
              (e', _) <- el' "div" (text "Search") -- arrowLeftOutlined'
              pure $ False <$ domEvent Click e'
            False -> do
              (e', _) <- elAttr' "img" ( ("src" =: "headerSearch")
                                     <> ("alt" =: "IMG_META")
                                     <> ("title" =: "IMG_META")
                                     <> ("class" =: "w-[18px] h-[18px]")
                                      ) $ blank
              pure $ True <$ domEvent Click e'
          switchHold never clickEvEv
        pure ("" :: Text, i', clickEv') -- (s', i')
      pure (homeClickEv, s, i, clickEv)
    a' <- inner
    pure (stuff, a')
  pure a

bridgeHeader :: MonadWidget t m => m a -> m a
bridgeHeader inner = do
  elClass "nav" "bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 w-full py-4 px-6 flex items-center justify-between" $ do
    elClass "div" "flex items-center gap-2 text-white" $ do
      bitcoinLogo "text-yellow-500"
      elClass "h1" "text-2xl font-bold" $ do
        text "Mercata Bridge"
      inner

mainWidget :: MonadWidget t m => m ()
mainWidget = do
  appStateDyn <- stateManager
  elClass "div" "layout-root" $ do
    -- Top-level route tabs
    topRouteDyn <- topRouteTabs

    dyn_ $ ffor topRouteDyn $ \case
      RouteSMD -> elClass "div" "layout-below-top-tabs" $ do
        subRouteDyn <- elClass "nav" "sidebar-nav" $ do
          elClass "div" "logo" $ text "STRATO Mercata"
          r <- smdTabs
          elClass "div" "footer" $ do
            text "BlockApps"
            elAttr "img" ( "src" =: "blockapps-logo.png" ) blank
          pure r
        dyn_ $ ffor subRouteDyn $ \case
          SMDDashboard      -> elClass "div" "content" $ dashboardWidget appStateDyn
          SMDUsers          -> elClass "div" "content" $ usersWidget appStateDyn
          SMDTransactions   -> elClass "div" "content" $ el "h2" $ text "Transactions View"
          SMDContracts      -> elClass "div" "content" $ contractsWidget appStateDyn
          SMDBlocks         -> elClass "div" "content" $ blocksWidget appStateDyn
          SMDContractEditor -> elClass "div" "content" $ el "h2" $ text "Contract Editor"
      RouteMarketplace -> elClass "div" "column-layout-below-top-tabs" $ do
        subRouteDyn <- marketplaceHeader marketplaceTabs
        dyn_ $ ffor subRouteDyn $ \case
          MarketHome         -> elClass "div" "content" $ marketplaceHome appStateDyn
          MarketTransactions -> elClass "div" "content" $ myTransactionsWidget appStateDyn
          MarketWallet       -> elClass "div" "content" $ myWalletWidget appStateDyn
          MarketFeed         -> elClass "div" "content" $ activityFeedWidget
          MarketStake        -> elClass "div" "content" $ stakeTabWidget
      RouteBridge -> elClass "div" "column-layout-below-top-tabs" $ do
        subRouteDyn <- bridgeHeader bridgeTabs
        let whiteBg = elAttr "div" ("style" =: "background-color: #f8f8ff;")
        dyn_ $ ffor subRouteDyn $ \case
          BridgeOverview -> elClass "div" "content" $ whiteBg $ overviewTabWidget appStateDyn
          BridgeBridge   -> elClass "div" "content" $ whiteBg $ bridgeTabWidget appStateDyn
          BridgeRPC      -> elClass "div" "content" $ whiteBg $ rpcTabWidget appStateDyn