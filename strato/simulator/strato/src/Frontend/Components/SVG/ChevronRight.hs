{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ChevronRight
  ( chevronRight
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

chevronRight :: MonadWidget t m => SVGProps -> m ()
chevronRight = flip svg $
  elSvgAttr "path" ("d" =: "m9 18 6-6-6-6") $ blank

