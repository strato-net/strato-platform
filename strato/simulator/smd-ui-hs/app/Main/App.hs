{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Main.App where

import Reflex.Dom
import State.Store
import Types.Route
import Components.Blocks (blocksWidget)
import Components.BitcoinBridge.Bridge
import Components.BitcoinBridge.Overview
import Components.BitcoinBridge.RPCPanel
import Components.Contracts (contractsWidget)
import Components.Dashboard (dashboardWidget)
import Components.Marketplace.Home
import Components.Marketplace.MyTransactions
import Components.Marketplace.MyWallet
import Components.Marketplace.ActivityFeed
import Components.Marketplace.Stake
import Components.Users (usersWidget)
import Components.Tabs
import Control.Monad (join)

mainWidget :: MonadWidget t m => m ()
mainWidget = do
  appStateDyn <- stateManager
  elClass "div" "layout-root" $ do
    -- Top-level route tabs
    topRouteDyn <- topRouteTabs

    elClass "div" "layout-below-top-tabs" $ do
      -- Sub-route tabs, scoped to top-level
      subRouteEv <- elClass "nav" "sidebar-nav" $ do
        elClass "div" "logo" $ text "STRATO Mercata"
        routeEv <- dyn $ ffor topRouteDyn $ \case
          RouteSMD _ -> smdTabs
          RouteMarketplace _ -> marketplaceTabs
          RouteBridge _ -> bridgeTabs
        elClass "div" "footer" $ do
          text "blockapps"
          elAttr "img" ( "src" =: "blockapps-logo.png" ) blank
        pure routeEv
    
      subRouteDyn <- join <$> holdDyn (constDyn $ RouteSMD SMDDashboard) subRouteEv

      -- View rendering
      elClass "div" "content" $ dyn_ $ ffor subRouteDyn $ \case
        RouteSMD SMDDashboard               -> dashboardWidget appStateDyn
        RouteSMD SMDUsers                   -> usersWidget appStateDyn
        RouteSMD SMDTransactions            -> el "h2" $ text "Transactions View"
        RouteSMD SMDContracts               -> contractsWidget appStateDyn
        RouteSMD SMDBlocks                  -> blocksWidget appStateDyn
        RouteSMD SMDContractEditor          -> el "h2" $ text "Contract Editor"

        RouteMarketplace MarketHome         -> marketplaceHome appStateDyn
        RouteMarketplace MarketTransactions -> myTransactionsWidget appStateDyn
        RouteMarketplace MarketWallet       -> myWalletWidget appStateDyn
        RouteMarketplace MarketFeed         -> activityFeedWidget
        RouteMarketplace MarketStake        -> stakeTabWidget

        RouteBridge BridgeOverview          -> overviewTabWidget appStateDyn
        RouteBridge BridgeBridge            -> bridgeTabWidget appStateDyn
        RouteBridge BridgeRPC               -> rpcTabWidget appStateDyn