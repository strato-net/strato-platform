{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.History
  ( history
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

history :: MonadWidget t m => SVGProps -> m ()
history = flip svg $ do
  elSvgAttr "path" ("d" =: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8") $ blank
  elSvgAttr "path" ("d" =: "M3 3v5h5") $ blank
  elSvgAttr "path" ("d" =: "M12 7v5l4 2") $ blank