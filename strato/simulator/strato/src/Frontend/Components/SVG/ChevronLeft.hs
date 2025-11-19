{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ChevronLeft
  ( chevronLeft
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

chevronLeft :: MonadWidget t m => SVGProps -> m ()
chevronLeft = flip svg $
  elSvgAttr "path" ("d" =: "m15 18-6-6 6-6") $ blank

