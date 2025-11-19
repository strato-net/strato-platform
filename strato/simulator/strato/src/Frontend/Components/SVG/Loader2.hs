{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Loader2
  ( loader2
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

loader2 :: MonadWidget t m => SVGProps -> m ()
loader2 = flip svg $
  elSvgAttr "path" ("d" =: "M21 12a9 9 0 1 1-6.219-8.56") $ blank