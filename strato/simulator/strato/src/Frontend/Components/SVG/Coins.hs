{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Coins
  ( coins
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

coins :: MonadWidget t m => SVGProps -> m ()
coins = flip svg $ do
  elSvgAttr "circle" (
         "cx" =: "8"
      <> "cy" =: "8"
      <> "r" =: "6"
    ) $ blank
  elSvgAttr "path" ("d" =: "M18.09 10.37A6 6 0 1 1 10.34 18") $ blank
  elSvgAttr "path" ("d" =: "M7 6h1v4") $ blank
  elSvgAttr "path" ("d" =: "m16.71 13.88.7.71-2.82 2.82") $ blank