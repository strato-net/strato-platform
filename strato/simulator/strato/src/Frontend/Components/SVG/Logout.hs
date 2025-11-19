{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Logout
  ( logoutIcon
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

logoutIcon :: MonadWidget t m => SVGProps -> m ()
logoutIcon = flip svg $ do
  elSvgAttr "path" ("d" =: "m16 17 5-5-5-5") $ blank
  elSvgAttr "path" ("d" =: "M21 12H9") $ blank
  elSvgAttr "path" ("d" =: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4") $ blank
