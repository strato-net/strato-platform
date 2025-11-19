{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ArrowRight
  ( arrowRight
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

arrowRight :: MonadWidget t m => SVGProps -> m ()
arrowRight = flip svg $ do
  elSvgAttr "path" ("d" =: "M5 12h14") $ blank
  elSvgAttr "path" ("d" =: "m12 5 7 7-7 7") $ blank
