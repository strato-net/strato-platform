{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Menu
  ( menu
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

menu :: MonadWidget t m => SVGProps -> m ()
menu = flip svg $ do
  elSvgAttr "path" ("d" =: "M4 5h16") $ blank
  elSvgAttr "path" ("d" =: "M4 12h16") $ blank
  elSvgAttr "path" ("d" =: "M4 19h16") $ blank