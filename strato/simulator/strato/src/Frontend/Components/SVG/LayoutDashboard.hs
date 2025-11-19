{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.LayoutDashboard
  ( layoutDashboard
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

layoutDashboard :: MonadWidget t m => SVGProps -> m ()
layoutDashboard = flip svg $ do
  elSvgAttr "rect" (
         "width" =: "7"
      <> "height" =: "9"
      <> "x" =: "3"
      <> "y" =: "3"
      <> "rx" =: "1"
    ) $ blank
  elSvgAttr "rect" (
         "width" =: "7"
      <> "height" =: "5"
      <> "x" =: "14"
      <> "y" =: "3"
      <> "rx" =: "1"
    ) $ blank
  elSvgAttr "rect" (
         "width" =: "7"
      <> "height" =: "9"
      <> "x" =: "14"
      <> "y" =: "12"
      <> "rx" =: "1"
    ) $ blank
  elSvgAttr "rect" (
         "width" =: "7"
      <> "height" =: "5"
      <> "x" =: "3"
      <> "y" =: "16"
      <> "rx" =: "1"
    ) $ blank