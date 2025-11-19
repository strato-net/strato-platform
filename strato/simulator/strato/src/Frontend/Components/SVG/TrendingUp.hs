{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.TrendingUp
  ( trendingUp
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

trendingUp :: MonadWidget t m => SVGProps -> m ()
trendingUp = flip svg $ do
  elSvgAttr "polyline" ("points" =: "22 7 13.5 15.5 8.5 10.5 2 17") $ blank
  elSvgAttr "polyline" ("points" =: "16 7 22 7 22 13") $ blank
