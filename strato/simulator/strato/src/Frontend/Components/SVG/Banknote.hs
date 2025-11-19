{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Banknote
  ( banknote
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

banknote :: MonadWidget t m => SVGProps -> m ()
banknote = flip svg $ do
  elSvgAttr "rect" (
         "width" =: "20"
      <> "height" =: "12"
      <> "x" =: "2"
      <> "y" =: "6"
      <> "rx" =: "2"
    ) $ blank
  elSvgAttr "circle" (
         "cx" =: "12"
      <> "cy" =: "12"
      <> "r" =: "2"
    ) $ blank
  elSvgAttr "path" ("d" =: "M6 12h.01M18 12h.01") $ blank