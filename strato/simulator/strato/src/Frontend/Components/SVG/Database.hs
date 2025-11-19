{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Database
  ( database
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

database :: MonadWidget t m => SVGProps -> m ()
database = flip svg $ do
  elSvgAttr "ellipse" (
         "cx" =: "12"
      <> "cy" =: "5"
      <> "rx" =: "9"
      <> "ry" =: "3"
    ) $ blank
  elSvgAttr "path" ("d" =: "M3 5V19A9 3 0 0 0 21 19V5") $ blank
  elSvgAttr "path" ("d" =: "M3 12A9 3 0 0 0 21 12") $ blank