{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Pages.App.Home where

import Common.Route
import Data.Text (Text)
import Reflex.Dom
import Frontend.Components.Link
import Frontend.Components.SVG.ChevronRight
import Frontend.Pages.App.Navbar

heroBackground :: Text
heroBackground = "file:///Users/dustinnorwood/strato/mercata/ui/src/assets/home/hero-background.png"

appHome :: MonadWidget t m => m ()
appHome = elClass "div" "min-h-screen relative bg-white" $ do
  appNavbar True (constDyn False) (pure ())
  elClass "div" "relative pt-16 overflow-hidden" $ do
    elAttr "div" (
           "class" =: "absolute inset-0 bg-cover bg-center bg-no-repeat"
        <> "style" =: ("background-image: url(" <> heroBackground <> ")")
      ) blank
    elClass "div" "container mx-auto px-4 py-48 relative z-10" $
      elClass "div" "max-w-2xl" $ do
        elClass "h1" "text-5xl md:text-6xl lg:text-7xl font-bold mb-8 text-[#001f5c] leading-tight animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-200" $
          text "WHERE STABILITY MEETS OPPORTUNITY"
        elClass "p" "text-lg md:text-xl mb-10 text-gray-600 leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-100" $
          text "Diverse asset classes, one platform. From crypto to precious metals to tokenized securities—investing made simple for everyone."
        elClass "div" "flex flex-col sm:flex-row gap-4" $
          linkWidget (constDyn $ def & lpTo .~ (serializeRoute appOverviewRoute) & lpClassName .~ "group bg-[#f5a623] hover:bg-[#e09615] text-[#001f5c] px-10 py-4 rounded-full font-bold text-sm uppercase tracking-wide transition-all shadow-lg hover:shadow-xl flex items-center justify-center w-fit") $ do
            text "START EARNING"
            chevronRight $ def & svg_class .~ "ml-2 h-5 w-5 transition-transform duration-200 group-hover:translate-x-1"
  elClass "footer" "bg-strato-dark text-white py-16" $
    elClass "div" "container mx-auto px-4 sm:px-6 lg:px-8" $ do
      elClass "div" "grid grid-cols-1 md:grid-cols-3 gap-8" $
        el "div" $ do
          elClass "div" "flex items-center mb-4" $ do
            elAttr "img" (
                   "src" =: "MERCATALOGO"
                <> "alt" =: "STRATO Mercata"
                <> "class" =: "h-10 mr-3"
              ) blank
            elClass "p" "text-gray-400 text-sm" $
              text "Where Stability Meets Opportunity. Easily earn on vaulted gold, silver & crypto."
          elClass "div" "grid grid-cols-2 gap-8 md:col-span-2" $ do
            el "div" blank
            el "div" blank
      elClass "div" "mt-12 pt-8 border-t border-gray-800 text-sm text-gray-400" $
        elClass "div" "flex flex-col md:flex-row justify-between" $
          el "p" $ do
            text "© 2025 BlockApps Inc. All rights reserved."
            blank