{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ArrowUpRight
  ( arrowUpRight
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

arrowUpRight :: MonadWidget t m => SVGProps -> m ()
arrowUpRight = flip svg $ do
  elSvgAttr "path" ("d" =: "M7 7h10v10") $ blank
  elSvgAttr "path" ("d" =: "M7 17 17 7") $ blank
