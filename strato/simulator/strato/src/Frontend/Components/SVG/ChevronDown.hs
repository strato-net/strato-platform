{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ChevronDown
  ( chevronDown
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

chevronDown :: MonadWidget t m => SVGProps -> m ()
chevronDown = flip svg $
  elSvgAttr "path" ("d" =: "m6 9 6 6 6-6") $ blank

