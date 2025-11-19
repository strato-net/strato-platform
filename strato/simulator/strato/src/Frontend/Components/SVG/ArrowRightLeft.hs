{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ArrowRightLeft
  ( arrowRightLeft
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

arrowRightLeft :: MonadWidget t m => SVGProps -> m ()
arrowRightLeft = flip svg $ do
  elSvgAttr "path" ("d" =: "m16 3 4 4-4 4") $ blank
  elSvgAttr "path" ("d" =: "M20 7H4") $ blank
  elSvgAttr "path" ("d" =: "m8 21-4-4 4-4") $ blank
  elSvgAttr "path" ("d" =: "M4 17h16") $ blank