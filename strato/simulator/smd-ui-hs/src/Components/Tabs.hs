{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Components.Tabs where

import Reflex.Dom
import Types.Route
import qualified Data.Map.Strict as M
import qualified Data.Text as T

navItem :: MonadWidget t m => T.Text -> T.Text -> Dynamic t Bool -> m ()
navItem label icon isActiveDyn = do
  let classes = (\isActive -> M.singleton "class" $ T.unwords ["nav-item", if isActive then "active" else ""]) <$> isActiveDyn
  elDynAttr "a" classes $ do
    elClass "i" ("fa " <> icon) blank
    text label

routeTab :: (Eq r, MonadWidget t m) => T.Text -> T.Text -> r -> Dynamic t r -> m (Event t r)
routeTab label icon route routeDyn = do
  let isActive = (== route) <$> routeDyn
  (e, _) <- el' "button" $ navItem label icon isActive
  pure $ route <$ domEvent Click e

topRouteTabs :: MonadWidget t m => m (Dynamic t TopRoute)
topRouteTabs = do
  elClass "div" "top-tabs" $ mdo
    clicks <- fmap leftmost . traverse ($ routeDyn) $
      [ routeTab "SMD" "fa-chart-line" (RouteSMD SMDDashboard)
      , routeTab "Marketplace" "fa-user" (RouteMarketplace MarketHome)
      , routeTab "Bitcoin Bridge" "fa-random" (RouteBridge BridgeOverview)
      ]
    routeDyn <- holdDyn (RouteSMD SMDDashboard) clicks
    pure routeDyn

smdTabs :: MonadWidget t m => m (Dynamic t TopRoute)
smdTabs = do
  elClass "div" "nav-items" $ mdo
    clicks <- fmap leftmost . traverse ($ routeDyn) $
      [ routeTab "Dashboard" "fa-chart-line" (RouteSMD SMDDashboard)
      , routeTab "Users" "fa-user" (RouteSMD SMDUsers)
      , routeTab "Transactions" "fa-random" (RouteSMD SMDTransactions)
      , routeTab "Contracts" "fa-file-contract" (RouteSMD SMDContracts)
      , routeTab "Blocks" "fa-cube" (RouteSMD SMDBlocks)
      , routeTab "Contract Editor" "fa-code" (RouteSMD SMDContractEditor)
      ]
    routeDyn <- holdDyn (RouteSMD SMDDashboard) clicks
    pure routeDyn

marketplaceTabs :: MonadWidget t m => m (Dynamic t TopRoute)
marketplaceTabs = do
  elClass "div" "nav-items" $ mdo
    clicks <- fmap leftmost . traverse ($ routeDyn) $
      [ routeTab "Home" "fa-chart-line" (RouteMarketplace MarketHome)
      , routeTab "My Transactions" "fa-user" (RouteMarketplace MarketTransactions)
      , routeTab "My Wallet" "fa-random" (RouteMarketplace MarketWallet)
      , routeTab "Activity Feed" "fa-file-contract" (RouteMarketplace MarketFeed)
      , routeTab "Stake" "fa-cube" (RouteMarketplace MarketStake)
      ]
    routeDyn <- holdDyn (RouteMarketplace MarketHome) clicks
    pure routeDyn

bridgeTabs :: MonadWidget t m => m (Dynamic t TopRoute)
bridgeTabs = do
  elClass "div" "nav-items" $ mdo
    clicks <- fmap leftmost . traverse ($ routeDyn) $
      [ routeTab "Overview" "fa-chart-line" (RouteBridge BridgeOverview)
      , routeTab "Bridge" "fa-user" (RouteBridge BridgeBridge)
      , routeTab "RPC" "fa-random" (RouteBridge BridgeRPC)
      ]
    routeDyn <- holdDyn (RouteBridge BridgeOverview) clicks
    pure routeDyn