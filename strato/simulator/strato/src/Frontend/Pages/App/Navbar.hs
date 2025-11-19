{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Frontend.Pages.App.Navbar where

import Reflex.Dom
import Common.Route
import Control.Lens ((<&>))
import Control.Monad (when)
import Data.Bool (bool)
import qualified Data.Map.Strict as M
import Frontend.Components.Link
import Frontend.Components.Spinner

appNavbar :: MonadWidget t m => Bool -> Dynamic t Bool -> m () -> m ()
appNavbar isLoggedIn loading logout = mdo
  elClass "nav" "fixed top-0 left-0 right-0 z-50 bg-white bg-opacity-80 backdrop-blur-md shadow-sm" $ do
    isMenuOpen <- elClass "div" "container mx-auto px-4 sm:px-6 lg:px-8" $
      elClass "div" "flex items-center justify-between h-16" $ do
        elClass "div" "flex items-center" $
          linkWidget (constDyn $ def & lpTo .~ (serializeRoute $ RouteApp AppHome) & lpClassName .~ "flex-shrink-0") $
            elAttr "img" ( ("src" =: "")
                        <> ("alt" =: "STRATO mercata")
                        <> ("class" =: "h-10")
                         ) blank
        elClass "div" "hidden md:flex items-center space-x-4" $ do
          let loadAndLog = liftA2 (,) loading (pure isLoggedIn)
          when isLoggedIn . flip linkWidget (text "Launch App") . constDyn $
            def & lpTo .~ (serializeRoute appOverviewRoute)
                & lpClassName .~ "bg-strato-blue text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-strato-blue/90 transition-colors"
          (buttonEl, _) <- elDynAttr' "button" (loadAndLog <&> \(loading', isLoggedIn') ->
            M.fromList [ ("disabled", bool "false" "true" loading')
                       , ("class", "px-4 py-2 rounded-full text-sm font-medium transition-colors " <> bool (
                           bool
                             "text-strato-blue border border-strato-blue hover:bg-strato-blue/5"
                             "text-red-600 border border-red-300 hover:bg-red-50"
                             isLoggedIn'
                           )
                           "opacity-75 cursor-not-allowed text-gray-500 border border-gray-300"
                           loading'
                         )
                       ]) $
            dyn_ $ loadAndLog <&> \(loading', isLoggedIn') ->
              if loading'
                then spinner
                else text $ bool "Login" "Log Out" isLoggedIn'
          let clickEv = domEvent Click buttonEl
              logoutEv = flip tagMaybe clickEv $ (current loadAndLog) <&> \case
                (False, True) -> Just ()
                _             -> Nothing
              gotoLoginEv = flip tagMaybe clickEv $ (current loadAndLog) <&> \case
                (False, False) -> Just ()
                _             -> Nothing
          widgetHold_ blank (blank <$ gotoLoginEv)
          widgetHold_ blank (logout <$ logoutEv)
          pure ()
        elClass "div" "flex md:hidden" $ mdo
          (e, _) <- elAttr' "button" (
                 "type" =: "button"
              <> "class" =: "inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-strato-blue hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-strato-blue"
              <> "aria-expanded" =: "false"
            ) $ do
              elClass "span" "sr-only" $ text $ "Open main menu"
              dyn_ . ffor isMenuOpen' $ \case
                True -> elAttr "svg" (
                       "class" =: "block h-6 w-6"
                    <> "xmlns" =: "http://www.w3.org/2000/svg"
                    <> "fill" =: "none"
                    <> "viewBox" =: "0 0 24 24"
                    <> "stroke" =: "currentColor"
                    <> "aria-hidden" =: "true"
                  ) $ elAttr "path" (
                       "strokeLinecap" =: "round"
                    <> "strokeLinejoin" =: "round"
                    <> "strokeWidth" =: "2"
                    <> "d" =: "M6 18L18 6M6 6l12 12"
                  ) blank
                False -> elAttr "svg" (
                       "class" =: "block h-6 w-6"
                    <> "xmlns" =: "http://www.w3.org/2000/svg"
                    <> "fill" =: "none"
                    <> "viewBox" =: "0 0 24 24"
                    <> "stroke" =: "currentColor"
                    <> "aria-hidden" =: "true"
                  ) $ elAttr "path" (
                       "strokeLinecap" =: "round"
                    <> "strokeLinejoin" =: "round"
                    <> "strokeWidth" =: "2"
                    <> "d" =: "M4 6h16M4 12h16M4 18h16"
                  ) blank
          let clickEv = domEvent Click e
          isMenuOpen' <- foldDyn (\_ -> not) False clickEv
          pure isMenuOpen'
    dyn_ . ffor isMenuOpen $ \case
      False -> blank
      True -> elClass "div" "md:hidden" $
        elClass "div" "px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white shadow-lg" $
          elClass "div" "pt-4 pb-2 border-t border-gray-200 space-y-2" $ do
            when isLoggedIn . flip linkWidget (text "Launch App") . constDyn $
              def & lpTo .~ (serializeRoute appOverviewRoute)
                  & lpClassName .~ "bg-strato-blue text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-strato-blue/90 transition-colors"
