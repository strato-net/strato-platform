{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE RecursiveDo #-}

module Frontend.Pages.App.Sidebar where

import Reflex.Dom
import Common.Route
import Control.Lens
import Data.Bool
import Data.Foldable (traverse_)
import Data.Text (Text)
import qualified Data.Text as T
import Frontend.Components.Link
import Frontend.Components.SVG.Activity
import Frontend.Components.SVG.ArrowLeft
import Frontend.Components.SVG.ArrowRight
import Frontend.Components.SVG.ArrowRightLeft
import Frontend.Components.SVG.Book
import Frontend.Components.SVG.Database
import Frontend.Components.SVG.LayoutDashboard
import Frontend.Components.SVG.Send
import Frontend.Components.SVG.Shield
import Frontend.Components.SVG.Wallet
import JSDOM (currentDocumentUnchecked, currentWindowUnchecked)
import JSDOM.Generated.Window (getInnerWidth)
import Language.Javascript.JSaddle

appSidebar :: MonadWidget t m => AppDashboardRoute -> m ()
appSidebar r = mdo
  pbE <- pure never -- getPostBuild
  collapsed <- holdDyn False setCollapsed
  let cc = current collapsed
  doResize <- holdDyn False $ leftmost [updated collapsed, tag cc resized, tag cc pbE]
  dyn_ $ setSidebarWidth <$> doResize
  (resized, setCollapsed) <- resizeDetector $ do
    elDynAttr "div" (ffor collapsed $ \c ->
        ("class" =: ("h-screen flex-col bg-sidebar-background text-sidebar-foreground fixed left-0 top-0 z-40 transition-all duration-300 border-r border-sidebar-border hidden md:flex "
          <> (bool "w-64" "w-16" c)
        ))
      ) $ do
      setCollapsed' <- elClass "div" "border-b border-sidebar-border" . dyn . ffor collapsed $ \case
        True -> elClass "div" "p-4 flex flex-col items-center space-y-2" $ do
          (e, _) <- elClass' "button" "rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground" $
            arrowRight $ def & svg_size .~ 16
          elAttr "img" (
                 "src" =: "MERCATAICON"
              <> "alt" =: "STRATO mercata"
              <> "class" =: "h-8"
            ) blank
          pure $ False <$ domEvent Click e
        False -> elClass "div" "p-4 flex items-center justify-between" $ do
          elAttr "img" (
                 "src" =: "MERCATAICON"
              <> "alt" =: "STRATO mercata"
              <> "class" =: "h-12"
            ) blank
          (e, _) <- elClass' "button" "rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground" $
            arrowLeft $ def & svg_size .~ 16
          pure $ True <$ domEvent Click e

      elClass "div" "flex flex-col flex-1 overflow-y-auto py-4" $
        elAttr "nav" (
               "class" =: "flex-1"
            <> "role" =: "navigation"
            <> "aria-label" =: "Sidebar"
          ) $
          elClass "ul" "space-y-1" $ do
            traverse_ (\(i,(a,b,c)) -> routeTab r collapsed i a b c) $ zip [0..]
              [ ("Overview", AppOverview, layoutDashboard)
              , ("Deposits", AppDeposits, wallet)
              , ("Transfer", AppTransfer, send)
              , ("Borrow", AppBorrow, book)
              , ("Swap", AppSwap, arrowRightLeft)
              , ("Pools", AppPools, database)
              , ("Activity Feed", AppActivityFeed, activity)
              , ("Admin", AppAdmin, shield)
              ]
      switchHold never setCollapsed'
  pure ()

setSidebarWidth :: MonadWidget t m => Bool -> m ()
setSidebarWidth collapsed = liftJSM $ do
  doc <- currentDocumentUnchecked
  w <- getInnerWidth =<< currentWindowUnchecked
  let v = if w >= 768
            then bool 16 4 collapsed
            else 0 :: Int
  _ <- doc ^. js ("documentElement" :: Text)
           ^. js ("style" :: Text)
           ^. js2 ("setProperty" :: Text)
                  ("--sidebar-width" :: Text)
                  (T.pack $ show v ++ "rem")
  pure ()

baseLinkClasses :: Text
baseLinkClasses = "flex items-center px-4 py-2.5 rounded-md mx-2 transition-colors duration-200 "

activeLinkClasses :: Text
activeLinkClasses = "bg-muted text-black font-semibold border-l-4 border-primary"

inactiveLinkClasses :: Text
inactiveLinkClasses = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"

routeTab :: MonadWidget t m
         => AppDashboardRoute
         -> Dynamic t Bool
         -> Int
         -> T.Text
         -> AppDashboardRoute
         -> SVGIcon t m
         -> m ()
routeTab currentRoute collapsed i label route icon =
  elAttr "li" ("key" =: T.pack (show i)) $ do
    let isActive = currentRoute == route
    dyn_ . ffor collapsed $ \case
      True -> linkWidget (constDyn $
          def & lpTo .~ serializeRoute (RouteApp $ AppDashboard route)
              & lpClassName .~ (baseLinkClasses <> bool inactiveLinkClasses activeLinkClasses isActive)
        ) $ navIcon isActive icon
      False -> linkWidget (constDyn $
          def & lpTo .~ serializeRoute (RouteApp $ AppDashboard route)
              & lpClassName .~ (baseLinkClasses <> bool inactiveLinkClasses activeLinkClasses isActive)
        ) $ do
          navIcon isActive icon
          elClass "span" ("ml-3" <> bool "" " font-semibold" isActive) $
            text label

navIcon :: MonadWidget t m => Bool -> SVGIcon t m -> m ()
navIcon isActive icon = elClass "span"
  ("flex-shrink-0" <> bool "" " text-black" isActive)
  (icon $ def & svg_size .~ 20)