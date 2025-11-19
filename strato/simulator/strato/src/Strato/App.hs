{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Strato.App where

import Reflex.Dom
import Common.Route
import Data.Maybe (fromMaybe)
import Frontend.Pages.App.ActivityFeed
import Frontend.Pages.App.Admin
import Frontend.Pages.App.Borrow
import Frontend.Pages.App.Header
import Frontend.Pages.App.Deposits
import Frontend.Pages.App.Home
import Frontend.Pages.App.Overview
import Frontend.Pages.App.Pools
import Frontend.Pages.App.Sidebar
import Frontend.Pages.App.Swap
import Frontend.Pages.App.Transfer
import Frontend.Pages.BitcoinBridge.Bridge
import Frontend.Pages.BitcoinBridge.Navbar
import Frontend.Pages.BitcoinBridge.Overview
import Frontend.Pages.BitcoinBridge.RPCPanel
import Frontend.Pages.SMD.Blocks (blocksWidget)
import Frontend.Pages.SMD.Contracts (contractsWidget)
import Frontend.Pages.SMD.Dashboard (dashboardWidget)
import Frontend.Pages.SMD.Users (usersWidget)
import Frontend.Tabs
import Frontend.Types.State


mainWidget :: MonadWidget t m => m ()
mainWidget = do
  appStateDyn <- stateManager
  initialPath <- getLocationPath
  topRouteDyn <- holdDyn (fromMaybe (RouteApp AppHome) $ deserializeRoute initialPath) never

  dyn_ $ ffor topRouteDyn $ \case
    RouteApp ar -> case ar of
      AppHome -> appHome
      AppDashboard adr -> elClass "div" "min-h-screen bg-gray-50" $ do
        appSidebar adr
        elAttr "div" (
               "class" =: "transition-all duration-300 md:pl-64"
            <> "style" =: "paddingLeft: var(--sidebar-width, 0rem)"
          ) $ do
          dashboardHeader . constDyn $ def & dhp_title .~ case adr of
            AppOverview     -> "Overview"
            AppDeposits     -> "Deposits"
            AppTransfer     -> "Transfer"
            AppBorrow       -> "Borrow"
            AppSwap         -> "Swap"
            AppPools        -> "Pools"
            AppActivityFeed -> "Activity Feed"
            AppAdmin        -> "Admin"
          case adr of
            AppOverview     -> appDashboard appStateDyn
            AppDeposits     -> appDeposits appStateDyn
            AppTransfer     -> appTransfer appStateDyn
            AppBorrow       -> appBorrow
            AppSwap         -> appSwap appStateDyn
            AppPools        -> appPools appStateDyn
            AppActivityFeed -> appActivityFeed
            AppAdmin        -> appAdmin
        pure ()
    RouteSMD sr -> elClass "div" "layout-below-top-tabs" $ do
      elClass "nav" "sidebar-nav" $ do
        elClass "div" "logo" $ text "STRATO Mercata"
        smdTabs sr
        elClass "div" "footer" $ do
          text "BlockApps"
          elAttr "img" ( "src" =: "blockapps-logo.png" ) blank
      case sr of
        SMDDashboard      -> elClass "div" "content" $ dashboardWidget appStateDyn
        SMDUsers          -> elClass "div" "content" $ usersWidget appStateDyn
        SMDTransactions   -> elClass "div" "content" $ el "h2" $ text "Transactions View"
        SMDContracts      -> elClass "div" "content" $ contractsWidget appStateDyn
        SMDBlocks         -> elClass "div" "content" $ blocksWidget appStateDyn
        SMDContractEditor -> elClass "div" "content" $ el "h2" $ text "Contract Editor"
      pure ()
    RouteBridge br -> elClass "div" "column-layout-below-top-tabs" $ do
      bridgeNavbar $ bridgeTabs br
      let whiteBg = elAttr "div" ("style" =: "background-color: #f8f8ff;")
      case br of
        BridgeOverview -> elClass "div" "content" $ whiteBg $ overviewTabWidget appStateDyn
        BridgeBridge   -> elClass "div" "content" $ whiteBg $ bridgeTabWidget appStateDyn
        BridgeRPC      -> elClass "div" "content" $ whiteBg $ rpcTabWidget appStateDyn
  pure ()