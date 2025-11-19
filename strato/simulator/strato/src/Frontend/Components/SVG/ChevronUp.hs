{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ChevronUp
  ( chevronUp
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

chevronUp :: MonadWidget t m => SVGProps -> m ()
chevronUp = flip svg $
  elSvgAttr "path" ("d" =: "m18 15-6-6-6 6") $ blank

