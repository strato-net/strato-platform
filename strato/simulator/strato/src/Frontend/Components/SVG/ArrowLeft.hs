{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ArrowLeft
  ( arrowLeft
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

arrowLeft :: MonadWidget t m => SVGProps -> m ()
arrowLeft = flip svg $ do
  elSvgAttr "path" ("d" =: "m12 19-7-7 7-7") $ blank
  elSvgAttr "path" ("d" =: "M19 12H5") $ blank