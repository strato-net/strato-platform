{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Frontend.Tabs where

import Reflex.Dom
import Common.Route
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

bridgeRouteTab :: (Eq r, MonadWidget t m) => T.Text -> T.Text -> r -> Dynamic t r -> m (Event t r)
bridgeRouteTab label icon route routeDyn = do
  let isActive = (== route) <$> routeDyn
  (e, _) <- elClass' "button" "text-sm px-4 data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-300" $ navItem label icon isActive
  pure $ route <$ domEvent Click e

smdTabs :: MonadWidget t m => SMDRoute -> m ()
smdTabs r = do
  elClass "div" "nav-items" $ mdo
    clicks <- fmap leftmost . traverse ($ routeDyn) $
      [ routeTab "Dashboard" "fa-chart-line" SMDDashboard
      , routeTab "Users" "fa-user" SMDUsers
      , routeTab "Transactions" "fa-random" SMDTransactions
      , routeTab "Contracts" "fa-file-contract" SMDContracts
      , routeTab "Blocks" "fa-cube" SMDBlocks
      , routeTab "Contract Editor" "fa-code" SMDContractEditor
      ]
    routeDyn <- holdDyn r clicks
    pure ()

bridgeTabs :: MonadWidget t m => BridgeRoute -> m ()
bridgeTabs r = do
  elClass "div" "nav-items" $ mdo
    clicks <- fmap leftmost . traverse ($ routeDyn) $
      [ bridgeRouteTab "Overview" "fa-chart-line" BridgeOverview
      , bridgeRouteTab "Bridge" "fa-user" BridgeBridge
      , bridgeRouteTab "RPC" "fa-random" BridgeRPC
      ]
    routeDyn <- holdDyn r clicks
    pure ()