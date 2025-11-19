{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.CopyCheck
  ( copyCheck
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

copyCheck :: MonadWidget t m => SVGProps -> m ()
copyCheck = flip svg $ do
  elSvgAttr "path" ("d" =: "m12 15 2 2 4-4") $ blank
  elSvgAttr "rect" (
         "width" =: "14"
      <> "height" =: "14"
      <> "x" =: "8"
      <> "y" =: "8"
      <> "rx" =: "2"
      <> "ry" =: "2"
    ) $ blank
  elSvgAttr "path" ("d" =: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2") $ blank